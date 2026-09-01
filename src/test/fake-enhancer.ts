import type { Locale } from '../lib/i18n/locale'
import type { PlaceCandidate } from '../lib/places'
import type {
  EnhanceContext,
  EnhancedCandidate,
  ISuggestionEnhancer,
} from '../lib/suggestion-ai'

/**
 * Enhancer fake para testes: determinístico e verificável. Inverte a ordem dos
 * candidatos (prova que o service usa o ranqueamento da IA) e marca a copy com
 * prefixo "IA:". Conta chamadas (`calls`) para verificar cache hit. Injetado via
 * setSuggestionEnhancer no setup.ts.
 */
export class FakeSuggestionEnhancer implements ISuggestionEnhancer {
  calls = 0
  lastLocale: Locale | null = null

  async enhance(
    candidates: PlaceCandidate[],
    context: EnhanceContext,
  ): Promise<EnhancedCandidate[]> {
    this.calls++
    this.lastLocale = context.locale
    return [...candidates].reverse().map((c) => ({
      ...c,
      suggestedTitle: `IA: ${c.name}`,
      suggestedDescription: `Sugestão para ${c.name}`,
    }))
  }

  reset(): void {
    this.calls = 0
    this.lastLocale = null
  }
}

export const fakeEnhancer = new FakeSuggestionEnhancer()
