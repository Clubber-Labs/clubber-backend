import { describe, expect, it } from 'vitest'
import { discoverChatKeks } from './chat-keks'

const VALIDA = Buffer.alloc(32, 0x11).toString('base64')

describe('discoverChatKeks', () => {
  it('descobre quantas versões existirem, sem teto', () => {
    const { keks, invalid } = discoverChatKeks({
      CHAT_KEK_V1: VALIDA,
      CHAT_KEK_V3: VALIDA,
      CHAT_KEK_V17: VALIDA,
      DATABASE_URL: 'postgres://ignorada',
    })

    expect([...keks.keys()].sort((a, b) => a - b)).toEqual([1, 3, 17])
    expect(invalid).toEqual([])
  })

  it('reporta a var que não decodifica para 32 bytes', () => {
    const { keks, invalid } = discoverChatKeks({
      CHAT_KEK_V1: VALIDA,
      CHAT_KEK_V2: 'curta-demais',
    })

    // Nomear a var é o que permite corrigir sem adivinhar qual das N está errada.
    expect(invalid).toEqual(['CHAT_KEK_V2'])
    expect(keks.has(2)).toBe(false)
  })

  it('trata var vazia como ausente, não como inválida', () => {
    // É como o painel do Coolify entrega um campo em branco.
    expect(discoverChatKeks({ CHAT_KEK_V2: '' }).invalid).toEqual([])
  })

  it('ignora nomes parecidos que não são slot de KEK', () => {
    const { keks } = discoverChatKeks({
      CHAT_KEK_V0: VALIDA,
      CHAT_KEK_VX: VALIDA,
      CHAT_KEK_ACTIVE_VERSION: '1',
    })

    expect(keks.size).toBe(0)
  })
})
