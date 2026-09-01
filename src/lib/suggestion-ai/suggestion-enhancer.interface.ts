import type { Locale } from '../i18n/locale'
import type { PlaceCandidate } from '../places'

/**
 * Candidato do Places enriquecido com FATOS do estabelecimento que ajudam o
 * usuário a escolher — quem dá título e descrição ao rolê é o próprio usuário.
 * `reviews` fica de fora de propósito: é insumo interno da IA e não pode vazar
 * na resposta da API (payload e ToS do Places).
 */
export type EnhancedCandidate = Omit<PlaceCandidate, 'reviews'> & {
  /** 1 frase factual sobre o que o lugar é (≤140 chars); null no modo degradado. */
  about: string | null
  /** Até 5 fatos curtos (≤55 chars) com o que pesa pra escolher; [] sem evidência. */
  highlights: string[]
}

export type EnhanceContext = {
  /**
   * Critério ÚNICO de ranqueamento — a intenção da busca contra a qual os
   * candidatos são ordenados. É o texto livre do usuário (modo-intenção) ou as
   * frases que a IA compôs do perfil (modo-perfil). Unifica os dois modos: o
   * ranqueador sempre ordena por aderência a este critério.
   */
  criterion: string
  /**
   * Idioma da copy — o do aparelho de quem pediu (request.locale). Vale também
   * para o fallback por template: degradar de IA para template não pode
   * degradar de idioma.
   */
  locale: Locale
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
