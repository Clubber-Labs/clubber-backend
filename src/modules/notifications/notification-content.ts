import type { NotificationType, Prisma } from '@prisma/client'
import type { TranslationKey } from '../../lib/i18n/dictionary'
import type { Locale } from '../../lib/i18n/locale'
import { type TranslationParams, t } from '../../lib/i18n/translate'

export type NotificationActor = {
  name: string
  lastname: string
}

export function displayName(actor: NotificationActor): string {
  return [actor.name, actor.lastname].filter(Boolean).join(' ').trim()
}

/** Tipos sociais (com autor), despachados por notifyFromActor. Proximidade e
 * spot têm caminho próprio nos fan-outs. */
export type SocialNotificationKind = Exclude<
  NotificationType,
  'EVENT_NEARBY' | 'SPOT_NEARBY' | 'SPOT_JOIN' | 'SPOT_RENEWAL'
>

type ContentKeys = { titleKey: TranslationKey; bodyKey: TranslationKey }

/**
 * Tipo → chaves de copy. Switch exaustivo sem `default` de propósito: um
 * NotificationType novo sem copy não compila ("nem todos os caminhos retornam")
 * em vez de cair num texto genérico silencioso.
 */
function contentKeys(type: NotificationType, promoted: boolean): ContentKeys {
  switch (type) {
    case 'EVENT_NEARBY':
      return promoted
        ? {
            titleKey: 'notifications.eventPromoted.title',
            bodyKey: 'notifications.eventPromoted.body',
          }
        : {
            titleKey: 'notifications.eventNearby.title',
            bodyKey: 'notifications.eventNearby.body',
          }
    case 'SPOT_NEARBY':
      return {
        titleKey: 'notifications.spotNearby.title',
        bodyKey: 'notifications.spotNearby.body',
      }
    case 'SPOT_JOIN':
      return {
        titleKey: 'notifications.spotJoin.title',
        bodyKey: 'notifications.spotJoin.body',
      }
    case 'SPOT_RENEWAL':
      return {
        titleKey: 'notifications.spotRenewal.title',
        bodyKey: 'notifications.spotRenewal.body',
      }
    case 'FOLLOW_REQUEST':
      return {
        titleKey: 'notifications.followRequest.title',
        bodyKey: 'notifications.followRequest.body',
      }
    case 'FOLLOW_ACCEPTED':
      return {
        titleKey: 'notifications.followAccepted.title',
        bodyKey: 'notifications.followAccepted.body',
      }
    case 'NEW_FOLLOWER':
      return {
        titleKey: 'notifications.newFollower.title',
        bodyKey: 'notifications.newFollower.body',
      }
    case 'EVENT_INVITE':
      return {
        titleKey: 'notifications.eventInvite.title',
        bodyKey: 'notifications.eventInvite.body',
      }
    case 'EVENT_COMMENT':
      return {
        titleKey: 'notifications.eventComment.title',
        bodyKey: 'notifications.eventComment.body',
      }
    case 'POST_COMMENT':
      return {
        titleKey: 'notifications.postComment.title',
        bodyKey: 'notifications.postComment.body',
      }
    case 'COMMENT_REPLY':
      return {
        titleKey: 'notifications.commentReply.title',
        bodyKey: 'notifications.commentReply.body',
      }
    case 'EVENT_REACTION':
      return {
        titleKey: 'notifications.eventReaction.title',
        bodyKey: 'notifications.eventReaction.body',
      }
    case 'POST_REACTION':
      return {
        titleKey: 'notifications.postReaction.title',
        bodyKey: 'notifications.postReaction.body',
      }
    case 'COMMENT_REACTION':
      return {
        titleKey: 'notifications.commentReaction.title',
        bodyKey: 'notifications.commentReaction.body',
      }
    case 'EVENT_ATTENDANCE':
      return {
        titleKey: 'notifications.eventAttendance.title',
        bodyKey: 'notifications.eventAttendance.body',
      }
  }
}

function asRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Nome do autor, derivado da FK para acompanhar rename. Se a conta sumiu, cai no
 * snapshot que `data.actor` já carrega (é o mesmo nome que o app mostra ao lado
 * do texto — divergir aqui ficaria incoerente na tela) e, sem ele, num genérico.
 */
function actorName(
  actor: NotificationActor | null,
  data: Prisma.JsonValue | null,
  locale: Locale,
): string {
  if (actor) return displayName(actor)
  const snapshot = asRecord(asRecord(data).actor as Prisma.JsonValue)
  if (typeof snapshot.name === 'string') {
    return displayName({
      name: snapshot.name,
      lastname: typeof snapshot.lastname === 'string' ? snapshot.lastname : '',
    })
  }
  return t('notifications.unknownActor', locale)
}

export type RenderableNotification = {
  type: NotificationType
  params: Prisma.JsonValue | null
  data: Prisma.JsonValue | null
}

/**
 * Renderiza título e corpo de uma notificação no idioma pedido. É o único ponto
 * que transforma (tipo + params + autor) em texto — a linha do banco guarda só
 * a chave implícita no tipo, nunca a frase.
 */
export function renderNotificationContent(
  n: RenderableNotification,
  actor: NotificationActor | null,
  locale: Locale,
): { title: string; body: string } {
  const params = asRecord(n.params)
  const { titleKey, bodyKey } = contentKeys(n.type, params.promoted === true)
  const interpolation: TranslationParams = {
    actor: actorName(actor, n.data, locale),
    ...(typeof params.eventTitle === 'string' && {
      eventTitle: params.eventTitle,
    }),
    ...(typeof params.spotTitle === 'string' && {
      spotTitle: params.spotTitle,
    }),
  }
  return {
    title: t(titleKey, locale, interpolation),
    body: t(bodyKey, locale, interpolation),
  }
}
