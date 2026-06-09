import { describe, expect, it } from 'vitest'
import { bullConnectionOptions } from './queue'

describe('bullConnectionOptions', () => {
  // Regressão: o Worker do BullMQ usa comandos bloqueantes que exigem
  // maxRetriesPerRequest:null. Reusar o singleton `redis` (maxRetriesPerRequest:3)
  // quebraria o worker em runtime — por isso a conexão da fila é dedicada.
  it('usa maxRetriesPerRequest null e enableReadyCheck false', () => {
    expect(bullConnectionOptions.maxRetriesPerRequest).toBeNull()
    expect(bullConnectionOptions.enableReadyCheck).toBe(false)
  })
})
