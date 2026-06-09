import type { NotificationType } from '@prisma/client'

export type NotificationActor = {
  name: string
  lastname: string
}

function displayName(actor: NotificationActor): string {
  return [actor.name, actor.lastname].filter(Boolean).join(' ').trim()
}

/**
 * Copy (título + corpo) de cada notificação social, montada a partir do nome do
 * autor. Centraliza o texto num único lugar — os gatilhos só passam o tipo + ids.
 * EVENT_NEARBY (proximidade) tem conteúdo próprio na entrega 5 (sem autor).
 */
/** Tipos sociais (com autor). EVENT_NEARBY é proximidade, sem autor — entrega 5. */
export type SocialNotificationKind = Exclude<NotificationType, 'EVENT_NEARBY'>

export function socialNotificationContent(
  type: SocialNotificationKind,
  actor: NotificationActor,
): { title: string; body: string } {
  const who = displayName(actor)
  switch (type) {
    case 'FOLLOW_REQUEST':
      return { title: 'Nova solicitação', body: `${who} quer te seguir` }
    case 'NEW_FOLLOWER':
      return { title: 'Novo seguidor', body: `${who} começou a te seguir` }
    case 'FOLLOW_ACCEPTED':
      return {
        title: 'Solicitação aceita',
        body: `${who} aceitou seu pedido para seguir`,
      }
    case 'EVENT_INVITE':
      return {
        title: 'Convite para evento',
        body: `${who} te convidou para um evento`,
      }
    case 'EVENT_COMMENT':
      return { title: 'Novo comentário', body: `${who} comentou no seu evento` }
    case 'POST_COMMENT':
      return { title: 'Novo comentário', body: `${who} comentou no seu post` }
    case 'EVENT_REACTION':
      return { title: 'Nova curtida', body: `${who} curtiu seu evento` }
    case 'POST_REACTION':
      return { title: 'Nova curtida', body: `${who} curtiu seu post` }
    case 'COMMENT_REACTION':
      return { title: 'Nova curtida', body: `${who} curtiu seu comentário` }
    case 'EVENT_ATTENDANCE':
      return { title: 'Nova presença', body: `${who} vai ao seu evento` }
  }
  // Sem default de propósito: como `type` é o subconjunto social exato, um
  // NotificationType social novo sem case aqui quebra a compilação ("nem todos
  // os caminhos retornam") em vez de cair num texto genérico silencioso.
}
