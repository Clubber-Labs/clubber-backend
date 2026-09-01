import type { PlaceCandidate } from '../places'
import type {
  EnhanceContext,
  EnhancedCandidate,
  ISuggestionEnhancer,
} from './suggestion-enhancer.interface'

/**
 * Enhancer determinístico (sem IA): mantém a ordem do Places e devolve o card
 * sem fatos (about null, highlights vazios) — melhor enxuto que inventado. É a
 * degradação graciosa quando não há chave da Anthropic.
 */
export class TemplateSuggestionEnhancer implements ISuggestionEnhancer {
  async enhance(
    candidates: PlaceCandidate[],
    _context: EnhanceContext,
  ): Promise<EnhancedCandidate[]> {
    return candidates.map((c) => {
      const { reviews: _reviews, ...rest } = c
      return { ...rest, about: null, highlights: [] }
    })
  }
}
