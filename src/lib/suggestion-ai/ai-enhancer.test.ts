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
  it('honra a ordem da IA e escreve a copy', async () => {
    const a = candidate({ placeId: 'a', name: 'A' })
    const b = candidate({ placeId: 'b', name: 'B' })
    const { client } = stubClient({
      ranked: [
        { placeId: 'b', title: 'Rolê no B', description: 'desc B' },
        { placeId: 'a', title: 'Rolê no A', description: '' },
      ],
    })

    const result = await new AiSuggestionEnhancer(client).enhance([a, b], ctx)

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
      ranked: [{ placeId: 'a', title: 'só o A', description: '' }],
    })

    const result = await new AiSuggestionEnhancer(client).enhance(
      [a, b, c],
      ctx,
    )

    expect(result.map((r) => r.placeId)).toEqual(['a'])
  })

  it('piso: se a IA descarta tudo, mantém todos com copy de template', async () => {
    const a = candidate({ placeId: 'a', name: 'A' })
    const b = candidate({ placeId: 'b', name: 'B' })
    const { client } = stubClient({ ranked: [] })

    const result = await new AiSuggestionEnhancer(client).enhance([a, b], ctx)

    expect(result.map((r) => r.placeId)).toEqual(['a', 'b'])
    expect(result[0].suggestedTitle).toBe('Bora um rolê no A?')
  })

  it('ignora placeId alucinado que não está nos candidatos', async () => {
    const a = candidate({ placeId: 'a' })
    const { client } = stubClient({
      ranked: [
        { placeId: 'fantasma', title: 'x', description: '' },
        { placeId: 'a', title: 'real', description: '' },
      ],
    })

    const result = await new AiSuggestionEnhancer(client).enhance([a], ctx)

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

    const result = await new AiSuggestionEnhancer(client).enhance([a], ctx)

    expect(result).toHaveLength(1)
    expect(result[0].suggestedTitle).toBe('Bora um rolê no A?')
    // O fallback silencioso agora é observável (alarme de IA offline).
    expect(await fallbackCount('llm_error')).toBe(before + 1)
  })

  it('manda só os sinais de ranqueamento (distância, notoriedade); nota/preço/aberto ficam fora', async () => {
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
        }),
      ],
      ctx,
    )

    const payload = JSON.parse(sent?.content ?? '{}')
    // Entram no ranqueamento: distância (desempate fraco) e notoriedade.
    expect(payload.places[0].distanceMeters).toBe(350)
    expect(payload.places[0].userRatingCount).toBe(250)
    // Fora do ranqueamento (mas seguem no candidato/saída).
    expect(payload.places[0].rating).toBeUndefined()
    expect(payload.places[0].openNow).toBeUndefined()
    expect(payload.places[0].priceLevel).toBeUndefined()
    // category/subcategory saíram do payload (eram sinal ruidoso inferido).
    expect(payload.places[0].category).toBeUndefined()
    expect(payload.places[0].subcategory).toBeUndefined()
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

describe('AiSuggestionEnhancer — description obrigatória', () => {
  // O `null` na description era uma saída de emergência do prompt; com as
  // regras restritivas de copy a IA passou a usá-la como padrão e as sugestões
  // ficaram sem descrição. O contrato de saída (schema enviado à API) fecha a
  // porta: a gramática do structured output não oferece `null` ao modelo.
  it('o schema de saída enviado à API exige description como string', async () => {
    const { client, parse } = stubClient({ ranked: [] })

    await new AiSuggestionEnhancer(client).enhance([candidate()], ctx)

    const body = parse.mock.calls[0]?.[0] as {
      output_config: { format: { schema: unknown } }
    }
    const items = (
      body.output_config.format.schema as {
        properties: {
          ranked: { items: { properties: { description: unknown } } }
        }
      }
    ).properties.ranked.items
    expect(items.properties.description).toEqual({ type: 'string' })
  })

  it('o prompt pede a description sempre — sem saída null nem veto ao tipo do lugar', async () => {
    const { client, parse } = stubClient({ ranked: [] })

    await new AiSuggestionEnhancer(client).enhance([candidate()], ctx)

    const system = (parse.mock.calls[0]?.[0] as { system: string }).system
    expect(system).not.toContain('use null')
    expect(system).not.toContain('nunca presuma o tipo do lugar')
    expect(system).toContain('SEMPRE escreva a "description"')
  })

  it('description em branco vinda da IA vira null (o front esconde o balão)', async () => {
    const { client } = stubClient({
      ranked: [{ placeId: 'p1', title: 'Bora?', description: '   ' }],
    })

    const result = await new AiSuggestionEnhancer(client).enhance(
      [candidate()],
      ctx,
    )

    expect(result[0].suggestedDescription).toBeNull()
  })
})

describe('AiSuggestionEnhancer — idioma da copy', () => {
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
    }
  })

  // Cair de IA para template é degradação de qualidade; não pode ser também
  // degradação de idioma — quem pediu em inglês continua lendo inglês.
  it('o fallback por falha da IA respeita o idioma do pedido', async () => {
    const parse = vi.fn(async () => {
      throw new Error('LLM fora')
    })
    const client = { messages: { parse } } as unknown as Pick<
      Anthropic,
      'messages'
    >

    const result = await new AiSuggestionEnhancer(client).enhance(
      [candidate({ name: 'Bar do Zé' })],
      { criterion: 'arte', locale: 'en' },
    )

    expect(result[0].suggestedTitle).toBe('Down for Bar do Zé?')
  })
})
