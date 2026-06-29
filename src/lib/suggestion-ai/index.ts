import Anthropic from '@anthropic-ai/sdk'
import { env } from '../env'
import { AiSuggestionEnhancer } from './ai-enhancer.service'
import { HaikuProfileQueryComposer } from './haiku-query-composer.service'
import type { IProfileQueryComposer } from './profile-query-composer.interface'
import type { ISuggestionEnhancer } from './suggestion-enhancer.interface'
import { TemplateSuggestionEnhancer } from './template-enhancer.service'
import { TemplateProfileQueryComposer } from './template-query-composer.service'

// Timeout POR TENTATIVA (ms) das chamadas inline ao Claude em /spots/suggestions.
// O SDK Anthropic tem timeout default de 10 min E ainda RETENTA timeouts
// (maxRetries default 2) — pior caso ~30 min com o handler Fastify pendurado.
// Limitamos os dois: o enhancer (Sonnet, até 2048 tokens) ganha mais folga que
// o composer (Haiku, saída curta). Qualquer falha — incl. timeout — cai no
// template determinístico (degradação graciosa), então o teto nunca quebra a
// geração de sugestões; no pior caso troca IA por template.
const ENHANCER_TIMEOUT_MS = 25_000
const COMPOSER_TIMEOUT_MS = 12_000
// maxRetries 1: o SDK retenta erros transitórios (429/5xx) E timeouts (também são
// APITimeoutError). Logo o pior caso por chamada é timeout × (maxRetries + 1); e
// como o modo perfil chama composer e enhancer em sequência (spots.service), a
// espera combinada chega a ~74s antes de cair no template — ainda assim ordens de
// grandeza melhor que os ~30 min do default (maxRetries 2). maxRetries 0 cortaria
// o teto pela metade (~37s) abrindo mão do retry de transitório — decisão de SLA.
const AI_MAX_RETRIES = 1

let instance: ISuggestionEnhancer | null = null

/**
 * Resolve o enhancer pela env (lazy). Com ANTHROPIC_API_KEY usa o Sonnet
 * (AiSuggestionEnhancer, ver MODEL); sem ela, o template determinístico
 * (degradação graciosa, NÃO erro — diferente do Places). Chame dentro do service
 * para o setSuggestionEnhancer dos testes vencer.
 */
export function getSuggestionEnhancer(): ISuggestionEnhancer {
  if (instance) return instance
  instance = env.ANTHROPIC_API_KEY
    ? new AiSuggestionEnhancer(
        new Anthropic({
          apiKey: env.ANTHROPIC_API_KEY,
          timeout: ENHANCER_TIMEOUT_MS,
          maxRetries: AI_MAX_RETRIES,
        }),
      )
    : new TemplateSuggestionEnhancer()
  return instance
}

/** Permite injetar um enhancer customizado em testes. */
export function setSuggestionEnhancer(enhancer: ISuggestionEnhancer): void {
  instance = enhancer
}

let composerInstance: IProfileQueryComposer | null = null

/**
 * Resolve o composer de query pela env (lazy). Com ANTHROPIC_API_KEY usa o Haiku;
 * sem ela, o template determinístico (degradação graciosa). Chame dentro do
 * service para o setProfileQueryComposer dos testes vencer.
 */
export function getProfileQueryComposer(): IProfileQueryComposer {
  if (composerInstance) return composerInstance
  composerInstance = env.ANTHROPIC_API_KEY
    ? new HaikuProfileQueryComposer(
        new Anthropic({
          apiKey: env.ANTHROPIC_API_KEY,
          timeout: COMPOSER_TIMEOUT_MS,
          maxRetries: AI_MAX_RETRIES,
        }),
      )
    : new TemplateProfileQueryComposer()
  return composerInstance
}

/** Permite injetar um composer customizado em testes. */
export function setProfileQueryComposer(composer: IProfileQueryComposer): void {
  composerInstance = composer
}

export * from './profile-query-composer.interface'
export * from './suggestion-enhancer.interface'
