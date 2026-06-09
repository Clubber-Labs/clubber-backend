import type { AccountLifecycleAction, Prisma } from '@prisma/client'
import {
  activeUserWhere,
  DELETED_DISPLAY_LASTNAME,
  DELETED_DISPLAY_NAME,
} from '../../lib/account-visibility'
import type { EventCategory } from '../../lib/event-categories'
import { prisma } from '../../lib/prisma'
import type { CreateUserBody } from './users.schema'

const userPublicListSelect = {
  id: true,
  name: true,
  lastname: true,
  username: true,
  bio: true,
  avatarUrl: true,
  isPrivate: true,
  followersCount: true,
  followingCount: true,
  createdAt: true,
} as const

const userPublicProfileSelect = {
  ...userPublicListSelect,
  categoryPreferences: { select: { category: true } },
} as const

const userPrivateProfileSelect = {
  ...userPublicProfileSelect,
  email: true,
  phone: true,
  birthdate: true,
  role: true,
  accountStatus: true,
  deactivatedAt: true,
  scheduledDeletionAt: true,
} as const

// Campos do estado de conta usados internamente pelas transições de ciclo de
// vida (inclui `password` para reautenticação na exclusão — nunca serializado).
const accountStateSelect = {
  accountStatus: true,
  deactivatedAt: true,
  scheduledDeletionAt: true,
} as const

export async function findAllUsers(limit: number, cursor?: string) {
  return prisma.user.findMany({
    where: activeUserWhere(),
    select: userPublicListSelect,
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: { createdAt: 'desc' },
  })
}

export async function searchUsers(q: string, limit: number, cursor?: string) {
  return prisma.user.findMany({
    where: {
      ...activeUserWhere(),
      OR: [
        { username: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { lastname: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: userPublicListSelect,
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: [{ username: 'asc' }, { id: 'asc' }],
  })
}

// findFirst (não findUnique) para combinar o id com o filtro de status: conta
// não-ACTIVE retorna null → o service responde 404 (perfil de terceiro some).
export async function findUserById(id: string) {
  return prisma.user.findFirst({
    where: { id, ...activeUserWhere() },
    select: {
      ...userPublicProfileSelect,
      _count: { select: { events: true } },
    },
  })
}

export async function findOwnUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      ...userPrivateProfileSelect,
      // password só para derivar `hasPassword` no service — o hash NUNCA é
      // serializado (é removido antes de montar a resposta). Mantido fora do
      // userPrivateProfileSelect compartilhado para não vazar em create/update.
      password: true,
      _count: { select: { events: true } },
    },
  })
}

export async function findUserAvatarKey(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: { avatarKey: true },
  })
}

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } })
}

export async function findUserByUsername(username: string) {
  return prisma.user.findUnique({ where: { username } })
}

export async function createUser(
  data: Omit<CreateUserBody, 'password'> & { password: string | null },
) {
  const { preferredCategories, ...userData } = data
  return prisma.user.create({
    data: {
      ...userData,
      ...(preferredCategories && preferredCategories.length > 0
        ? {
            categoryPreferences: {
              create: preferredCategories.map((category) => ({ category })),
            },
          }
        : {}),
    },
    select: userPrivateProfileSelect,
  })
}

export async function updateUser(id: string, data: Prisma.UserUpdateInput) {
  return prisma.user.update({
    where: { id },
    data,
    select: userPrivateProfileSelect,
  })
}

/**
 * Atualiza o usuário e substitui suas preferências de categoria numa única
 * transação (semântica PUT: a lista enviada vira o estado completo).
 */
export async function updateUserWithPreferences(
  id: string,
  data: Prisma.UserUpdateInput,
  categories: EventCategory[],
) {
  const [, , user] = await prisma.$transaction([
    prisma.userCategoryPreference.deleteMany({ where: { userId: id } }),
    prisma.userCategoryPreference.createMany({
      data: categories.map((category) => ({ userId: id, category })),
      skipDuplicates: true,
    }),
    prisma.user.update({
      where: { id },
      data,
      select: userPrivateProfileSelect,
    }),
  ])
  return user
}

/**
 * Estado de conta para as transições de ciclo de vida. Inclui `password` para
 * reautenticação na exclusão — usado só internamente no service, nunca exposto.
 */
export async function findAccountState(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: { ...accountStateSelect, password: true },
  })
}

export async function setAccountDeactivated(id: string) {
  return prisma.user.update({
    where: { id },
    data: {
      accountStatus: 'DEACTIVATED',
      deactivatedAt: new Date(),
      scheduledDeletionAt: null,
    },
    select: accountStateSelect,
  })
}

export async function setAccountPendingDeletion(
  id: string,
  scheduledDeletionAt: Date,
) {
  return prisma.user.update({
    where: { id },
    data: {
      accountStatus: 'PENDING_DELETION',
      deactivatedAt: new Date(),
      scheduledDeletionAt,
    },
    select: accountStateSelect,
  })
}

export async function setAccountActive(id: string) {
  return prisma.user.update({
    where: { id },
    data: {
      accountStatus: 'ACTIVE',
      deactivatedAt: null,
      scheduledDeletionAt: null,
    },
    select: accountStateSelect,
  })
}

/**
 * Reativa a conta no login (email/senha ou social) se ela estiver
 * DEACTIVATED/PENDING_DELETION. Update condicional ao status atual (updateMany)
 * para o login vencer a corrida com o reconciler de anonimização e ser idempotente
 * para contas ACTIVE/ANONYMIZED (que não casam o WHERE).
 */
export async function reactivateOnLogin(id: string) {
  return prisma.user.updateMany({
    where: {
      id,
      accountStatus: { in: ['DEACTIVATED', 'PENDING_DELETION'] },
    },
    data: {
      accountStatus: 'ACTIVE',
      deactivatedAt: null,
      scheduledDeletionAt: null,
    },
  })
}

/**
 * Registra um evento de ciclo de vida da conta (append-only). Hoje só o fluxo de
 * exclusão grava (com o motivo de saída opcional); o modelo já comporta outras
 * ações para evolução futura.
 */
export async function createAccountLifecycleLog(
  userId: string,
  action: AccountLifecycleAction,
  reason?: string,
) {
  return prisma.accountLifecycleLog.create({
    data: { userId, action, reason: reason ?? null },
  })
}

/** IDs de contas PENDING_DELETION cuja carência venceu (alvo do reconciler). */
export async function findAccountsDueForAnonymization(now: Date) {
  return prisma.user.findMany({
    where: {
      accountStatus: 'PENDING_DELETION',
      scheduledDeletionAt: { lte: now },
    },
    select: { id: true },
  })
}

/**
 * Dados coletados ANTES da anonimização: chaves de storage a limpar (avatar +
 * imagens dos eventos do usuário) e os lados de follow ACCEPTED cujos contadores
 * de terceiros precisam ser decrementados.
 */
export async function findAnonymizationData(userId: string) {
  const [user, eventImages, following, followers] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { avatarKey: true },
    }),
    prisma.eventImage.findMany({
      where: { event: { authorId: userId } },
      select: { key: true },
    }),
    prisma.follow.findMany({
      where: { followerId: userId, status: 'ACCEPTED' },
      select: { followingId: true },
    }),
    prisma.follow.findMany({
      where: { followingId: userId, status: 'ACCEPTED' },
      select: { followerId: true },
    }),
  ])
  return {
    avatarKey: user?.avatarKey ?? null,
    eventImageKeys: eventImages.map((i) => i.key),
    followingIds: following.map((f) => f.followingId),
    followerIds: followers.map((f) => f.followerId),
  }
}

/**
 * Anonimiza a conta numa transação (LGPD): sobrescreve PII com placeholders
 * únicos pelo id, remove conteúdo próprio standalone (eventos/posts e respectivos
 * cascades) e interações (reações/presenças/follows/social/consent), mantendo o
 * que vive em espaço alheio (comentários/mensagens) — que passa a exibir
 * "Usuário Excluído" pelo próprio registro. Decrementa os contadores de follow
 * dos terceiros afetados.
 *
 * Guard condicional ao status PENDING_DELETION: se um login reativou a conta na
 * corrida, o updateMany não casa (count 0) e nada é apagado — o login vence.
 * Retorna true se anonimizou, false se foi pulada.
 */
export async function anonymizeUserTx(
  userId: string,
  followingIds: string[],
  followerIds: string[],
  now: Date = new Date(),
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const flagged = await tx.user.updateMany({
      where: { id: userId, accountStatus: 'PENDING_DELETION' },
      data: {
        name: DELETED_DISPLAY_NAME,
        lastname: DELETED_DISPLAY_LASTNAME,
        username: `deleted_${userId}`,
        email: `deleted+${userId}@deleted.invalid`,
        phone: null,
        password: null,
        bio: null,
        avatarUrl: null,
        avatarKey: null,
        birthdate: null,
        lastSeenAt: null,
        isPrivate: true,
        accountStatus: 'ANONYMIZED',
        anonymizedAt: now,
        deactivatedAt: null,
        scheduledDeletionAt: null,
      },
    })
    if (flagged.count === 0) return false

    // Conteúdo próprio standalone (cascateia filhos pelo evento/post).
    await tx.event.deleteMany({ where: { authorId: userId } })
    await tx.post.deleteMany({ where: { authorId: userId } })
    // Interações do usuário (não-conteúdo) em espaços alheios.
    await tx.reaction.deleteMany({ where: { userId } })
    await tx.commentReaction.deleteMany({ where: { userId } })
    await tx.eventAttendance.deleteMany({ where: { userId } })
    // Vínculos sociais e consentimento.
    await tx.socialAccount.deleteMany({ where: { userId } })
    await tx.userConsent.deleteMany({ where: { userId } })
    await tx.follow.deleteMany({
      where: { OR: [{ followerId: userId }, { followingId: userId }] },
    })
    // Decrementa contadores de terceiros (só follows ACCEPTED contavam).
    if (followingIds.length > 0) {
      await tx.user.updateMany({
        where: { id: { in: followingIds } },
        data: { followersCount: { decrement: 1 } },
      })
    }
    if (followerIds.length > 0) {
      await tx.user.updateMany({
        where: { id: { in: followerIds } },
        data: { followingCount: { decrement: 1 } },
      })
    }
    return true
  })
}
