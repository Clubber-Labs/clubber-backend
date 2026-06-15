import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { suggestionsEnhancerFallbackTotal } from '../metrics'
import type { PlaceCandidate } from '../places'
import { HaikuSuggestionEnhancer } from './haiku-enhancer.service'

/** Lê o valor atual do contador de fallback para um motivo (0 se ausente). */
async function fallbackCount(reason: string): Promise<number> {
  const metric = await suggestionsEnhancerFallbackTotal.get()
  return metric.values.find((v) => v.labels.reason === reason)?.value ?? 0
}

function candidate(over: Partial<PlaceCandidate> = {}): PlaceCandidate {
  return {
    placeId: 'p1',
    name: 'Lugar',
    latitude: -23.56,
    longitude: -46.65,
    category: 'ART',
    address: null,
    rating: 4.5,
    userRatingCount: 100,
    priceLevel: null,
    openNow: true,
    distanceMeters: 200,
    ...over,
  }
}

/** Stub do client da Anthropic: roteiriza o `parsed_output` de messages.parse. */
function stubClient(ranked: unknown, onCall?: (body: unknown) => void) {
  const parse = vi.fn(async (body: unknown) => {
    onCall?.(body)
    return { parsed_output: ranked }
  })
  return {
    client: { messages: { parse } } as unknown as Pick<Anthropic, 'messages'>,
    parse,
  }
}

const ctx = { preferredCategories: ['ART' as const] }

describe('HaikuSuggestionEnhancer.enhance', () => {
  it('honra a ordem da IA e escreve a copy', async () => {
    const a = candidate({ placeId: 'a', name: 'A' })
    const b = candidate({ placeId: 'b', name: 'B' })
    const { client } = stubClient({
      ranked: [
        { placeId: 'b', title: 'Rolê no B', description: 'desc B' },
        { placeId: 'a', title: 'Rolê no A', description: null },
      ],
    })

    const result = await new HaikuSuggestionEnhancer(client).enhance(
      [a, b],
      ctx,
    )

    expect(result.map((r) => r.placeId)).toEqual(['b', 'a'])
    expect(result[0].suggestedTitle).toBe('Rolê no B')
    expect(result[0].suggestedDescription).toBe('desc B')
    expect(result[1].suggestedDescription).toBeNull()
  })

  it('descarta candidatos que a IA omite (filtra)', async () => {
    const a = candidate({ placeId: 'a' })
    const b = candidate({ placeId: 'b' })
    const c = candidate({ placeId: 'c' })
    const { client } = stubClient({
      ranked: [{ placeId: 'a', title: 'só o A', description: null }],
    })

    const result = await new HaikuSuggestionEnhancer(client).enhance(
      [a, b, c],
      ctx,
    )

    expect(result.map((r) => r.placeId)).toEqual(['a'])
  })

  it('piso: se a IA descarta tudo, mantém todos com copy de template', async () => {
    const a = candidate({ placeId: 'a', name: 'A' })
    const b = candidate({ placeId: 'b', name: 'B' })
    const { client } = stubClient({ ranked: [] })

    const result = await new HaikuSuggestionEnhancer(client).enhance(
      [a, b],
      ctx,
    )

    expect(result.map((r) => r.placeId)).toEqual(['a', 'b'])
    expect(result[0].suggestedTitle).toBe('Bora um rolê no A?')
  })

  it('ignora placeId alucinado que não está nos candidatos', async () => {
    const a = candidate({ placeId: 'a' })
    const { client } = stubClient({
      ranked: [
        { placeId: 'fantasma', title: 'x', description: null },
        { placeId: 'a', title: 'real', description: null },
      ],
    })

    const result = await new HaikuSuggestionEnhancer(client).enhance([a], ctx)

    expect(result.map((r) => r.placeId)).toEqual(['a'])
  })

  it('falha da IA cai no template e registra a métrica de fallback', async () => {
    const before = await fallbackCount('llm_error')
    const a = candidate({ placeId: 'a', name: 'A' })
    const parse = vi.fn(async () => {
      throw new Error('boom')
    })
    const client = {
      messages: { parse },
    } as unknown as Pick<Anthropic, 'messages'>

    const result = await new HaikuSuggestionEnhancer(client).enhance([a], ctx)

    expect(result).toHaveLength(1)
    expect(result[0].suggestedTitle).toBe('Bora um rolê no A?')
    // O fallback silencioso agora é observável (alarme de IA offline).
    expect(await fallbackCount('llm_error')).toBe(before + 1)
  })

  it('manda os sinais (distância, rating, aberto-agora) no payload da IA', async () => {
    let sent: { content: string } | undefined
    const { client } = stubClient({ ranked: [] }, (body) => {
      const messages = (body as { messages: { content: string }[] }).messages
      sent = messages[0]
    })

    await new HaikuSuggestionEnhancer(client).enhance(
      [
        candidate({
          placeId: 'a',
          rating: 4.8,
          distanceMeters: 350,
          openNow: false,
        }),
      ],
      ctx,
    )

    const payload = JSON.parse(sent?.content ?? '{}')
    expect(payload.places[0].distanceMeters).toBe(350)
    expect(payload.places[0].rating).toBe(4.8)
    expect(payload.places[0].openNow).toBe(false)
  })

  it('inclui o intent no payload quando presente', async () => {
    let sent: { content: string } | undefined
    const { client } = stubClient({ ranked: [] }, (body) => {
      sent = (body as { messages: { content: string }[] }).messages[0]
    })

    await new HaikuSuggestionEnhancer(client).enhance([candidate()], {
      preferredCategories: [],
      intent: 'bar com música ao vivo',
    })

    const payload = JSON.parse(sent?.content ?? '{}')
    expect(payload.intent).toBe('bar com música ao vivo')
  })
})
