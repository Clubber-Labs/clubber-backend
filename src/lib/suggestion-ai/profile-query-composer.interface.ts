// Teto de frases por geração: cada frase é uma Text Search billable. As mais
// específicas (interesses) vêm primeiro, então o corte preserva o sinal mais fino.
export const MAX_PROFILE_QUERIES = 2

/** Perfil destilado para compor a busca: rótulos pt-BR (não enums/chaves). */
export type SuggestionProfile = {
  /** Rótulos das categorias preferidas (ex.: "Gastronomia", "Balada"). */
  categories: string[]
  /** Rótulos dos interesses finos — subcategorias de venue + gêneros musicais. */
  interests: string[]
}

/**
 * Compõe as frases de busca (Text Search) a partir do perfil do usuário — é a IA
 * que transforma o gosto em uma busca semântica ("baladas de música eletrônica"),
 * fazendo o gênero virar busca de verdade em vez de ser ignorado pelo tipo do
 * Places. Impl real (Haiku) ou determinística (template/sem chave), injetável —
 * espelha o padrão do enhancer e do Places.
 */
export interface IProfileQueryComposer {
  composeProfileQueries(profile: SuggestionProfile): Promise<string[]>
}
