import type { NotificationType } from '@prisma/client'
import { z } from 'zod'

/**
 * Snapshot por variante: o que a leitura NÃO consegue derivar da FK. Título de
 * spot é snapshot porque o spot é apagado no vencimento (spot-lifecycle) e o
 * título do evento porque a notificação sobrevive à edição/remoção do evento —
 * já o nome do autor fica de fora de propósito, é derivado de actorId na
 * leitura para acompanhar rename.
 *
 * `satisfies Record<NotificationType, ...>`: tipo novo sem entrada aqui não
 * compila, mesma proteção do switch de copy em notification-content.
 */
export const NOTIFICATION_PARAMS = {
  // `promoted` distingue a copy do digest de destaques da do evento novo —
  // mesmo NotificationType (o deep-link é igual), mensagem diferente.
  EVENT_NEARBY: z.object({
    eventTitle: z.string(),
    promoted: z.boolean().optional(),
  }),
  SPOT_NEARBY: z.object({ spotTitle: z.string() }),
  SPOT_JOIN: z.object({ spotTitle: z.string() }),
  SPOT_RENEWAL: z.object({ spotTitle: z.string() }),
  FOLLOW_REQUEST: z.undefined(),
  FOLLOW_ACCEPTED: z.undefined(),
  NEW_FOLLOWER: z.undefined(),
  EVENT_INVITE: z.undefined(),
  EVENT_COMMENT: z.undefined(),
  POST_COMMENT: z.undefined(),
  COMMENT_REPLY: z.undefined(),
  EVENT_REACTION: z.undefined(),
  POST_REACTION: z.undefined(),
  COMMENT_REACTION: z.undefined(),
  EVENT_ATTENDANCE: z.undefined(),
} as const satisfies Record<NotificationType, z.ZodTypeAny>

export type NotificationParamsFor<T extends NotificationType> = z.infer<
  (typeof NOTIFICATION_PARAMS)[T]
>

/**
 * Valida os params na ESCRITA. Os tipos já amarram o formato nos call sites
 * literais; isto pega o valor que só existe em runtime (ex.: um `spot.title`
 * ausente por select incompleto) antes de virar `{{spotTitle}}` cru na tela.
 */
export function parseNotificationParams<T extends NotificationType>(
  type: T,
  params: unknown,
): NotificationParamsFor<T> {
  return NOTIFICATION_PARAMS[type].parse(params) as NotificationParamsFor<T>
}
