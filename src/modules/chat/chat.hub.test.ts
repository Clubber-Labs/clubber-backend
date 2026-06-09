import { describe, expect, it } from 'vitest'
import type { RealtimeEvent } from '../../lib/realtime'
import {
  type ClientSocket,
  createSocketRegistry,
  dispatchEvent,
  isTokenExpired,
  localDeliveryRecipients,
  messageFrame,
  presenceFrame,
  receiptFrame,
  typingFrame,
  WS_OPEN,
} from './chat.hub'

function fakeSocket(readyState = WS_OPEN) {
  const sent: string[] = []
  const socket: ClientSocket = {
    readyState,
    send: (data: string) => {
      sent.push(data)
    },
  }
  return { socket, sent }
}

describe('createSocketRegistry', () => {
  it('add sinaliza transição offline→online só na primeira aba', () => {
    const reg = createSocketRegistry()
    const a = fakeSocket()
    const b = fakeSocket()

    expect(reg.add('u1', a.socket)).toBe(true) // ficou online
    expect(reg.add('u1', b.socket)).toBe(false) // segunda aba não conta
    expect(reg.isOnline('u1')).toBe(true)
    expect(reg.onlineCount()).toBe(1)
  })

  it('remove sinaliza online→offline só quando a última aba sai', () => {
    const reg = createSocketRegistry()
    const a = fakeSocket()
    const b = fakeSocket()
    reg.add('u1', a.socket)
    reg.add('u1', b.socket)

    expect(reg.remove('u1', a.socket)).toBe(false) // ainda há uma aba
    expect(reg.isOnline('u1')).toBe(true)
    expect(reg.remove('u1', b.socket)).toBe(true) // ficou offline
    expect(reg.isOnline('u1')).toBe(false)
    expect(reg.onlineCount()).toBe(0)
  })

  it('remove de usuário/socket inexistente não quebra', () => {
    const reg = createSocketRegistry()
    const a = fakeSocket()
    expect(reg.remove('fantasma', a.socket)).toBe(false)
  })

  it('deliver entrega só a sockets abertos e conta os envios', () => {
    const reg = createSocketRegistry()
    const open = fakeSocket(WS_OPEN)
    const closed = fakeSocket(3) // CLOSED
    reg.add('u1', open.socket)
    reg.add('u2', closed.socket)

    const sent = reg.deliver(['u1', 'u2', 'inexistente'], 'frame')
    expect(sent).toBe(1)
    expect(open.sent).toEqual(['frame'])
    expect(closed.sent).toEqual([])
  })

  it('deliver alcança todas as abas do mesmo usuário', () => {
    const reg = createSocketRegistry()
    const a = fakeSocket()
    const b = fakeSocket()
    reg.add('u1', a.socket)
    reg.add('u1', b.socket)

    expect(reg.deliver(['u1'], 'oi')).toBe(2)
    expect(a.sent).toEqual(['oi'])
    expect(b.sent).toEqual(['oi'])
  })
})

describe('frames', () => {
  it('messageFrame serializa tipo, conversa e mensagem', () => {
    const frame = JSON.parse(messageFrame('message', 'c1', { id: 'm1' }))
    expect(frame).toEqual({
      type: 'message',
      conversationId: 'c1',
      message: { id: 'm1' },
    })
  })

  it('receiptFrame serializa recibo de entregue/lido com o watermark', () => {
    expect(
      JSON.parse(
        receiptFrame('delivered', {
          conversationId: 'c1',
          userId: 'u1',
          at: '2026-06-05T12:31:10.000Z',
        }),
      ),
    ).toEqual({
      type: 'delivered',
      conversationId: 'c1',
      userId: 'u1',
      at: '2026-06-05T12:31:10.000Z',
    })

    expect(
      JSON.parse(
        receiptFrame('read', {
          conversationId: 'c1',
          userId: 'u1',
          at: '2026-06-05T12:32:00.000Z',
        }),
      ),
    ).toEqual({
      type: 'read',
      conversationId: 'c1',
      userId: 'u1',
      at: '2026-06-05T12:32:00.000Z',
    })
  })

  it('typingFrame e presenceFrame carregam os campos efêmeros', () => {
    expect(
      JSON.parse(
        typingFrame({ conversationId: 'c1', userId: 'u1', isTyping: true }),
      ),
    ).toEqual({
      type: 'typing',
      conversationId: 'c1',
      userId: 'u1',
      isTyping: true,
    })

    expect(
      JSON.parse(
        presenceFrame({
          userId: 'u1',
          online: false,
          lastSeenAt: '2026-01-01T00:00:00.000Z',
        }),
      ),
    ).toEqual({
      type: 'presence',
      userId: 'u1',
      online: false,
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    })
  })
})

describe('isTokenExpired', () => {
  it('true quando exp já passou', () => {
    expect(isTokenExpired({ exp: 1000 }, 2000)).toBe(true)
  })
  it('false quando exp no futuro', () => {
    expect(isTokenExpired({ exp: 3000 }, 2000)).toBe(false)
  })
  it('false quando não há exp (sem expiração)', () => {
    expect(isTokenExpired({}, 2000)).toBe(false)
  })
})

describe('dispatchEvent', () => {
  it('message: entrega a todos os participantes', () => {
    const reg = createSocketRegistry()
    const u1 = fakeSocket()
    const u2 = fakeSocket()
    reg.add('u1', u1.socket)
    reg.add('u2', u2.socket)

    const event: RealtimeEvent = {
      type: 'message',
      conversationId: 'c1',
      participantIds: ['u1', 'u2'],
      senderId: 'u1',
      createdAt: '2026-06-05T12:00:00.000Z',
      message: { id: 'm1' },
    }
    expect(dispatchEvent(reg, event)).toBe(2)
    expect(JSON.parse(u1.sent[0]).type).toBe('message')
  })

  it('typing: não retorna pro próprio autor', () => {
    const reg = createSocketRegistry()
    const author = fakeSocket()
    const other = fakeSocket()
    reg.add('autor', author.socket)
    reg.add('outro', other.socket)

    const event: RealtimeEvent = {
      type: 'typing',
      conversationId: 'c1',
      participantIds: ['autor', 'outro'],
      userId: 'autor',
      isTyping: true,
    }
    expect(dispatchEvent(reg, event)).toBe(1)
    expect(author.sent).toEqual([])
    expect(JSON.parse(other.sent[0])).toMatchObject({
      type: 'typing',
      userId: 'autor',
    })
  })

  it('presence: não retorna pro próprio autor', () => {
    const reg = createSocketRegistry()
    const self = fakeSocket()
    const partner = fakeSocket()
    reg.add('eu', self.socket)
    reg.add('parceiro', partner.socket)

    const event: RealtimeEvent = {
      type: 'presence',
      participantIds: ['eu', 'parceiro'],
      userId: 'eu',
      online: true,
      lastSeenAt: null,
    }
    expect(dispatchEvent(reg, event)).toBe(1)
    expect(self.sent).toEqual([])
    expect(JSON.parse(partner.sent[0])).toMatchObject({
      type: 'presence',
      online: true,
    })
  })

  it('read/delivered: não retornam pro próprio autor do recibo', () => {
    for (const type of ['read', 'delivered'] as const) {
      const reg = createSocketRegistry()
      const author = fakeSocket()
      const sender = fakeSocket()
      reg.add('leitor', author.socket)
      reg.add('remetente', sender.socket)

      const event: RealtimeEvent = {
        type,
        conversationId: 'c1',
        participantIds: ['leitor', 'remetente'],
        userId: 'leitor',
        at: '2026-06-05T12:31:10.000Z',
      }
      expect(dispatchEvent(reg, event)).toBe(1)
      expect(author.sent).toEqual([])
      expect(JSON.parse(sender.sent[0])).toMatchObject({
        type,
        userId: 'leitor',
        at: '2026-06-05T12:31:10.000Z',
      })
    }
  })
})

describe('localDeliveryRecipients', () => {
  it('exclui o remetente e os offline; mantém destinatários online', () => {
    const reg = createSocketRegistry()
    reg.add('remetente', fakeSocket().socket)
    reg.add('online', fakeSocket().socket)
    // 'offline' nunca entra no registro

    const recipients = localDeliveryRecipients(reg, {
      participantIds: ['remetente', 'online', 'offline'],
      senderId: 'remetente',
    })
    expect(recipients).toEqual(['online'])
  })
})
