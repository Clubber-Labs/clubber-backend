import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { logger } from '../logger'
import type { PlaceCandidate } from '../places'
import type {
  EnhanceContext,
  EnhancedCandidate,
  ISuggestionEnhancer,
} from './suggestion-enhancer.interface'
import { templateTitle } from './template-enhancer.service'

const MODEL = 'claude-haiku-4-5'
const MAX_TOKENS = 2048

const SYSTEM = `Você cura "rolês" (encontros sociais) num app de mapa. Recebe uma lista de lugares reais e as categorias preferidas do usuário. Sua tarefa:
1. Ordene os lugares do mais relevante ao menos relevante para essas preferências.
2. Para cada um, escreva um "title" curto e convidativo em português, no estilo de um convite para um rolê (ex.: "Bora um happy hour no Hop'n'Roll?"), com no máximo 60 caracteres.
3. Opcionalmente, uma "description" curta (1 frase) ou null.
Responda APENAS no formato estruturado, repetindo o placeId de cada lugar.`

const outputSchema = z.object({
  ranked: z.array(
    z.object({
      placeId: z.string(),
      title: z.string(),
      description: z.string().nullable(),
    }),
  ),
})

function fallback(candidates: PlaceCandidate[]): EnhancedCandidate[] {
  return candidates.map((c) => ({
    ...c,
    suggestedTitle: templateTitle(c.name),
    suggestedDescription: null,
  }))
}

/**
 * Enhancer via Claude Haiku: ranqueia + escreve a copy numa única chamada
 * (structured output). Resiliente: qualquer falha da IA cai no template, então
 * a geração de sugestões nunca quebra por causa do LLM.
 */
export class HaikuSuggestionEnhancer implements ISuggestionEnhancer {
  private readonly client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async enhance(
    candidates: PlaceCandidate[],
    context: EnhanceContext,
  ): Promise<EnhancedCandidate[]> {
    if (candidates.length === 0) return []

    try {
      const payload = {
        preferredCategories: context.preferredCategories,
        places: candidates.map((c) => ({
          placeId: c.placeId,
          name: c.name,
          category: c.category,
        })),
      }
      const response = await this.client.messages.parse({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
        output_config: { format: zodOutputFormat(outputSchema) },
      })

      const parsed = response.parsed_output
      if (!parsed) return fallback(candidates)

      const byId = new Map(candidates.map((c) => [c.placeId, c]))
      const result: EnhancedCandidate[] = []
      for (const item of parsed.ranked) {
        const candidate = byId.get(item.placeId)
        if (!candidate) continue
        byId.delete(item.placeId)
        result.push({
          ...candidate,
          suggestedTitle: item.title,
          suggestedDescription: item.description,
        })
      }
      // Candidatos que a IA não devolveu entram no fim com copy de template.
      for (const leftover of byId.values()) {
        result.push({
          ...leftover,
          suggestedTitle: templateTitle(leftover.name),
          suggestedDescription: null,
        })
      }
      return result
    } catch (err) {
      logger.warn({ err }, 'enhance via Haiku falhou — usando template')
      return fallback(candidates)
    }
  }
}
