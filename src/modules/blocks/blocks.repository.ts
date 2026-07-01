import type { Prisma } from '@prisma/client'
import {
  activeUserWhere,
  visibleAuthorWhere,
} from '../../lib/account-visibility'
import { prisma } from '../../lib/prisma'

const blockedUserSelect = {
  id: true,
  name: true,
  lastname: true,
  username: true,
  avatarUrl: true,
} as const

// Só conta ACTIVE pode ser alvo de bloqueio — não faz sentido bloquear conta
// desativada/pendente/anonimizada (são invisíveis e não interagem).
export async function userExists(id: string): Promise<boolean> {
  const user = await prisma.user.findFirst({
    where: { id, ...activeUserWhere() },
    select: { id: true },
  })
  return user !== null
}

export async function findBlock(blockerId: string, blockedId: string) {
  return prisma.block.findUnique({
    where: { blockerId_blockedId: { blockerId, blockedId } },
  })
}

/** True se A bloqueou B ou B bloqueou A. */
export async function isBlockedEitherWay(
  a: string,
  b: string,
): Promise<boolean> {
  const found = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
    select: { id: true },
  })
  return found !== null
}

export async function createBlock(blockerId: string, blockedId: string) {
  // Bloquear implica desfazer o relacionamento nos dois sentidos (semântica
  // Instagram): quem foi bloqueado não continua seguindo — nem sendo seguido
  // por — quem bloqueou. Feito na mesma transação do bloqueio para não deixar
  // um follow órfão que reabriria o acesso ao conteúdo.
  return prisma.$transaction(async (tx) => {
    const block = await tx.block.create({ data: { blockerId, blockedId } })
    await severFollowsBetween(tx, blockerId, blockedId)
    return block
  })
}

async function severFollowsBetween(
  tx: Prisma.TransactionClient,
  a: string,
  b: string,
) {
  const follows = await tx.follow.findMany({
    where: {
      OR: [
        { followerId: a, followingId: b },
        { followerId: b, followingId: a },
      ],
    },
    select: { id: true, followerId: true, followingId: true, status: true },
  })
  if (follows.length === 0) return

  await tx.follow.deleteMany({
    where: { id: { in: follows.map((f) => f.id) } },
  })

  // Só follow ACCEPTED conta para os contadores — espelha deleteFollow.
  for (const f of follows) {
    if (f.status !== 'ACCEPTED') continue
    await tx.user.update({
      where: { id: f.followerId },
      data: { followingCount: { decrement: 1 } },
    })
    await tx.user.update({
      where: { id: f.followingId },
      data: { followersCount: { decrement: 1 } },
    })
  }
}

export async function deleteBlock(blockerId: string, blockedId: string) {
  const result = await prisma.block.deleteMany({
    where: { blockerId, blockedId },
  })
  return result.count
}

export async function listBlocks(
  blockerId: string,
  limit: number,
  cursor?: string,
) {
  return prisma.block.findMany({
    // Esconde bloqueio de conta apenas desativada/pendente (some temporariamente),
    // mas mantém o de conta anonimizada — o bloqueador ainda gerencia o bloqueio,
    // exibido como "Usuário Excluído".
    where: { blockerId, blocked: visibleAuthorWhere() },
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      createdAt: true,
      blocked: { select: blockedUserSelect },
    },
  })
}
