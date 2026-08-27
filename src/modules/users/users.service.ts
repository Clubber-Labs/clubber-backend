import { compare, hash } from 'bcryptjs'
import { env } from '../../lib/env'
import { AppError } from '../../lib/errors/app-error'
import { preferredLanguage } from '../../lib/i18n/locale'
import { logger } from '../../lib/logger'
import * as moderationDenylist from '../../lib/moderation-denylist'
import { deleteUploaded, uploadAvatar } from '../../lib/uploads'
import {
  terminateBillingForUser,
  unlinkStripeCustomer,
} from '../billing/billing.service'
import { getConsentSummary } from '../consent/consent.service'
import { withViewerFollowInfo } from '../follows/follows.service'
import { findActiveSnapshotByUserId } from '../spotify-link/spotify-link.repository'
import {
  readSnapshotArtists,
  spotifyArtistUrl,
} from '../spotify-link/spotify-link.service'
import { matchArtists } from '../spotify-link/spotify-match'
import {
  anonymizeUserTx,
  clearExpiredSuspension,
  createUser,
  findAccountState,
  findAllUsers,
  findAnonymizationStorageKeys,
  findModerationState,
  findOwnUserById,
  findUserAvatarKey,
  findUserById,
  findUserIdByEmail,
  findUserIdByUsername,
  searchUsers as searchUsersRepo,
  setAccountActive,
  setAccountDeactivated,
  setAccountPendingDeletion,
  setUserBanned,
  setUserSuspended,
  setUserUnsuspended,
  updateUser,
  updateUserDeviceContext,
  updateUserWithPreferences,
} from './users.repository'
import type {
  CreateUserBody,
  SearchUsersQuery,
  UpdateUserBody,
} from './users.schema'

type Logger = { error: (msg: string) => void }

/** Quantos artistas o perfil exibe — a fileira é um resumo, não a lista toda. */
const PROFILE_ARTIST_LIMIT = 5

/**
 * Converte o shape do Prisma no shape da API: achata as preferências
 * (`categoryPreferences: [{ category }]` → `preferredCategories: string[]`) e
 * resolve os top artistas do Spotify.
 *
 * Ponto ÚNICO dessa conversão — é o que garante que os campos crus do vínculo
 * (com a lista de ocultos) nunca cheguem à resposta por nenhum caminho.
 */
function toApiUser<
  T extends {
    categoryPreferences?: { category: string }[]
    subcategoryPreferences?: { subcategory: string }[]
    spotifyArtistsVisible?: boolean
    spotifyLink?: { status: string; hiddenArtistIds: string[] } | null
    spotifyTasteSnapshot?: { artists: unknown } | null
  },
>(user: T, opts: { own?: boolean } = {}) {
  const {
    categoryPreferences,
    subcategoryPreferences,
    spotifyArtistsVisible,
    spotifyLink,
    spotifyTasteSnapshot,
    ...rest
  } = user

  // Vínculo revogado não mostra artistas: o dado está velho e o usuário já
  // desautorizou o Clubber do lado do Spotify.
  const showArtists =
    spotifyArtistsVisible !== false && spotifyLink?.status === 'ACTIVE'
  const hidden = new Set(spotifyLink?.hiddenArtistIds ?? [])

  return {
    ...rest,
    preferredCategories: (categoryPreferences ?? []).map((p) => p.category),
    preferredSubcategories: (subcategoryPreferences ?? []).map(
      (p) => p.subcategory,
    ),
    // A preferência em si só volta pro dono (é o estado do toggle dele); em
    // perfil de terceiro nem revelamos que alguém escondeu algo.
    ...(opts.own
      ? { spotifyArtistsVisible: spotifyArtistsVisible ?? true }
      : {}),
    topArtists: showArtists
      ? readSnapshotArtists(spotifyTasteSnapshot?.artists)
          .filter((a) => !hidden.has(a.id))
          .slice(0, PROFILE_ARTIST_LIMIT)
          .map((a) => ({
            id: a.id,
            name: a.name,
            imageUrl: a.imageUrl,
            spotifyUrl: spotifyArtistUrl(a.id),
          }))
      : [],
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

  // Os dois sentidos: `followStatus` é viewer→usuário, `followsYou` é o inverso.
  // O cliente precisa dos dois pra saber se pode abrir conversa (perfil privado
  // exige follow mútuo — ver canChatWith).
  const enriched = await withViewerFollowInfo(users, viewerId)

  const data = enriched.map((u) => {
    const isSelf = u.id === viewerId

    // Privacy gate só na BUSCA: privado sem follow ACCEPTED expõe card mínimo
    // (sem bio/counts). Divergência PROPOSITAL de getUserById (perfil), que
    // mostra os metadados estilo Instagram — a busca fica minimalista.
    // `kind` discrimina as variantes pro client sem heurística de campos.
    const hidePrivate = u.isPrivate && !isSelf && u.followStatus !== 'ACCEPTED'
    if (hidePrivate) {
      return {
        kind: 'reduced' as const,
        id: u.id,
        username: u.username,
        name: u.name,
        lastname: u.lastname,
        avatarUrl: u.avatarUrl,
        isPrivate: true as const,
        followStatus: u.followStatus,
        followsYou: u.followsYou,
      }
    }

    return { kind: 'full' as const, ...u }
  })

  return { data, nextCursor }
}

export async function getUserById(id: string, viewerId?: string) {
  const user = await findUserById(id)
  if (!user) throw new AppError(404, 'USER_NOT_FOUND')

  const { _count, ...rest } = user

  const isSelf = viewerId === id
  // Os dois sentidos, mesmo motivo da busca: o botão de mensagem só libera se
  // o perfil for público OU o follow for mútuo (canChatWith).
  const { followStatus, followsYou } =
    viewerId && !isSelf
      ? (await withViewerFollowInfo([{ id }], viewerId))[0]
      : { followStatus: null, followsYou: false }

  // Perfil completo mesmo p/ conta privada (estilo Instagram): a privacidade
  // real fica no conteúdo (authorVisibleWhere) e nas listas de seguidores
  // (ensureCanViewFollowList) — aqui só metadados agregados, não identidades.
  return {
    kind: 'full' as const,
    ...toApiUser(rest),
    eventsCount: _count.events,
    followStatus,
    followsYou,
    artistMatch:
      viewerId && !isSelf ? await resolveArtistMatch(viewerId, rest) : null,
  }
}

/**
 * Artistas que o visitante e o dono do perfil ouvem em comum. Quem escondeu a
 * fileira aparece só na contagem: o gancho social sobrevive sem entregar os
 * nomes que a pessoa optou por não mostrar.
 */
async function resolveArtistMatch(
  viewerId: string,
  target: {
    spotifyArtistsVisible?: boolean
    spotifyLink?: { status: string; hiddenArtistIds: string[] } | null
    spotifyTasteSnapshot?: { artists: unknown } | null
  },
) {
  // Vínculo revogado tem dado congelado dos DOIS lados: o do dono sai daqui, o
  // do visitante sai da própria query do snapshot.
  if (target.spotifyLink?.status !== 'ACTIVE') return null

  const viewerSnapshot = await findActiveSnapshotByUserId(viewerId)
  if (!viewerSnapshot) return null

  return matchArtists(
    viewerSnapshot.artists,
    target.spotifyTasteSnapshot?.artists,
    {
      revealNames: target.spotifyArtistsVisible !== false,
      hiddenArtistIds: target.spotifyLink.hiddenArtistIds,
    },
  )
}

export async function getMe(userId: string) {
  const user = await findOwnUserById(userId)
  // Token válido cujo usuário não existe mais (ex.: conta deletada) ou já
  // anonimizada = sessão inválida → 401, sinal inequívoco para o cliente
  // deslogar (não 404, que confundiria com "recurso ausente"). Conta
  // DEACTIVATED/PENDING_DELETION ainda responde: o app mostra o aviso de
  // exclusão agendada / opção de reativar.
  if (!user || user.accountStatus === 'ANONYMIZED') {
    throw new AppError(401, 'SESSION_INVALID')
  }
  // password sai aqui (nunca serializado); vira o booleano hasPassword para o
  // cliente decidir se exige reconfirmação de senha na exclusão.
  const { _count, password, ...rest } = user
  // Paralelo: evita round-trip sequencial ao banco
  const [preferredUser, consent] = await Promise.all([
    Promise.resolve(toApiUser(rest, { own: true })),
    getConsentSummary(userId),
  ])
  return {
    ...preferredUser,
    eventsCount: _count.events,
    hasPassword: password !== null,
    consent,
    // Teto do raio de recomendação de spots — o client usa como max do slider
    // (em vez de hardcodar) e como teto do raio salvo. Acompanha o env.
    spotMaxRadiusKm: env.SPOT_MAX_RADIUS_KM,
  }
}

/**
 * Disponibilidade do username para o cadastro em etapas. Usa o MESMO predicado
 * do registerUser (findUserIdByUsername, case-insensitive como o índice único) —
 * divergir aqui faria a rota dizer "livre" e o POST /users responder 409.
 */
export async function checkUsernameAvailability(username: string) {
  const existingId = await findUserIdByUsername(username)
  return { available: existingId === null }
}

export async function registerUser(
  data: CreateUserBody,
  meta: { ipAddress: string | null; userAgent: string | null },
  acceptLanguage?: string,
) {
  const emailExists = await findUserIdByEmail(data.email)
  const usernameExists = await findUserIdByUsername(data.username)

  if (emailExists) {
    throw new AppError(409, 'EMAIL_TAKEN', 'email')
  }
  if (usernameExists) {
    throw new AppError(409, 'USERNAME_TAKEN', 'username')
  }

  const passwordHash = await hash(data.password, 10)

  // Idioma do aparelho entra no próprio create (como o timezone): um write só,
  // e a resposta do cadastro já sai com o valor capturado, não com o default.
  const deviceLocale = preferredLanguage(acceptLanguage)
  const user = await createUser(
    { ...data, password: passwordHash, ...(deviceLocale && { deviceLocale }) },
    meta,
  )
  return toApiUser(user, { own: true })
}

export async function editUser(id: string, data: UpdateUserBody) {
  const target = await findUserById(id)
  if (!target) throw new AppError(404, 'USER_NOT_FOUND')

  if (data.username) {
    const existingId = await findUserIdByUsername(data.username)
    if (existingId && existingId !== id) {
      throw new AppError(409, 'USERNAME_TAKEN', 'username')
    }
  }

  const { preferredCategories, preferredSubcategories, ...rest } = data
  const updated =
    preferredCategories !== undefined || preferredSubcategories !== undefined
      ? await updateUserWithPreferences(id, rest, {
          categories: preferredCategories,
          subcategories: preferredSubcategories,
        })
      : await updateUser(id, rest)
  return toApiUser(updated, { own: true })
}

/**
 * Captura idioma (Accept-Language) e fuso do aparelho nos pontos onde o app
 * fala com o servidor conhecendo o device (login, registro de push). Guarda a
 * tag CRUA de maior prioridade — a resolução contra os dicionários acontece na
 * leitura (effectiveLocale). Best-effort: telemetria de aparelho nunca derruba
 * o fluxo principal.
 */
export async function captureDeviceContext(
  userId: string,
  acceptLanguage: string | undefined,
  timezone: string | undefined,
) {
  const deviceLocale = preferredLanguage(acceptLanguage)
  const data: { deviceLocale?: string; timezone?: string } = {
    ...(deviceLocale && { deviceLocale }),
    ...(timezone && { timezone }),
  }
  if (!data.deviceLocale && !data.timezone) return
  try {
    await updateUserDeviceContext(userId, data)
  } catch (err) {
    logger.warn({ err, userId }, 'contexto do aparelho não atualizado')
  }
}

/**
 * Desativa a conta (estado temporário, reversível no login). Converte ACTIVE
 * ou PENDING_DELETION em DEACTIVATED (cancelando exclusão agendada). Idempotente.
 */
export async function deactivateAccount(userId: string) {
  const state = await findAccountState(userId)
  if (!state || state.accountStatus === 'ANONYMIZED') {
    throw new AppError(401, 'SESSION_INVALID')
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
    throw new AppError(401, 'SESSION_INVALID')
  }

  // Reautenticação para ação destrutiva (só se a conta tem senha).
  if (state.password) {
    if (!password) {
      throw new AppError(400, 'PASSWORD_REQUIRED')
    }
    const valid = await compare(password, state.password)
    if (!valid) {
      throw new AppError(401, 'INVALID_PASSWORD')
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
    throw new AppError(401, 'SESSION_INVALID')
  }
  if (state.accountStatus === 'ANONYMIZED') {
    throw new AppError(409, 'ACCOUNT_ANONYMIZED')
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
    throw new AppError(404, 'USER_NOT_FOUND')
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
    return toApiUser(updated, { own: true })
  } catch (err) {
    await deleteUploaded(uploaded.key, logger)
    throw err
  }
}

// Os endpoints chamadores já passam por assertAdmin; estas funções garantem as
// invariantes do alvo e mantêm a denylist Redis em sincronia com o banco.

type ModerationTarget = Awaited<ReturnType<typeof findModerationState>>

function assertModeratable(
  target: ModerationTarget,
  requesterId: string,
  nextAction: 'SUSPEND' | 'BAN',
) {
  if (!target) throw new AppError(404, 'USER_NOT_FOUND')
  if (target.id === requesterId) {
    throw new AppError(400, 'SELF_MODERATION')
  }
  if (target.role === 'ADMIN') {
    throw new AppError(403, 'CANNOT_MODERATE_ADMIN')
  }
  // Banimento é permanente: suspender (temporário) por cima rebaixaria a punição
  // e o reconciler reativaria a conta ao vencer. Exige remover o ban antes.
  if (nextAction === 'SUSPEND' && target.accountStatus === 'BANNED') {
    throw new AppError(409, 'USER_ALREADY_BANNED')
  }
}

export async function suspendUser(
  userId: string,
  requesterId: string,
  days: number,
  reason?: string,
) {
  const target = await findModerationState(userId)
  assertModeratable(target, requesterId, 'SUSPEND')
  const suspendedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  const updated = await setUserSuspended(userId, suspendedUntil, reason)
  await moderationDenylist.block(userId)
  return updated
}

export async function banUser(
  userId: string,
  requesterId: string,
  reason?: string,
) {
  const target = await findModerationState(userId)
  assertModeratable(target, requesterId, 'BAN')
  const updated = await setUserBanned(userId, reason)
  await moderationDenylist.block(userId)
  return updated
}

/** Levanta suspensão/ban. Idempotente: conta já ACTIVE só garante o unblock. */
export async function unsuspendUser(userId: string) {
  const target = await findModerationState(userId)
  if (!target) throw new AppError(404, 'USER_NOT_FOUND')
  if (
    target.accountStatus !== 'SUSPENDED' &&
    target.accountStatus !== 'BANNED'
  ) {
    await moderationDenylist.unblock(userId)
    return target
  }
  const updated = await setUserUnsuspended(userId)
  await moderationDenylist.unblock(userId)
  return updated
}

/**
 * Auto-cura de suspensão vencida no login (espelha reactivateOnLogin). Retorna
 * true se a conta foi reativada. Mantém a denylist em sincronia.
 */
export async function clearExpiredSuspensionOnLogin(
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const res = await clearExpiredSuspension(userId, now)
  if (res.count > 0) await moderationDenylist.unblock(userId)
  return res.count > 0
}
