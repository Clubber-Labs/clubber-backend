import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { profileQueryComposerFallbackTotal } from '../metrics'
import { HaikuProfileQueryComposer } from './haiku-query-composer.service'
import { TemplateProfileQueryComposer } from './template-query-composer.service'

/** Lê o valor atual do contador de fallback para um motivo (0 se ausente). */
async function fallbackCount(reason: string): Promise<number> {
  const metric = await profileQueryComposerFallbackTotal.get()
  return metric.values.find((v) => v.labels.reason === reason)?.value ?? 0
}

/** Stub do client da Anthropic: roteiriza o `parsed_output` de messages.parse. */
function stubClient(parsed: unknown, onCall?: (body: unknown) => void) {
  const parse = vi.fn(async (body: unknown) => {
    onCall?.(body)
    return { parsed_output: parsed }
  })
  return {
    client: { messages: { parse } } as unknown as Pick<Anthropic, 'messages'>,
    parse,
  }
}

describe('HaikuProfileQueryComposer.composeProfileQueries', () => {
  it('retorna as frases que a IA compôs', async () => {
    const { client } = stubClient({
      queries: ['restaurante japonês', 'baladas de eletrônica'],
    })

    const result = await new HaikuProfileQueryComposer(
      client,
    ).composeProfileQueries(
      {
        categories: ['Gastronomia', 'Balada'],
        interests: ['Japonesa', 'Eletrônica'],
      },
      'pt-BR',
    )

    expect(result).toEqual(['restaurante japonês', 'baladas de eletrônica'])
  })

  it('manda os rótulos do perfil no payload (não enums/chaves)', async () => {
    let sent: { content: string } | undefined
    const { client } = stubClient({ queries: ['festa'] }, (body) => {
      sent = (body as { messages: { content: string }[] }).messages[0]
    })

    await new HaikuProfileQueryComposer(client).composeProfileQueries(
      {
        categories: ['Balada'],
        interests: ['Funk'],
      },
      'pt-BR',
    )

    const payload = JSON.parse(sent?.content ?? '{}')
    expect(payload.categories).toEqual(['Balada'])
    expect(payload.interests).toEqual(['Funk'])
  })

  it('aplica o teto de 2 frases e deduplica', async () => {
    const { client } = stubClient({
      queries: ['bar', 'bar', 'balada', 'café'],
    })

    const result = await new HaikuProfileQueryComposer(
      client,
    ).composeProfileQueries({ categories: ['Bar'], interests: [] }, 'pt-BR')

    expect(result).toEqual(['bar', 'balada'])
  })

  it('IA sem saída útil cai no fallback determinístico e registra a métrica', async () => {
    const before = await fallbackCount('no_output')
    const { client } = stubClient({ queries: [] })

    const result = await new HaikuProfileQueryComposer(
      client,
    ).composeProfileQueries(
      {
        categories: ['Gastronomia'],
        interests: ['Japonesa'],
      },
      'pt-BR',
    )

    // Fallback: interesses finos antes, depois categorias.
    expect(result).toEqual(['Japonesa', 'Gastronomia'])
    expect(await fallbackCount('no_output')).toBe(before + 1)
  })

  it('falha da IA cai no fallback e registra a métrica de llm_error', async () => {
    const before = await fallbackCount('llm_error')
    const parse = vi.fn(async () => {
      throw new Error('boom')
    })
    const client = {
      messages: { parse },
    } as unknown as Pick<Anthropic, 'messages'>

    const result = await new HaikuProfileQueryComposer(
      client,
    ).composeProfileQueries({ categories: ['Balada'], interests: [] }, 'pt-BR')

    expect(result).toEqual(['Balada'])
    expect(await fallbackCount('llm_error')).toBe(before + 1)
  })
})

describe('TemplateProfileQueryComposer.composeProfileQueries', () => {
  it('usa os rótulos do perfil (interesses antes), dedup e teto de 2', async () => {
    const result =
      await new TemplateProfileQueryComposer().composeProfileQueries(
        {
          categories: ['Gastronomia', 'Balada'],
          interests: ['Japonesa'],
        },
        'pt-BR',
      )

    expect(result).toEqual(['Japonesa', 'Gastronomia'])
  })
})

describe('HaikuProfileQueryComposer.composeIntentQuery', () => {
  it('ancora venue famoso com a cidade e marca anchored (caso Green Valley)', async () => {
    const { client } = stubClient({
      query: 'Green Valley Balneário Camboriú',
      anchored: true,
    })

    const result = await new HaikuProfileQueryComposer(
      client,
    ).composeIntentQuery('quero um rolê na green valley', 'pt-BR')

    expect(result).toEqual({
      query: 'Green Valley Balneário Camboriú',
      anchored: true,
    })
  })

  it('reescrita de gênero devolve a query nova SEM ancorar', async () => {
    const { client } = stubClient({ query: 'balada de funk', anchored: false })

    const result = await new HaikuProfileQueryComposer(
      client,
    ).composeIntentQuery('balada com megafunk', 'pt-BR')

    expect(result).toEqual({ query: 'balada de funk', anchored: false })
  })

  it('o prompt manda gênero virar busca de venue e subgênero virar o gênero-mãe', async () => {
    const { client, parse } = stubClient({ query: 'bar', anchored: false })

    await new HaikuProfileQueryComposer(client).composeIntentQuery(
      'balada techno',
      'pt-BR',
    )

    const system = (parse.mock.calls[0]?.[0] as { system: string }).system
    expect(system).toContain('SUBGÊNERO vira o gênero-mãe')
    expect(system).toContain('loja, escola ou curso')
    // A ancoragem é decisão do modelo, mas a semântica fica gravada no prompt:
    // reescrita de gênero nunca desliga o teto de distância.
    expect(system).toContain('NÃO é ancoragem')
  })

  it('o prompt manda cena/vibe virar termo indexável, nunca a query literal', async () => {
    const { client, parse } = stubClient({
      query: 'club de música alternativa',
      anchored: false,
    })

    await new HaikuProfileQueryComposer(client).composeIntentQuery(
      'balada underground',
      'pt-BR',
    )

    const system = (parse.mock.calls[0]?.[0] as { system: string }).system
    // Caso real: "balada underground" literal acha 0-1 lugar; o termo de cena
    // precisa virar a busca que o Google indexa.
    expect(system).toContain('CENA/vibe')
    expect(system).toContain('club de música alternativa')
  })

  it('IA sem saída útil devolve o texto original sem ancorar', async () => {
    const { client } = stubClient({ query: '   ', anchored: true })

    const result = await new HaikuProfileQueryComposer(
      client,
    ).composeIntentQuery('bar com música ao vivo', 'pt-BR')

    expect(result).toEqual({ query: 'bar com música ao vivo', anchored: false })
  })

  it('falha da IA devolve o texto original sem ancorar (nunca quebra a geração)', async () => {
    const parse = vi.fn().mockRejectedValue(new Error('down'))
    const client = { messages: { parse } } as unknown as Pick<
      Anthropic,
      'messages'
    >

    const result = await new HaikuProfileQueryComposer(
      client,
    ).composeIntentQuery('green valley', 'pt-BR')

    expect(result).toEqual({ query: 'green valley', anchored: false })
  })
})

describe('TemplateProfileQueryComposer.composeIntentQuery', () => {
  it('sem IA, o texto passa inalterado e nunca ancora', async () => {
    const result = await new TemplateProfileQueryComposer().composeIntentQuery(
      'green valley',
      'pt-BR',
    )
    expect(result).toEqual({ query: 'green valley', anchored: false })
  })
})

describe('HaikuProfileQueryComposer — idioma da query composta', () => {
  const LOCALES = ['pt-BR', 'en', 'es'] as const
  const NAMED = {
    'pt-BR': 'português do Brasil',
    en: 'inglês',
    es: 'espanhol',
  } as const

  function systemOf(parse: ReturnType<typeof stubClient>['parse']): string {
    return (parse.mock.calls[0]?.[0] as { system: string }).system
  }

  // A saída daqui não é lida por ninguém — vai como query para o Google —,
  // então o locale só tem um jeito de fazer efeito: nomear o idioma dentro do
  // prompt. Se a interpolação sumir, a busca volta a sair em português para
  // todo mundo sem nada quebrar: nenhum tipo cai e nenhuma resposta muda de
  // forma. Daí as duas direções: nomear o pedido E não nomear os outros.
  it('o prompt do perfil nomeia o idioma pedido e nenhum outro', async () => {
    for (const locale of LOCALES) {
      const { client, parse } = stubClient({ queries: ['bar'] })

      await new HaikuProfileQueryComposer(client).composeProfileQueries(
        { categories: ['Balada'], interests: ['Funk'] },
        locale,
      )

      const system = systemOf(parse)
      expect(system).toContain(NAMED[locale])
      for (const other of LOCALES.filter((l) => l !== locale)) {
        expect(system).not.toContain(NAMED[other])
      }
    }
  })

  it('o prompt da intenção nomeia o idioma pedido e nenhum outro', async () => {
    for (const locale of LOCALES) {
      const { client, parse } = stubClient({ query: 'bar' })

      await new HaikuProfileQueryComposer(client).composeIntentQuery(
        'bar com música ao vivo',
        locale,
      )

      const system = systemOf(parse)
      expect(system).toContain(NAMED[locale])
      for (const other of LOCALES.filter((l) => l !== locale)) {
        expect(system).not.toContain(NAMED[other])
      }
    }
  })
})
