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
  it('ancora venue famoso com a cidade (caso Green Valley)', async () => {
    const { client } = stubClient({ query: 'Green Valley Balneário Camboriú' })

    const result = await new HaikuProfileQueryComposer(
      client,
    ).composeIntentQuery('quero um rolê na green valley', 'pt-BR')

    expect(result).toBe('Green Valley Balneário Camboriú')
  })

  it('IA sem saída útil devolve o texto original', async () => {
    const { client } = stubClient({ query: '   ' })

    const result = await new HaikuProfileQueryComposer(
      client,
    ).composeIntentQuery('bar com música ao vivo', 'pt-BR')

    expect(result).toBe('bar com música ao vivo')
  })

  it('falha da IA devolve o texto original (nunca quebra a geração)', async () => {
    const parse = vi.fn().mockRejectedValue(new Error('down'))
    const client = { messages: { parse } } as unknown as Pick<
      Anthropic,
      'messages'
    >

    const result = await new HaikuProfileQueryComposer(
      client,
    ).composeIntentQuery('green valley', 'pt-BR')

    expect(result).toBe('green valley')
  })
})

describe('TemplateProfileQueryComposer.composeIntentQuery', () => {
  it('sem IA, o texto passa inalterado', async () => {
    const result = await new TemplateProfileQueryComposer().composeIntentQuery(
      'green valley',
      'pt-BR',
    )
    expect(result).toBe('green valley')
  })
})
