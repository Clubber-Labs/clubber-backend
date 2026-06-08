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
    throw { statusCode: 400, message: 'Conversa inválida' }
  }
  const target = await findUserBrief(targetId)
  // Conta inativa (desativada/pendente/anonimizada) é tratada como inexistente:
  // não dá para iniciar conversa nem adicionar a grupo.
  if (!target || target.accountStatus !== 'ACTIVE') {
    throw { statusCode: 404, message: 'Usuário não encontrado' }
  }
  if (await isBlockedEitherWay(viewerId, targetId)) {
    throw {
      statusCode: 403,
      message: 'Não é possível conversar com este usuário',
    }
  }
  if (!(await canViewAuthorContent(targetId, viewerId))) {
    throw { statusCode: 403, message: 'Este perfil é privado' }
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
    throw { statusCode: 404, message: 'Conversa não encontrada' }
  }
  throw { statusCode: 403, message: 'Você não participa desta conversa' }
}

export function assertAdmin(participant: { role: string }) {
  if (participant.role !== 'ADMIN') {
    throw {
      statusCode: 403,
      message: 'Apenas administradores podem fazer isso',
    }
  }
}
