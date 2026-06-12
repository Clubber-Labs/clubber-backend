import { compare, hash } from 'bcryptjs'
import { env } from '../../lib/env'
import { deleteUploaded, uploadAvatar } from '../../lib/uploads'
import {
  terminateBillingForUser,
  unlinkStripeCustomer,
} from '../billing/billing.service'
import { getConsentSummary } from '../consent/consent.service'
import {
  findFollow,
  findFollowStatusesByFollower,
} from '../follows/follows.repository'
import {
  anonymizeUserTx,
  createUser,
  findAccountState,
  findAllUsers,
  findAnonymizationStorageKeys,
  findOwnUserById,
  findUserAvatarKey,
  findUserByEmail,
  findUserById,
  findUserByUsername,
  searchUsers as searchUsersRepo,
  setAccountActive,
  setAccountDeactivated,
  setAccountPendingDeletion,
  updateUser,
  updateUserWithPreferences,
} from './users.repository'
import type {
  CreateUserBody,
  SearchUsersQuery,
  UpdateUserBody,
} from './users.schema'

type Logger = { error: (msg: string) => void }

/**
 * Achata `categoryPreferences: [{ category }]` (shape do Prisma) em
 * `preferredCategories: string[]` para a resposta da API.
 */
function withPreferredCategories<
  T extends { categoryPreferences?: { category: string }[] },
>(user: T) {
  const { categoryPreferences, ...rest } = user
  return {
    ...rest,
    preferredCategories: (categoryPreferences ?? []).map((p) => p.category),
  }
}

export async function listUsers(limit: number, cursor?: string) {
  const users = await findAllUsers(limit, cursor)
  const nextCursor = users.length === limit ? users[users.length - 1].id : null
  return { data: users, nextCursor }
}

export async function searchUsers(
  { q, limit, cursor }: SearchUsersQuery,
  viewerId: string,
) {
  const users = await searchUsersRepo(q, limit, cursor)
  const nextCursor = users.length === limit ? users[users.length - 1].id : null

  const otherIds = users.filter((u) => u.id !== viewerId).map((u) => u.id)
  const statuses = await findFollowStatusesByFollower(viewerId, otherIds)

  const data = users.map((u) => {
    const isSelf = u.id === viewerId
    const followStatus = isSelf ? null : (statuses.get(u.id) ?? null)

    // Privacy gate: privado sem follow ACCEPTED só expõe card mínimo,
    // sem bio/counts/createdAt. O próprio viewer sempre vê seu shape completo.
    // `kind` é tag discriminante explícita pra o client distinguir as variantes
    // sem heurística (presença/ausência de campos opcionais).
    const hidePrivate = u.isPrivate && !isSelf && followStatus !== 'ACCEPTED'
    if (hidePrivate) {
      return {
        kind: 'reduced' as const,
        id: u.id,
        username: u.username,
        name: u.name,
        lastname: u.lastname,
        avatarUrl: u.avatarUrl,
        isPrivate: true as const,
        followStatus,
      }
    }

    return { kind: 'full' as const, ...u, followStatus }
  })

  return { data, nextCursor }
}

export async function getUserById(id: string, viewerId?: string) {
  const user = await findUserById(id)
  if (!user) throw { statusCode: 404, message: 'Usuário não encontrado' }

  const { _count, ...rest } = user

  const follow =
    viewerId && viewerId !== id ? await findFollow(viewerId, id) : null
  const followStatus = follow?.status ?? null

  return {
    ...withPreferredCategories(rest),
    eventsCount: _count.events,
    followStatus,
  }
}

export async function getMe(userId: string) {
  const user = await findOwnUserById(userId)
  // Token válido cujo usuário não existe mais (ex.: conta deletada) ou já
  // anonimizada = sessão inválida → 401, sinal inequívoco para o cliente
  // deslogar (não 404, que confundiria com "recurso ausente"). Conta
  // DEACTIVATED/PENDING_DELETION ainda responde: o app mostra o aviso de
  // exclusão agendada / opção de reativar.
  if (!user || user.accountStatus === 'ANONYMIZED') {
    throw { statusCode: 401, message: 'Sessão inválida' }
  }
  // password sai aqui (nunca serializado); vira o booleano hasPassword para o
  // cliente decidir se exige reconfirmação de senha na exclusão.
  const { _count, password, ...rest } = user
  // Paralelo: evita round-trip sequencial ao banco
  const [preferredUser, consent] = await Promise.all([
    Promise.resolve(withPreferredCategories(rest)),
    getConsentSummary(userId),
  ])
  return {
    ...preferredUser,
    eventsCount: _count.events,
    hasPassword: password !== null,
    consent,
  }
}

export async function registerUser(data: CreateUserBody) {
  const emailExists = await findUserByEmail(data.email)
  const usernameExists = await findUserByUsername(data.username)

  if (emailExists) {
    throw {
      statusCode: 409,
      message: 'Este e-mail já está cadastrado em outra conta.',
    }
  }
  if (usernameExists) {
    throw {
      statusCode: 409,
      message: 'Este nome de usuário já está em uso.',
    }
  }

  const passwordHash = await hash(data.password, 10)

  const user = await createUser({ ...data, password: passwordHash })
  return withPreferredCategories(user)
}

export async function editUser(id: string, data: UpdateUserBody) {
  await getUserById(id)

  if (data.username) {
    const existing = await findUserByUsername(data.username)
    if (existing && existing.id !== id) {
      throw {
        statusCode: 409,
        message: 'Este nome de usuário já está em uso.',
      }
    }
  }

  const { preferredCategories, ...rest } = data
  const updated =
    preferredCategories !== undefined
      ? await updateUserWithPreferences(id, rest, preferredCategories)
      : await updateUser(id, rest)
  return withPreferredCategories(updated)
}

/**
 * Desativa a conta (estado temporário, reversível no login). Converte ACTIVE
 * ou PENDING_DELETION em DEACTIVATED (cancelando exclusão agendada). Idempotente.
 */
export async function deactivateAccount(userId: string) {
  const state = await findAccountState(userId)
  if (!state || state.accountStatus === 'ANONYMIZED') {
    throw { statusCode: 401, message: 'Sessão inválida' }
  }
  if (state.accountStatus === 'DEACTIVATED') {
    return {
      accountStatus: state.accountStatus,
      deactivatedAt: state.deactivatedAt,
      scheduledDeletionAt: state.scheduledDeletionAt,
    }
  }
  return setAccountDeactivated(userId)
}

/**
 * Agenda a exclusão da conta (carência de ACCOUNT_DELETION_GRACE_DAYS dias).
 * Exige reconfirmação de senha quando a conta tem senha (contas social-only
 * dispensam — o JWT já autentica). Idempotente: chamar de novo mantém o
 * scheduledDeletionAt existente.
 */
export async function scheduleAccountDeletion(
  userId: string,
  password?: string,
  reason?: string,
) {
  const state = await findAccountState(userId)
  if (!state || state.accountStatus === 'ANONYMIZED') {
    throw { statusCode: 401, message: 'Sessão inválida' }
  }

  // Reautenticação para ação destrutiva (só se a conta tem senha).
  if (state.password) {
    if (!password) {
      throw {
        statusCode: 400,
        message: 'Senha é obrigatória para excluir a conta',
      }
    }
    const valid = await compare(password, state.password)
    if (!valid) {
      throw { statusCode: 401, message: 'Senha incorreta' }
    }
  }

  if (state.accountStatus === 'PENDING_DELETION') {
    return {
      accountStatus: state.accountStatus,
      deactivatedAt: state.deactivatedAt,
      scheduledDeletionAt: state.scheduledDeletionAt,
    }
  }

  const scheduledDeletionAt = new Date(
    Date.now() + env.ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000,
  )
  // Transição + log de churn (com o motivo de saída) gravados atomicamente.
  return setAccountPendingDeletion(userId, scheduledDeletionAt, reason)
}

/**
 * Reativa a conta explicitamente (DEACTIVATED/PENDING_DELETION → ACTIVE).
 * Idempotente para ACTIVE; conta ANONYMIZED é terminal e não pode ser reativada.
 */
export async function reactivateAccount(userId: string) {
  const state = await findAccountState(userId)
  if (!state) {
    throw { statusCode: 401, message: 'Sessão inválida' }
  }
  if (state.accountStatus === 'ANONYMIZED') {
    throw {
      statusCode: 409,
      message:
        'Esta conta foi excluída permanentemente e não pode ser reativada',
    }
  }
  if (state.accountStatus === 'ACTIVE') {
    return {
      accountStatus: state.accountStatus,
      deactivatedAt: state.deactivatedAt,
      scheduledDeletionAt: state.scheduledDeletionAt,
    }
  }
  return setAccountActive(userId)
}

/**
 * Anonimiza definitivamente a conta (chamado pelo reconciler após a carência).
 * Coleta as chaves de storage antes de mutar, executa a transação de
 * anonimização e, se de fato anonimizou (não foi reativada na corrida), limpa
 * avatar e imagens dos eventos no storage (best-effort, fora da transação).
 * Retorna true se anonimizou.
 */
export async function anonymizeAccount(
  userId: string,
  logger: Logger,
  now: Date = new Date(),
): Promise<boolean> {
  // Chaves coletadas antes da tx (storage é externo/não-transacional). Os IDs de
  // follow para decrementar contadores são coletados DENTRO da tx (sem corrida).
  const storage = await findAnonymizationStorageKeys(userId)

  // Billing primeiro, banco depois (LGPD): se o cancelamento no Stripe falhar,
  // nada local muda — a conta segue PENDING_DELETION e o reconciler tenta de
  // novo no próximo tick. A ordem inversa anonimizaria o titular deixando a
  // cobrança viva no gateway.
  const terminatedCustomerId = await terminateBillingForUser(userId)

  const anonymized = await anonymizeUserTx(userId, now)
  if (!anonymized) {
    // Login reativou a conta na janela entre o cancel no Stripe e a tx (o
    // guard venceu). O Customer já morreu no gateway — reparar o ponteiro pra
    // o próximo checkout criar um Customer novo; sem isso, ensureStripeCustomer
    // devolveria um ID morto e o checkout quebraria. isPremium se auto-corrige
    // via webhook customer.subscription.deleted: a subscription local fica e o
    // handler a acha pelo stripeSubscriptionId, sem depender do ponteiro.
    if (terminatedCustomerId) {
      await unlinkStripeCustomer(userId, terminatedCustomerId)
    }
    return false
  }

  const keys = [storage.avatarKey, ...storage.eventImageKeys].filter(
    (k): k is string => Boolean(k),
  )
  for (const key of keys) {
    await deleteUploaded(key, logger)
  }
  return true
}

export async function changeUserAvatar(
  userId: string,
  buffer: Buffer,
  logger: Logger,
) {
  const current = await findUserAvatarKey(userId)
  if (!current) {
    throw { statusCode: 404, message: 'Usuário não encontrado' }
  }

  const uploaded = await uploadAvatar(buffer, userId)

  try {
    const updated = await updateUser(userId, {
      avatarUrl: uploaded.url,
      avatarKey: uploaded.key,
    })
    if (current.avatarKey) {
      await deleteUploaded(current.avatarKey, logger)
    }
    return withPreferredCategories(updated)
  } catch (err) {
    await deleteUploaded(uploaded.key, logger)
    throw err
  }
}
