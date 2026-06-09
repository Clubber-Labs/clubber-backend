import { Expo, type ExpoPushMessage } from 'expo-server-sdk'
import type {
  IPushService,
  PushMessage,
  PushReceiptResult,
  PushTicketResult,
} from './push.interface'

/**
 * Subconjunto do client Expo que usamos — permite injetar um fake nos testes
 * sem tocar a rede.
 */
type ExpoLike = Pick<
  Expo,
  | 'chunkPushNotifications'
  | 'sendPushNotificationsAsync'
  | 'chunkPushNotificationReceiptIds'
  | 'getPushNotificationReceiptsAsync'
>

/**
 * Driver de push de produção via Expo Push Service. Recebe o accessToken no
 * construtor (resolvido pela factory a partir do env) — espelha o
 * ResendMailerService. O chunking respeita os limites de quantidade E de bytes
 * do Expo (`chunkPushNotifications`), por isso nunca fatiamos em 100 na mão.
 */
export class ExpoPushService implements IPushService {
  private readonly client: ExpoLike

  constructor(accessToken?: string, client?: ExpoLike) {
    this.client = client ?? new Expo(accessToken ? { accessToken } : {})
  }

  async send(messages: PushMessage[]): Promise<PushTicketResult[]> {
    // Defesa em profundidade: descarta tokens com formato inválido antes de
    // montar o chunk (o registro do DeviceToken já valida na ingestão).
    const expoMessages: ExpoPushMessage[] = messages
      .filter((m) => Expo.isExpoPushToken(m.to))
      .map((m) => ({
        to: m.to,
        title: m.title,
        body: m.body,
        data: m.data,
        sound: 'default',
      }))
    if (expoMessages.length === 0) return []

    const results: PushTicketResult[] = []
    for (const chunk of this.client.chunkPushNotifications(expoMessages)) {
      const tickets = await this.client.sendPushNotificationsAsync(chunk)
      tickets.forEach((ticket, i) => {
        const token = chunk[i]?.to as string
        if (ticket.status === 'ok') {
          results.push({ status: 'ok', token, ticketId: ticket.id })
        } else {
          results.push({ status: 'error', token, error: ticket.details?.error })
        }
      })
    }
    return results
  }

  async getReceipts(
    ticketIds: string[],
  ): Promise<Map<string, PushReceiptResult>> {
    const out = new Map<string, PushReceiptResult>()
    if (ticketIds.length === 0) return out
    for (const chunk of this.client.chunkPushNotificationReceiptIds(
      ticketIds,
    )) {
      const receipts = await this.client.getPushNotificationReceiptsAsync(chunk)
      for (const [id, receipt] of Object.entries(receipts)) {
        if (receipt.status === 'ok') {
          out.set(id, { status: 'ok' })
        } else {
          out.set(id, { status: 'error', error: receipt.details?.error })
        }
      }
    }
    return out
  }
}
