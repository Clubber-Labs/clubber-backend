import {
  createBlock,
  deleteBlock,
  findBlock,
  listBlocks,
  userExists,
} from './blocks.repository'

export async function blockUser(blockerId: string, targetId: string) {
  if (blockerId === targetId) {
    throw { statusCode: 400, message: 'Você não pode bloquear a si mesmo' }
  }
  if (!(await userExists(targetId))) {
    throw { statusCode: 404, message: 'Usuário não encontrado' }
  }
  const existing = await findBlock(blockerId, targetId)
  if (existing) {
    throw { statusCode: 409, message: 'Usuário já está bloqueado' }
  }
  return createBlock(blockerId, targetId)
}

export async function unblockUser(blockerId: string, targetId: string) {
  const removed = await deleteBlock(blockerId, targetId)
  if (removed === 0) {
    throw { statusCode: 404, message: 'Bloqueio não encontrado' }
  }
}

export async function listBlockedUsers(
  blockerId: string,
  limit: number,
  cursor?: string,
) {
  const rows = await listBlocks(blockerId, limit, cursor)
  const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null
  return { data: rows, nextCursor }
}
