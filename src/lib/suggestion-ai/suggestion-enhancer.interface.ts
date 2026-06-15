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
  /**
   * Intenção em texto livre do usuário (ex.: "bar com música ao vivo"). Quando
   * presente, é o sinal dominante de ranqueamento — as preferências são ignoradas.
   */
  intent?: string
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
