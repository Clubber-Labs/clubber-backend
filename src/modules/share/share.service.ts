import { env } from '../../lib/env'
import { findLinkByToken } from '../event-invite-links/event-invite-links.repository'
import {
  classifyInviteLink,
  type InviteLinkState,
} from '../event-invite-links/event-invite-links.service'

export type InviteLandingData =
  | { kind: 'not_found' }
  | { kind: 'gone'; state: Exclude<InviteLinkState, 'ok'> }
  | {
      kind: 'ok'
      title: string
      description: string | null
      dateLabel: string
      authorLabel: string
      coverUrl: string | null
      shareUrl: string
      appUrl: string
      appStoreUrl?: string
      playStoreUrl: string
    }

function formatEventDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export async function getInviteLandingData(
  token: string,
): Promise<InviteLandingData> {
  const link = await findLinkByToken(token)
  if (!link) return { kind: 'not_found' }

  const state = classifyInviteLink(link)
  if (state !== 'ok') return { kind: 'gone', state }

  const { event } = link
  return {
    kind: 'ok',
    title: event.title,
    description: event.description,
    dateLabel: formatEventDate(event.date, event.timezone),
    authorLabel: `@${event.author.username}`,
    coverUrl: event.images[0]?.url ?? null,
    shareUrl: `${env.SHARE_BASE_URL}/e/${link.token}`,
    // Custom scheme como fallback: com o app instalado o Universal/App Link
    // intercepta antes de chegar aqui; este botão cobre quem tem o app mas
    // abriu a página mesmo assim (ex.: link colado manualmente no browser).
    appUrl: `clubber://invites/${link.token}`,
    appStoreUrl: env.APP_STORE_URL,
    playStoreUrl: env.PLAY_STORE_URL,
  }
}

export function buildAppleAppSiteAssociation() {
  return {
    applinks: {
      apps: [],
      details: [
        {
          appIDs: [`${env.APPLE_TEAM_ID}.${env.APPLE_BUNDLE_ID}`],
          components: [{ '/': '/e/*' }],
        },
      ],
    },
  }
}

export function buildAssetLinks() {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: env.ANDROID_PACKAGE_NAME,
        sha256_cert_fingerprints: env.ANDROID_CERT_SHA256,
      },
    },
  ]
}
