import { AppError } from '../../lib/errors/app-error'
import {
  createBlock,
  deleteBlock,
  findBlock,
  listBlocks,
  userExists,
} from './blocks.repository'

export async function blockUser(blockerId: string, targetId: string) {
  if (blockerId === targetId) {
    throw new AppError(400, 'SELF_BLOCK')
  }
  if (!(await userExists(targetId))) {
    throw new AppError(404, 'USER_NOT_FOUND')
  }
  const existing = await findBlock(blockerId, targetId)
  if (existing) {
    throw new AppError(409, 'ALREADY_BLOCKED')
  }
  return createBlock(blockerId, targetId)
}

export async function unblockUser(blockerId: string, targetId: string) {
  const removed = await deleteBlock(blockerId, targetId)
  if (removed === 0) {
    throw new AppError(404, 'BLOCK_NOT_FOUND')
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
