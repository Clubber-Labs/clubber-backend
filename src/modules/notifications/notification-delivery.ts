import type { Notification } from '@prisma/client'
import { DEFAULT_LOCALE, type Locale } from '../../lib/i18n/locale'
import { effectiveLocale } from '../../lib/i18n/user-locale'
import { realtime } from '../../lib/realtime'
import {
  filterPushConsentedUserIds,
  findRecipientLocaleFields,
} from './notification.repository'
import {
  type NotificationActor,
  renderNotificationContent,
} from './notification-content'
import { sendPushBatch } from './notification-push.service'
import { buildPushData, shapeNotificationWith } from './notification-shape'

/** Idioma de cada destinatário, resolvido em uma query para o lote inteiro. */
export async function resolveRecipientLocales(
  userIds: string[],
): Promise<Map<string, Locale>> {
  const rows = await findRecipientLocaleFields([...new Set(userIds)])
  return new Map(rows.map((u) => [u.id, effectiveLocale(u)]))
}

/**
 * Destinatários agrupados por idioma, para quem envia um conteúdo por lote
 * (push sem linha de Notification) montar a copy uma vez por grupo.
 */
export async function groupRecipientsByLocale(
  userIds: string[],
): Promise<Map<Locale, string[]>> {
  const localeByUser = await resolveRecipientLocales(userIds)
  const groups = new Map<Locale, string[]>()
  for (const userId of userIds) {
    const locale = localeByUser.get(userId) ?? DEFAULT_LOCALE
    const group = groups.get(locale)
    if (group) group.push(userId)
    else groups.set(locale, [userId])
  }
  return groups
}

/**
 * Entrega (foreground + push) de notificações já criadas, cada uma no idioma do
 * seu destinatário. Caminho único dos fan-outs — antes cada um repetia o par
 * publish/sendPushBatch, e agora nenhum pode esquecer de traduzir.
 *
 * Foreground vai para TODOS (in-app não exige consentimento); o push só para
 * quem tem consentimento vigente — filtrado aqui, o ponto único, para nenhum
 * fan-out esquecer.
 *
 * Renderiza uma vez por (conteúdo, idioma) em vez de por destinatário: a
 * dedupeKey já É a identidade do conteúdo (tipo + alvos), então serve de chave
 * de cache num fan-out de milhares sem colar o texto de um spot no outro.
 */
export async function deliverNotifications(
  notifications: Notification[],
  actor: NotificationActor | null = null,
): Promise<void> {
  if (notifications.length === 0) return

  const localeByUser = await resolveRecipientLocales(
    notifications.map((n) => n.userId),
  )
  const rendered = new Map<string, { title: string; body: string }>()
  const payloads = notifications.map((n) => {
    const locale = localeByUser.get(n.userId) ?? DEFAULT_LOCALE
    const cacheKey = `${n.dedupeKey} ${locale}`
    let content = rendered.get(cacheKey)
    if (!content) {
      content = renderNotificationContent(n, actor, locale)
      rendered.set(cacheKey, content)
    }
    return { n, payload: shapeNotificationWith(n, content) }
  })

  await Promise.all(
    payloads.map(({ n, payload }) =>
      realtime.publishNotification({
        type: 'notification',
        recipientId: n.userId,
        notification: payload,
      }),
    ),
  )
  const pushConsented = await filterPushConsentedUserIds(
    notifications.map((n) => n.userId),
  )
  await sendPushBatch(
    payloads
      .filter(({ n }) => pushConsented.has(n.userId))
      .map(({ n, payload }) => ({
        userId: n.userId,
        content: {
          title: payload.title,
          body: payload.body,
          data: buildPushData(n),
        },
      })),
  )
}
