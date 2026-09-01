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
 * Intenção reescrita para a Text Search. `anchored` vem da IA como decisão
 * explícita — só ancoragem de venue/cidade citados desliga o teto de distância
 * no service. Inferir isso comparando strings quebraria com qualquer outra
 * reescrita (ex.: gênero generalizado), liberando resultados a centenas de km.
 */
export type ComposedIntent = {
  query: string
  anchored: boolean
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
   * Dois casos: venue/cidade citados ("green valley" → "Green Valley Balneário
   * Camboriú", anchored) e gênero musical, que vira busca de venue com o
   * subgênero generalizado pro gênero-mãe ("balada com megafunk" → "balada de
   * funk", NÃO anchored). Texto genérico passa inalterado e qualquer falha
   * devolve o original sem ancorar — nunca quebra a geração.
   */
  composeIntentQuery(intent: string, locale: Locale): Promise<ComposedIntent>
}
