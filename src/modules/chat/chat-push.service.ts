import {
  type PushContent,
  sendPushToUsers,
} from '../notifications/notification-push.service'
import {
  findChatPushRecipientUserIds,
  findMessageForPush,
} from './chat.repository'

/**
 * Delay entre a mensagem e o job de push. Quem estiver online recebe pelo
 * socket nesse intervalo e o watermark (lastDeliveredAt) avança — o job então
 * o pula. É o que dispensa presença global: o watermark já diz quem recebeu.
 */
export const CHAT_MESSAGE_PUSH_DELAY_MS = 5_000

const MAX_BODY_LENGTH = 120

const ATTACHMENT_PLACEHOLDER: Record<string, string> = {
  IMAGE: '📷 Foto',
  AUDIO: '🎤 Mensagem de voz',
  VIDEO: '🎬 Vídeo',
}

function truncate(text: string) {
  if (text.length <= MAX_BODY_LENGTH) return text
  return `${text.slice(0, MAX_BODY_LENGTH)}…`
}

type PushableMessage = NonNullable<
  Awaited<ReturnType<typeof findMessageForPush>>
>

function preview(message: PushableMessage) {
  const text = message.content?.trim()
  if (text) return truncate(text)
  const kind = message.attachments[0]?.kind
  return (kind && ATTACHMENT_PLACEHOLDER[kind]) ?? 'Nova mensagem'
}

function buildContent(message: PushableMessage): PushContent {
  const sender = `${message.sender.name} ${message.sender.lastname}`.trim()
  const isGroup = message.conversation.type === 'GROUP'
  return {
    title: isGroup ? (message.conversation.title ?? 'Grupo') : sender,
    body: isGroup ? `${sender}: ${preview(message)}` : preview(message),
    // Contrato de deep-link do app: abrir a conversa no tap.
    data: {
      type: 'chat.message',
      conversationId: message.conversationId,
      messageId: message.id,
    },
  }
}

/**
 * Processador do job `chat.message.push` (roda no worker, com delay): notifica
 * quem NÃO recebeu a mensagem via socket. A elegibilidade (watermark atrás,
 * sem bloqueio, consentimento de push) é resolvida numa única query; a
 * checagem de token ativo fica no sendPushToUsers.
 */
export async function runChatMessagePush(
  messageId: string,
): Promise<{ sent: number }> {
  const message = await findMessageForPush(messageId)
  // Apagada durante o delay ou de sistema: nada a notificar.
  if (!message || message.deletedAt || message.type === 'SYSTEM') {
    return { sent: 0 }
  }
  const recipients = await findChatPushRecipientUserIds(
    message.conversationId,
    message.senderId,
    message.createdAt,
  )
  if (recipients.length === 0) return { sent: 0 }
  return sendPushToUsers(recipients, buildContent(message))
}
