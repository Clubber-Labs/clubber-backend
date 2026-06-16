import type { PlaceCandidate } from '../places'

/** Candidato do Places enriquecido com copy convidativa para o balão. */
export type EnhancedCandidate = PlaceCandidate & {
  suggestedTitle: string
  suggestedDescription: string | null
}

export type EnhanceContext = {
  /**
   * Critério ÚNICO de ranqueamento — a intenção da busca contra a qual os
   * candidatos são ordenados. É o texto livre do usuário (modo-intenção) ou as
   * frases que a IA compôs do perfil (modo-perfil). Unifica os dois modos: o
   * ranqueador sempre ordena por aderência a este critério.
   */
  criterion: string
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
