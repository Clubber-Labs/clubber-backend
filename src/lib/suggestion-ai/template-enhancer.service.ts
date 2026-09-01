import type { Locale } from '../i18n/locale'
import { t } from '../i18n/translate'
import type { PlaceCandidate } from '../places'
import type {
  EnhanceContext,
  EnhancedCandidate,
  ISuggestionEnhancer,
} from './suggestion-enhancer.interface'

/** Copy determinística por template — usada sem ANTHROPIC_API_KEY e como
 * fallback quando o Haiku falha. Também reutilizada na impl Haiku. */
export function templateTitle(name: string, locale: Locale): string {
  return t('spots.suggestionFallbackTitle', locale, { name })
}

/**
 * Enhancer determinístico (sem IA): mantém a ordem do Places e escreve copy por
 * template. É a degradação graciosa quando não há chave da Anthropic.
 */
export class TemplateSuggestionEnhancer implements ISuggestionEnhancer {
  async enhance(
    candidates: PlaceCandidate[],
    context: EnhanceContext,
  ): Promise<EnhancedCandidate[]> {
    return candidates.map((c) => ({
      ...c,
      suggestedTitle: templateTitle(c.name, context.locale),
      suggestedDescription: null,
    }))
  }
}
