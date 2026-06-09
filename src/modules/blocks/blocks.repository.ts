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
  return prisma.block.create({ data: { blockerId, blockedId } })
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
