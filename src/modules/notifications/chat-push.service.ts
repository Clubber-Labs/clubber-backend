import { env } from '../../lib/env'
import type { Locale } from '../../lib/i18n/locale'
import { t } from '../../lib/i18n/translate'
import { hydrateMessage } from '../chat/chat.crypto'
import {
  findChatPushRecipientUserIds,
  findMessageForPush,
} from './chat-push.repository'
import { displayName } from './notification-content'
import { groupRecipientsByLocale } from './notification-delivery'
import { type PushContent, sendPushToUsers } from './notification-push.service'

/**
 * Delay entre a mensagem e o job de push. Quem estiver online recebe pelo
 * socket nesse intervalo e o watermark (lastDeliveredAt) avança — o job então
 * o pula. É o que dispensa presença global: o watermark já diz quem recebeu.
 */
export const CHAT_MESSAGE_PUSH_DELAY_MS = 5_000

const MAX_BODY_LENGTH = 120

function truncate(text: string) {
  if (text.length <= MAX_BODY_LENGTH) return text
  return `${text.slice(0, MAX_BODY_LENGTH)}…`
}

type PushableMessage = NonNullable<
  Awaited<ReturnType<typeof findMessageForPush>>
>

function preview(message: PushableMessage, locale: Locale) {
  // Flag desligada: nada do conteúdo sai daqui — nem o texto, nem o tipo do
  // anexo. Um único significado para o botão, e o worker sequer decifrou.
  if (!env.CHAT_PUSH_PREVIEW_ENABLED) return t('chatPush.emptyPreview', locale)
  const text = message.content?.trim()
  if (text) return truncate(text)
  const kind = message.attachments[0]?.kind
  return kind
    ? t(`chatPush.attachment.${kind}`, locale)
    : t('chatPush.emptyPreview', locale)
}

function buildContent(message: PushableMessage, locale: Locale): PushContent {
  const sender = displayName(message.sender)
  const isGroup = message.conversation.type === 'GROUP'
  return {
    title: isGroup
      ? (message.conversation.title ?? t('chatPush.groupFallbackTitle', locale))
      : sender,
    body: isGroup
      ? t('chatPush.groupBody', locale, {
          sender,
          preview: preview(message, locale),
        })
      : preview(message, locale),
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
  // Só decifra se o preview for sair: com a flag desligada o texto em claro não
  // chega nem a existir em memória neste processo.
  if (env.CHAT_PUSH_PREVIEW_ENABLED) {
    await hydrateMessage(message)
  }
  const recipients = await findChatPushRecipientUserIds(
    message.conversationId,
    message.senderId,
    message.createdAt,
  )
  if (recipients.length === 0) return { sent: 0 }

  // Uma copy por idioma presente na conversa: sem linha de Notification para
  // renderizar depois, o texto do push é montado aqui, para cada grupo.
  const byLocale = await groupRecipientsByLocale(recipients)
  let sent = 0
  for (const [locale, userIds] of byLocale) {
    const result = await sendPushToUsers(userIds, buildContent(message, locale))
    sent += result.sent
  }
  return { sent }
}
