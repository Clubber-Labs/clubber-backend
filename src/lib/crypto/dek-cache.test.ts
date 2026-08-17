import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetDekCache,
  conversationDekCacheKey,
  DEK_CACHE_MAX_ENTRIES,
  DEK_CACHE_TTL_MS,
  getCachedDek,
  invalidateDek,
  setCachedDek,
} from './dek-cache'

const CONV = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  __resetDekCache()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  __resetDekCache()
})

describe('getCachedDek/setCachedDek', () => {
  it('devolve a DEK guardada', () => {
    const key = conversationDekCacheKey(CONV, 1)
    const dek = Buffer.alloc(32, 0xab)

    setCachedDek(key, dek)

    expect(getCachedDek(key)?.equals(dek)).toBe(true)
  })

  it('devolve null para chave ausente', () => {
    expect(getCachedDek(conversationDekCacheKey(CONV, 1))).toBeNull()
  })

  it('separa versões da mesma conversa', () => {
    setCachedDek(conversationDekCacheKey(CONV, 1), Buffer.alloc(32, 0x01))
    setCachedDek(conversationDekCacheKey(CONV, 2), Buffer.alloc(32, 0x02))

    expect(getCachedDek(conversationDekCacheKey(CONV, 1))?.[0]).toBe(0x01)
    expect(getCachedDek(conversationDekCacheKey(CONV, 2))?.[0]).toBe(0x02)
  })
})

describe('expiração por TTL', () => {
  it('devolve a DEK antes do TTL e null depois', () => {
    const key = conversationDekCacheKey(CONV, 1)
    setCachedDek(key, Buffer.alloc(32, 0xab))

    vi.advanceTimersByTime(DEK_CACHE_TTL_MS - 1)
    expect(getCachedDek(key)).not.toBeNull()

    vi.advanceTimersByTime(1)
    expect(getCachedDek(key)).toBeNull()
  })
})

describe('invalidateDek', () => {
  it('remove todas as versões da conversa', () => {
    setCachedDek(conversationDekCacheKey(CONV, 1), Buffer.alloc(32, 0x01))
    setCachedDek(conversationDekCacheKey(CONV, 2), Buffer.alloc(32, 0x02))

    invalidateDek(CONV)

    expect(getCachedDek(conversationDekCacheKey(CONV, 1))).toBeNull()
    expect(getCachedDek(conversationDekCacheKey(CONV, 2))).toBeNull()
  })

  it('não afeta outras conversas', () => {
    const outra = '22222222-2222-2222-2222-222222222222'
    setCachedDek(conversationDekCacheKey(CONV, 1), Buffer.alloc(32, 0x01))
    setCachedDek(conversationDekCacheKey(outra, 1), Buffer.alloc(32, 0x02))

    invalidateDek(CONV)

    expect(getCachedDek(conversationDekCacheKey(outra, 1))).not.toBeNull()
  })

  // Um id que é PREFIXO de outro não pode arrastar o vizinho junto — o separador
  // ':' na chave é o que garante isso.
  it('não remove conversa cujo id apenas começa igual', () => {
    setCachedDek(conversationDekCacheKey('abc', 1), Buffer.alloc(32, 0x01))
    setCachedDek(conversationDekCacheKey('abcd', 1), Buffer.alloc(32, 0x02))

    invalidateDek('abc')

    expect(getCachedDek(conversationDekCacheKey('abcd', 1))).not.toBeNull()
  })
})

describe('evicção LRU', () => {
  it('respeita o teto de entradas', () => {
    for (let i = 0; i < DEK_CACHE_MAX_ENTRIES + 10; i++) {
      setCachedDek(conversationDekCacheKey(`conv-${i}`, 1), Buffer.alloc(32, 1))
    }

    // As 10 primeiras saíram; as últimas continuam.
    expect(getCachedDek(conversationDekCacheKey('conv-0', 1))).toBeNull()
    expect(getCachedDek(conversationDekCacheKey('conv-9', 1))).toBeNull()
    expect(getCachedDek(conversationDekCacheKey('conv-10', 1))).not.toBeNull()
  })

  it('um hit protege a entrada da evicção', () => {
    const antiga = conversationDekCacheKey('conv-0', 1)
    setCachedDek(antiga, Buffer.alloc(32, 1))
    for (let i = 1; i < DEK_CACHE_MAX_ENTRIES; i++) {
      setCachedDek(conversationDekCacheKey(`conv-${i}`, 1), Buffer.alloc(32, 1))
    }

    // Acessa a mais antiga, jogando-a para o fim da fila...
    expect(getCachedDek(antiga)).not.toBeNull()
    // ...e então estoura o teto: quem sai é a seguinte, não ela.
    setCachedDek(conversationDekCacheKey('conv-nova', 1), Buffer.alloc(32, 1))

    expect(getCachedDek(antiga)).not.toBeNull()
    expect(getCachedDek(conversationDekCacheKey('conv-1', 1))).toBeNull()
  })
})

describe('__resetDekCache', () => {
  it('esvazia o cache', () => {
    const key = conversationDekCacheKey(CONV, 1)
    setCachedDek(key, Buffer.alloc(32, 0xab))

    __resetDekCache()

    expect(getCachedDek(key)).toBeNull()
  })
})
