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
// fallback determinístico (degradação graciosa), então o teto nunca quebra a
// geração de sugestões; no pior caso troca fatos por card enxuto.
// 40s (era 25s): o payload com 5 reviews/lugar (~10k tokens de entrada em 20
// candidatos) levou a chamada real a 20-30s — 25s derrubava geração legítima
// pro fallback. Pior caso combinado sobe p/ ~104s (2×40 + 2×12), ainda coberto
// pela degradação graciosa.
const ENHANCER_TIMEOUT_MS = 40_000
const COMPOSER_TIMEOUT_MS = 12_000
// O SDK retenta erros transitórios (429/5xx) E timeouts (também são
// APITimeoutError), então o pior caso por chamada é timeout × (maxRetries + 1).
// Enhancer com retry 0: retentar um timeout de 40s raramente salva (a lentidão
// é do payload, não transitória) e dobraria a espera — o pior caso combinado
// do modo perfil (composer 2×12s + enhancer 1×40s = ~64s) precisa caber nos
// 100s em que o Cloudflare corta a espera pela origem (524); com retry seria
// ~104s e o usuário receberia o 524 ANTES do fallback gracioso responder.
// Composer mantém retry 1: tentativa de 12s é barata e o retry de transitório
// (429/5xx, que falha rápido) ainda vale.
const ENHANCER_MAX_RETRIES = 0
const COMPOSER_MAX_RETRIES = 1

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
          maxRetries: ENHANCER_MAX_RETRIES,
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
          maxRetries: COMPOSER_MAX_RETRIES,
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
