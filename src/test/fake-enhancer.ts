import type { Locale } from '../lib/i18n/locale'
import type { PlaceCandidate } from '../lib/places'
import type {
  EnhanceContext,
  EnhancedCandidate,
  ISuggestionEnhancer,
} from '../lib/suggestion-ai'

/**
 * Enhancer fake para testes: determinístico e verificável. Inverte a ordem dos
 * candidatos (prova que o service usa o ranqueamento da IA) e marca os fatos
 * com prefixo "IA:". Conta chamadas (`calls`) para verificar cache hit.
 * Injetado via setSuggestionEnhancer no setup.ts.
 */
export class FakeSuggestionEnhancer implements ISuggestionEnhancer {
  calls = 0
  lastLocale: Locale | null = null
  lastCriterion: string | null = null

  async enhance(
    candidates: PlaceCandidate[],
    context: EnhanceContext,
  ): Promise<EnhancedCandidate[]> {
    this.calls++
    this.lastLocale = context.locale
    this.lastCriterion = context.criterion
    return [...candidates].reverse().map((c) => {
      const { reviews: _reviews, ...rest } = c
      return {
        ...rest,
        about: `IA: ${c.name}`,
        highlights: [`Fato sobre ${c.name}`],
      }
    })
  }

  reset(): void {
    this.calls = 0
    this.lastLocale = null
    this.lastCriterion = null
  }
}

export const fakeEnhancer = new FakeSuggestionEnhancer()
