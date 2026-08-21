import { describe, expect, it } from 'vitest'
import { notificationQueueFailuresTotal } from '../../lib/metrics'
import { deterministicJobId, recordQueueFailure } from './notification-queue'

async function failureCount(stage: string, kind: string): Promise<number> {
  const metric = await notificationQueueFailuresTotal.get()
  const found = metric.values.find(
    (v) => v.labels.stage === stage && v.labels.kind === kind,
  )
  return found?.value ?? 0
}

describe('deterministicJobId', () => {
  it('é determinístico e nunca contém ":"', () => {
    // Regressão do outage de 2026-08-21: o BullMQ >=5.78 rejeita ':' em jobId
    // customizado ("Custom Id cannot contain :") e o enqueue best-effort
    // engolia o erro — spot.published/chat.message.push/event.created nunca
    // entravam na fila em produção.
    const id = deterministicJobId('spot.joined', 'spot-1', 'user-2')
    expect(id).toBe('spot.joined_spot-1_user-2')
    expect(deterministicJobId('spot.joined', 'spot-1', 'user-2')).toBe(id)
    expect(id).not.toContain(':')
  })

  it('cobre os quatro kinds da fila sem ":"', () => {
    const ids = [
      deterministicJobId('event.created', 'e1'),
      deterministicJobId('spot.published', 's1'),
      deterministicJobId('spot.joined', 's1', 'u1'),
      deterministicJobId('chat.message.push', 'm1'),
    ]
    for (const id of ids) expect(id).not.toContain(':')
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('recordQueueFailure', () => {
  it('incrementa o contador por estágio e tipo de job', async () => {
    const before = await failureCount('enqueue', 'spot.published')

    recordQueueFailure('enqueue', 'spot.published', new Error('boom'), {
      spotId: 's1',
    })

    expect(await failureCount('enqueue', 'spot.published')).toBe(before + 1)
  })

  it('separa enqueue de process no mesmo kind', async () => {
    const before = await failureCount('process', 'chat.message.push')

    recordQueueFailure('process', 'chat.message.push', new Error('boom'), {
      jobId: 'j1',
    })

    expect(await failureCount('process', 'chat.message.push')).toBe(before + 1)
    expect(await failureCount('enqueue', 'chat.message.push')).not.toBe(
      before + 1,
    )
  })
})
