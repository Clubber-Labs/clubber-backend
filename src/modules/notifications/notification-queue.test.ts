import { describe, expect, it } from 'vitest'
import { dedupeJobId } from './notification-queue'

describe('dedupeJobId', () => {
  it('é determinístico e nunca contém ":"', () => {
    // Regressão do outage de 2026-08-21: o BullMQ >=5.78 rejeita ':' em jobId
    // customizado ("Custom Id cannot contain :") e o enqueue best-effort
    // engolia o erro — spot.published/chat.message.push/event.created nunca
    // entravam na fila em produção.
    const id = dedupeJobId('spot.joined', 'spot-1', 'user-2')
    expect(id).toBe('spot.joined_spot-1_user-2')
    expect(dedupeJobId('spot.joined', 'spot-1', 'user-2')).toBe(id)
    expect(id).not.toContain(':')
  })

  it('cobre os quatro kinds da fila sem ":"', () => {
    const ids = [
      dedupeJobId('event.created', 'e1'),
      dedupeJobId('spot.published', 's1'),
      dedupeJobId('spot.joined', 's1', 'u1'),
      dedupeJobId('chat.message.push', 'm1'),
    ]
    for (const id of ids) expect(id).not.toContain(':')
    expect(new Set(ids).size).toBe(ids.length)
  })
})
