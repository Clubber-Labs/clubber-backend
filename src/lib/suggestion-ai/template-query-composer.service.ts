import {
  type IProfileQueryComposer,
  MAX_PROFILE_QUERIES,
  type SuggestionProfile,
} from './profile-query-composer.interface'

/**
 * Frases determinísticas a partir do perfil — interesses finos antes (sinal mais
 * específico), depois categorias; dedup e teto. É a degradação graciosa sem chave
 * da Anthropic e o fallback reaproveitado pela impl Haiku quando a IA falha.
 */
export function fallbackProfileQueries(profile: SuggestionProfile): string[] {
  const all = [...profile.interests, ...profile.categories]
  return [...new Set(all)].slice(0, MAX_PROFILE_QUERIES)
}

/** Composer determinístico (sem IA): usa os próprios rótulos do perfil. */
export class TemplateProfileQueryComposer implements IProfileQueryComposer {
  async composeProfileQueries(profile: SuggestionProfile): Promise<string[]> {
    return fallbackProfileQueries(profile)
  }
}
