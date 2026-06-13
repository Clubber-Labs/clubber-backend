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

  async enhance(
    candidates: PlaceCandidate[],
    _context: EnhanceContext,
  ): Promise<EnhancedCandidate[]> {
    this.calls++
    return [...candidates].reverse().map((c) => ({
      ...c,
      suggestedTitle: `IA: ${c.name}`,
      suggestedDescription: `Sugestão para ${c.category}`,
    }))
  }

  reset(): void {
    this.calls = 0
  }
}

export const fakeEnhancer = new FakeSuggestionEnhancer()
