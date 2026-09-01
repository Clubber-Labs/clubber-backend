import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { suggestionsEnhancerFallbackTotal } from '../metrics'
import type { PlaceCandidate } from '../places'
import { AiSuggestionEnhancer } from './ai-enhancer.service'

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
    types: ['museum'],
    address: null,
    rating: 4.5,
    userRatingCount: 100,
    priceLevel: null,
    openNow: true,
    distanceMeters: 200,
    reviews: [],
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

const ctx = { criterion: 'arte', locale: 'pt-BR' as const }

describe('AiSuggestionEnhancer.enhance', () => {
  it('honra a ordem da IA e devolve os fatos do estabelecimento', async () => {
    const a = candidate({ placeId: 'a', name: 'A' })
    const b = candidate({ placeId: 'b', name: 'B' })
    const { client } = stubClient({
      ranked: [
        {
          placeId: 'b',
          about: 'Bar com música ao vivo em dois níveis',
          highlights: ['Banda de sexta e sábado'],
        },
        { placeId: 'a', about: 'Club noturno no centro', highlights: [] },
      ],
    })

    const result = await new AiSuggestionEnhancer(client).enhance([a, b], ctx)

    expect(result.map((r) => r.placeId)).toEqual(['b', 'a'])
    expect(result[0].about).toBe('Bar com música ao vivo em dois níveis')
    expect(result[0].highlights).toEqual(['Banda de sexta e sábado'])
    expect(result[1].highlights).toEqual([])
  })

  it('nunca devolve reviews no candidato enriquecido (insumo interno)', async () => {
    const a = candidate({ placeId: 'a', reviews: ['ótimo lugar'] })
    const { client } = stubClient({
      ranked: [{ placeId: 'a', about: 'Bar', highlights: [] }],
    })

    const result = await new AiSuggestionEnhancer(client).enhance([a], ctx)

    expect('reviews' in result[0]).toBe(false)
  })

  it('sanitiza fatos violados: highlight banido some, about banido vira null', async () => {
    const a = candidate({ placeId: 'a' })
    const { client } = stubClient({
      ranked: [
        {
          placeId: 'a',
          // Vazamentos reais da probe: reputação no about, identidade e
          // depreciação nos highlights — o sanitizador é a garantia final.
          about: 'Club elogiado como o melhor da cena',
          highlights: [
            'Banda de sexta e sábado',
            'Casa da cena LGBT',
            'Drinks bem avaliados',
            'Pista pequena que fica apertada',
          ],
        },
      ],
    })

    const result = await new AiSuggestionEnhancer(client).enhance([a], ctx)

    expect(result[0].about).toBeNull()
    expect(result[0].highlights).toEqual(['Banda de sexta e sábado'])
  })

  it('aplica os tetos do contrato: about 140, highlight 55, máx. 5 itens', async () => {
    const a = candidate({ placeId: 'a' })
    const { client } = stubClient({
      ranked: [
        {
          placeId: 'a',
          about: 'x'.repeat(200),
          highlights: Array.from({ length: 7 }, (_, i) =>
            `fato ${i} `.padEnd(80, 'y'),
          ),
        },
      ],
    })

    const result = await new AiSuggestionEnhancer(client).enhance([a], ctx)

    expect(result[0].about?.length).toBeLessThanOrEqual(140)
    expect(result[0].highlights).toHaveLength(5)
    for (const h of result[0].highlights) {
      expect(h.length).toBeLessThanOrEqual(55)
    }
  })

  it('descarta candidatos que a IA omite (filtra)', async () => {
    const a = candidate({ placeId: 'a' })
    const b = candidate({ placeId: 'b' })
    const c = candidate({ placeId: 'c' })
    const { client } = stubClient({
      ranked: [{ placeId: 'a', about: 'só o A', highlights: [] }],
    })

    const result = await new AiSuggestionEnhancer(client).enhance(
      [a, b, c],
      ctx,
    )

    expect(result.map((r) => r.placeId)).toEqual(['a'])
  })

  it('piso: se a IA descarta tudo, mantém todos sem fatos (about null)', async () => {
    const a = candidate({ placeId: 'a', name: 'A' })
    const b = candidate({ placeId: 'b', name: 'B' })
    const { client } = stubClient({ ranked: [] })

    const result = await new AiSuggestionEnhancer(client).enhance([a, b], ctx)

    expect(result.map((r) => r.placeId)).toEqual(['a', 'b'])
    expect(result[0].about).toBeNull()
    expect(result[0].highlights).toEqual([])
  })

  it('ignora placeId alucinado que não está nos candidatos', async () => {
    const a = candidate({ placeId: 'a' })
    const { client } = stubClient({
      ranked: [
        { placeId: 'fantasma', about: 'x', highlights: [] },
        { placeId: 'a', about: 'real', highlights: [] },
      ],
    })

    const result = await new AiSuggestionEnhancer(client).enhance([a], ctx)

    expect(result.map((r) => r.placeId)).toEqual(['a'])
  })

  it('falha da IA cai no fallback sem fatos e registra a métrica', async () => {
    const before = await fallbackCount('llm_error')
    const a = candidate({ placeId: 'a', name: 'A' })
    const parse = vi.fn(async () => {
      throw new Error('boom')
    })
    const client = {
      messages: { parse },
    } as unknown as Pick<Anthropic, 'messages'>

    const result = await new AiSuggestionEnhancer(client).enhance([a], ctx)

    expect(result).toHaveLength(1)
    expect(result[0].about).toBeNull()
    expect(result[0].highlights).toEqual([])
    // O fallback silencioso é observável (alarme de IA offline).
    expect(await fallbackCount('llm_error')).toBe(before + 1)
  })

  it('manda distância, notoriedade e reviews truncadas; nota/preço/aberto ficam fora', async () => {
    let sent: { content: string } | undefined
    const { client } = stubClient({ ranked: [] }, (body) => {
      const messages = (body as { messages: { content: string }[] }).messages
      sent = messages[0]
    })

    await new AiSuggestionEnhancer(client).enhance(
      [
        candidate({
          placeId: 'a',
          rating: 4.8,
          userRatingCount: 250,
          priceLevel: 'PRICE_LEVEL_EXPENSIVE',
          distanceMeters: 350,
          openNow: false,
          reviews: ['r1', 'r2', 'x'.repeat(400), 'r4', 'r5'],
        }),
      ],
      ctx,
    )

    const payload = JSON.parse(sent?.content ?? '{}')
    // Entram no ranqueamento: distância, notoriedade e a fatia de reviews
    // (3 por lugar, 250 chars cada — evidência de aderência e fonte dos fatos).
    expect(payload.places[0].distanceMeters).toBe(350)
    expect(payload.places[0].userRatingCount).toBe(250)
    expect(payload.places[0].reviews).toHaveLength(3)
    expect(payload.places[0].reviews[2].length).toBeLessThanOrEqual(250)
    // Fora do ranqueamento (mas seguem no candidato/saída).
    expect(payload.places[0].rating).toBeUndefined()
    expect(payload.places[0].openNow).toBeUndefined()
    expect(payload.places[0].priceLevel).toBeUndefined()
  })

  it('inclui o criterion no payload (sinal único de ranqueamento)', async () => {
    let sent: { content: string } | undefined
    const { client } = stubClient({ ranked: [] }, (body) => {
      sent = (body as { messages: { content: string }[] }).messages[0]
    })

    await new AiSuggestionEnhancer(client).enhance([candidate()], {
      criterion: 'bar com música ao vivo',
      locale: 'pt-BR' as const,
    })

    const payload = JSON.parse(sent?.content ?? '{}')
    expect(payload.criterion).toBe('bar com música ao vivo')
  })
})

describe('AiSuggestionEnhancer — idioma e regras do prompt', () => {
  it('manda o bloco de voz do locale pedido, e só ele', async () => {
    const { client, parse } = stubClient({ ranked: [] })

    await new AiSuggestionEnhancer(client).enhance([candidate()], {
      criterion: 'arte',
      locale: 'es',
    })

    const system = (parse.mock.calls[0]?.[0] as { system: string }).system
    expect(system).toContain('escribe en español')
    expect(system).not.toContain('write in English')
    expect(system).not.toContain('escreva em português do Brasil')
  })

  it('as regras de produto vão nos três idiomas — só a voz muda', async () => {
    const systems = await Promise.all(
      (['pt-BR', 'en', 'es'] as const).map(async (locale) => {
        const { client, parse } = stubClient({ ranked: [] })
        await new AiSuggestionEnhancer(client).enhance([candidate()], {
          criterion: 'arte',
          locale,
        })
        return (parse.mock.calls[0]?.[0] as { system: string }).system
      }),
    )

    // Se uma regra vivesse dentro do bloco de idioma, ela sumiria em dois dos
    // três prompts — é o que esta separação existe para impedir.
    for (const system of systems) {
      expect(system).toContain('SEMPRE descarte conteúdo adulto/sexual')
      expect(system).toContain('NUNCA mencione nota')
      expect(system).toContain('SEGURANÇA')
      // Decisões de produto das sugestões factuais (probe 2026-09-01).
      expect(system).toContain('público mais alternativo')
      expect(system).toContain('NADA QUE PREJUDIQUE O ESTABELECIMENTO')
      expect(system).toContain('REVIEWS são EVIDÊNCIA')
    }
  })
})
