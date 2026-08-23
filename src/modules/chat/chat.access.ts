import { AppError } from '../../lib/errors/app-error'
import { canViewAuthorContent } from '../../lib/profile-visibility'
import { isBlockedEitherWay } from '../blocks/blocks.repository'
import {
  findActiveParticipant,
  findConversationById,
  findUserBrief,
} from './chat.repository'

/**
 * Garante que `viewer` pode iniciar/manter conversa com `target`:
 * não é ele mesmo, alvo existe, sem bloqueio em nenhuma direção e a
 * privacidade do alvo permite (público ou seguido) — espelha canViewAuthorContent.
 */
export async function assertReachable(viewerId: string, targetId: string) {
  if (targetId === viewerId) {
    throw new AppError(400, 'INVALID_CONVERSATION')
  }
  const target = await findUserBrief(targetId)
  // Conta inativa (desativada/pendente/anonimizada) é tratada como inexistente:
  // não dá para iniciar conversa nem adicionar a grupo.
  if (!target || target.accountStatus !== 'ACTIVE') {
    throw new AppError(404, 'USER_NOT_FOUND')
  }
  if (await isBlockedEitherWay(viewerId, targetId)) {
    throw new AppError(403, 'CONVERSATION_FORBIDDEN')
  }
  if (!(await canViewAuthorContent(targetId, viewerId))) {
    throw new AppError(403, 'PRIVATE_PROFILE')
  }
  return target
}

/**
 * Exige que o usuário seja participante ativo. 404 se a conversa não existe,
 * 403 se existe mas o usuário não participa (não vaza conteúdo).
 */
export async function assertActiveParticipant(
  conversationId: string,
  userId: string,
) {
  const participant = await findActiveParticipant(conversationId, userId)
  if (participant) return participant

  const conversation = await findConversationById(conversationId)
  if (!conversation) {
    throw new AppError(404, 'CONVERSATION_NOT_FOUND')
  }
  throw new AppError(403, 'NOT_CONVERSATION_MEMBER')
}

export function assertAdmin(participant: { role: string }) {
  if (participant.role !== 'ADMIN') {
    throw new AppError(403, 'ADMIN_ONLY')
  }
}
