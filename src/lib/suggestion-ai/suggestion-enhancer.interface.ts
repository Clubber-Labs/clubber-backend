import type { EventCategory } from '../event-categories'
import type { PlaceCandidate } from '../places'

/** Candidato do Places enriquecido com copy convidativa para o balão. */
export type EnhancedCandidate = PlaceCandidate & {
  suggestedTitle: string
  suggestedDescription: string | null
}

export type EnhanceContext = {
  /** Categorias preferidas do usuário — sinal de ranqueamento. */
  preferredCategories: EventCategory[]
}

/**
 * Camada de IA das sugestões: ranqueia (reordena) os candidatos por relevância
 * e escreve a copy convidativa de cada um. Impl real (Haiku) ou template
 * determinístico, injetável (espelha o padrão do Places).
 */
export interface ISuggestionEnhancer {
  enhance(
    candidates: PlaceCandidate[],
    context: EnhanceContext,
  ): Promise<EnhancedCandidate[]>
}
