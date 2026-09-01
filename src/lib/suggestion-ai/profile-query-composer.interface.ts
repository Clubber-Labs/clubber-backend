// Teto de frases por geração: cada frase é uma Text Search billable. As mais
// específicas (interesses) vêm primeiro, então o corte preserva o sinal mais fino.
import type { Locale } from '../i18n/locale'

export const MAX_PROFILE_QUERIES = 2

/** Perfil destilado para compor a busca: rótulos humanos (não enums/chaves). */
export type SuggestionProfile = {
  /** Rótulos das categorias preferidas, no locale do pedido. */
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
  composeProfileQueries(
    profile: SuggestionProfile,
    locale: Locale,
  ): Promise<string[]>
  /**
   * Reescreve a intenção de texto livre numa query melhor para a Text Search.
   * O caso que motivou: venue famoso citado pelo nome ("green valley") — o
   * Google, com viés local, prefere homônimos próximos; a IA ancora com a
   * cidade ("Green Valley Balneário Camboriú"). Texto genérico passa inalterado
   * e qualquer falha devolve o original — nunca quebra a geração.
   */
  composeIntentQuery(intent: string, locale: Locale): Promise<string>
}
