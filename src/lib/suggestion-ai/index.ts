import Anthropic from '@anthropic-ai/sdk'
import { env } from '../env'
import { HaikuSuggestionEnhancer } from './haiku-enhancer.service'
import type { ISuggestionEnhancer } from './suggestion-enhancer.interface'
import { TemplateSuggestionEnhancer } from './template-enhancer.service'

let instance: ISuggestionEnhancer | null = null

/**
 * Resolve o enhancer pela env (lazy). Com ANTHROPIC_API_KEY usa o Haiku; sem
 * ela, o template determinístico (degradação graciosa, NÃO erro — diferente do
 * Places). Chame dentro do service para o setSuggestionEnhancer dos testes vencer.
 */
export function getSuggestionEnhancer(): ISuggestionEnhancer {
  if (instance) return instance
  instance = env.ANTHROPIC_API_KEY
    ? new HaikuSuggestionEnhancer(
        new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }),
      )
    : new TemplateSuggestionEnhancer()
  return instance
}

/** Permite injetar um enhancer customizado em testes. */
export function setSuggestionEnhancer(enhancer: ISuggestionEnhancer): void {
  instance = enhancer
}

export * from './suggestion-enhancer.interface'
