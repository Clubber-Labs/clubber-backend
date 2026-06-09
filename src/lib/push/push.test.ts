import { Expo } from 'expo-server-sdk'
import { describe, expect, it, vi } from 'vitest'
import { fakePush } from '../../test/fake-push'
import { ExpoPushService } from './expo-push.service'
import { classifyPushError, type PushMessage } from './push.interface'

const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]'
const TOKEN_B = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]'

function msg(to: string): PushMessage {
  return { to, title: 'Olá', body: 'Tem evento perto de você' }
}

describe('classifyPushError', () => {
  it('só DeviceNotRegistered manda remover o token', () => {
    expect(classifyPushError('DeviceNotRegistered')).toBe('remove_token')
  })

  it('MessageRateExceeded é retry', () => {
    expect(classifyPushError('MessageRateExceeded')).toBe('retry')
  })

  it('erro de credencial/payload/provider vira alerta', () => {
    expect(classifyPushError('InvalidCredentials')).toBe('alert')
    expect(classifyPushError('MessageTooBig')).toBe('alert')
    expect(classifyPushError('ProviderError')).toBe('alert')
  })

  it('sem erro, nada a fazer', () => {
    expect(classifyPushError(undefined)).toBe('none')
    expect(classifyPushError('')).toBe('none')
  })
})

describe('ExpoPushService.send', () => {
  it('mapeia tickets ok/erro preservando o token de destino', async () => {
    const expo = new Expo()
    vi.spyOn(expo, 'sendPushNotificationsAsync').mockResolvedValue([
      { status: 'ok', id: 'receipt-1' },
      {
        status: 'error',
        message: 'x',
        details: { error: 'DeviceNotRegistered' },
      },
    ])
    const svc = new ExpoPushService(undefined, expo)

    const results = await svc.send([msg(TOKEN_A), msg(TOKEN_B)])

    expect(results).toEqual([
      { status: 'ok', token: TOKEN_A, ticketId: 'receipt-1' },
      { status: 'error', token: TOKEN_B, error: 'DeviceNotRegistered' },
    ])
  })

  it('descarta tokens com formato inválido antes de enviar', async () => {
    const expo = new Expo()
    const send = vi
      .spyOn(expo, 'sendPushNotificationsAsync')
      .mockResolvedValue([{ status: 'ok', id: 'receipt-1' }])
    const svc = new ExpoPushService(undefined, expo)

    const results = await svc.send([msg('token-invalido'), msg(TOKEN_A)])

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toHaveLength(1)
    expect(results).toHaveLength(1)
    expect(results[0].token).toBe(TOKEN_A)
  })

  it('não envia nada quando todos os tokens são inválidos', async () => {
    const expo = new Expo()
    const send = vi.spyOn(expo, 'sendPushNotificationsAsync')
    const svc = new ExpoPushService(undefined, expo)

    const results = await svc.send([msg('x'), msg('y')])

    expect(send).not.toHaveBeenCalled()
    expect(results).toEqual([])
  })

  it('faz chunking (>100 mensagens viram múltiplos requests) sem perder tickets', async () => {
    const expo = new Expo()
    const send = vi
      .spyOn(expo, 'sendPushNotificationsAsync')
      .mockImplementation(async (chunk) =>
        chunk.map((_, i) => ({ status: 'ok' as const, id: `r-${i}` })),
      )
    const svc = new ExpoPushService(undefined, expo)

    const messages = Array.from({ length: 150 }, () => msg(TOKEN_A))
    const results = await svc.send(messages)

    expect(send.mock.calls.length).toBeGreaterThan(1) // chunk de 100 → 2 requests
    expect(results).toHaveLength(150)
    expect(results.every((r) => r.status === 'ok')).toBe(true)
  })
})

describe('ExpoPushService.getReceipts', () => {
  it('mapeia receipts ok/erro por id', async () => {
    const expo = new Expo()
    vi.spyOn(expo, 'getPushNotificationReceiptsAsync').mockResolvedValue({
      'receipt-1': { status: 'ok' },
      'receipt-2': {
        status: 'error',
        message: 'x',
        details: { error: 'DeviceNotRegistered' },
      },
    })
    const svc = new ExpoPushService(undefined, expo)

    const receipts = await svc.getReceipts(['receipt-1', 'receipt-2'])

    expect(receipts.get('receipt-1')).toEqual({ status: 'ok' })
    expect(receipts.get('receipt-2')).toEqual({
      status: 'error',
      error: 'DeviceNotRegistered',
    })
  })

  it('lista vazia não chama o Expo', async () => {
    const expo = new Expo()
    const get = vi.spyOn(expo, 'getPushNotificationReceiptsAsync')
    const svc = new ExpoPushService(undefined, expo)

    const receipts = await svc.getReceipts([])

    expect(get).not.toHaveBeenCalled()
    expect(receipts.size).toBe(0)
  })
})

describe('FakePushService', () => {
  it('guarda o enviado e devolve tickets ok por padrão', async () => {
    fakePush.reset()
    const results = await fakePush.send([msg(TOKEN_A), msg(TOKEN_B)])

    expect(fakePush.sent).toHaveLength(2)
    expect(results.every((r) => r.status === 'ok')).toBe(true)
  })

  it('permite roteirizar erro de ticket e receipt', async () => {
    fakePush.reset()
    fakePush.ticketFor = (m) => ({
      status: 'error',
      token: m.to,
      error: 'DeviceNotRegistered',
    })
    const [ticket] = await fakePush.send([msg(TOKEN_A)])
    expect(ticket).toMatchObject({
      status: 'error',
      error: 'DeviceNotRegistered',
    })

    fakePush.receipts.set('r1', {
      status: 'error',
      error: 'DeviceNotRegistered',
    })
    const receipts = await fakePush.getReceipts(['r1', 'r2'])
    expect(receipts.get('r1')).toEqual({
      status: 'error',
      error: 'DeviceNotRegistered',
    })
    expect(receipts.get('r2')).toEqual({ status: 'ok' })
  })
})
