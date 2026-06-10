import {
  classifyPushError,
  getPushService,
  type PushMessage,
} from '../../lib/push'
import {
  findActiveDeviceTokensForUsers,
  invalidateDeviceToken,
} from './device-token.repository'
import {
  createPushTickets,
  findPendingReceipts,
  type NewPushTicket,
  updatePushTicketStatus,
} from './push-ticket.repository'

export type PushContent = {
  title: string
  body: string
  data?: Record<string, unknown>
}

export type UserPushContent = { userId: string; content: PushContent }

/**
 * Envia push com conteúdo POR USUÁRIO (ex.: fan-out, onde o data carrega o
 * notificationId de cada destinatário), num único envio chunkado ao Expo, e
 * persiste os tickets (PENDING) para a reconciliação de receipts. NÃO checa
 * consentimento — o caller garante (proximidade filtra no SQL; social checa
 * antes de enfileirar). Erro imediato no ticket com DeviceNotRegistered já
 * invalida o token; os demais erros (entrega) só aparecem no receipt.
 */
export async function sendPushBatch(
  items: UserPushContent[],
): Promise<{ sent: number }> {
  if (items.length === 0) return { sent: 0 }
  const contentByUser = new Map(items.map((i) => [i.userId, i.content]))
  const tokens = await findActiveDeviceTokensForUsers(
    items.map((i) => i.userId),
  )
  if (tokens.length === 0) return { sent: 0 }

  const messages: PushMessage[] = []
  for (const t of tokens) {
    const content = contentByUser.get(t.userId)
    if (!content) continue
    messages.push({
      to: t.token,
      title: content.title,
      body: content.body,
      data: content.data,
    })
  }
  const results = await getPushService().send(messages)

  const idByToken = new Map(tokens.map((t) => [t.token, t.id]))
  const tickets: NewPushTicket[] = []
  for (const r of results) {
    const deviceTokenId = idByToken.get(r.token)
    if (!deviceTokenId) continue
    if (r.status === 'ok') {
      tickets.push({ deviceTokenId, receiptId: r.ticketId, status: 'PENDING' })
    } else {
      tickets.push({ deviceTokenId, status: 'ERROR', error: r.error })
      if (classifyPushError(r.error) === 'remove_token') {
        await invalidateDeviceToken(
          deviceTokenId,
          r.error ?? 'DeviceNotRegistered',
        )
      }
    }
  }
  await createPushTickets(tickets)
  return { sent: tickets.length }
}

/** Mesmo conteúdo para vários usuários (caso social, 1 destinatário por job). */
export async function sendPushToUsers(
  userIds: string[],
  content: PushContent,
): Promise<{ sent: number }> {
  return sendPushBatch(userIds.map((userId) => ({ userId, content })))
}

/**
 * Reconcilia os receipts dos tickets PENDING maduros (criados há mais que o
 * delay). Receipt OK → ticket OK; erro → ticket ERROR e, se DeviceNotRegistered,
 * invalida o DeviceToken. Receipt ainda indisponível → fica PENDING para a
 * próxima rodada. Roda como reconciler periódico (setInterval).
 */
export async function reconcilePushReceipts(opts: {
  delayMs: number
  limit: number
  now?: Date
}): Promise<{ checked: number; invalidated: number }> {
  const now = opts.now ?? new Date()
  const cutoff = new Date(now.getTime() - opts.delayMs)
  const pending = await findPendingReceipts(cutoff, opts.limit)
  if (pending.length === 0) return { checked: 0, invalidated: 0 }

  const receiptIds = pending
    .map((t) => t.receiptId)
    .filter((id): id is string => id !== null)
  const receipts = await getPushService().getReceipts(receiptIds)

  let invalidated = 0
  for (const ticket of pending) {
    const receipt = ticket.receiptId
      ? receipts.get(ticket.receiptId)
      : undefined
    if (!receipt) continue // ainda não disponível — deixa PENDING

    if (receipt.status === 'ok') {
      await updatePushTicketStatus(ticket.id, 'OK')
    } else {
      await updatePushTicketStatus(ticket.id, 'ERROR', receipt.error)
      if (classifyPushError(receipt.error) === 'remove_token') {
        await invalidateDeviceToken(
          ticket.deviceTokenId,
          receipt.error ?? 'DeviceNotRegistered',
        )
        invalidated++
      }
    }
  }
  return { checked: pending.length, invalidated }
}
