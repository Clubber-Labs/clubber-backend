import {
  DEFAULT_LOCALE,
  type EventCategory,
  listCategories,
} from '../event-categories'
import { GENRES } from '../genres'
import { interestLabels, parentCategoryOf } from '../subcategories'

// Compõe as frases de busca (Text Search) a partir do PERFIL — é o que faz o
// gênero ("eletrônica") virar uma busca de verdade, em vez de ser ignorado pelo
// tipo do Places (Nearby). Determinístico (sem chamada de LLM): os rótulos já são
// os termos semânticos. Refinar por frase curada (searchTerm por interesse) fica
// como evolução; aqui ancoramos gênero num venue genérico de vida noturna.

// Teto de frases por geração — limita o nº de chamadas ao Places (cada frase é
// uma Text Search billable). As mais ESPECÍFICAS (subcategoria/gênero) vêm antes,
// então o corte preserva o sinal mais fino do perfil.
const MAX_QUERIES = 3

const GENRE_APPLIES_TO = new Map(GENRES.map((g) => [g.key, g.appliesTo]))

/**
 * Frases de Text Search derivadas do perfil:
 * - subcategoria de venue → o rótulo (já evoca o lugar: "Pizzaria", "Cinema");
 * - gênero → ancorado num venue ("balada música eletrônica") pra não cair em
 *   loja de disco; cobre as categorias de vida noturna a que se aplica;
 * - categoria sem interesse fino escolhido → o rótulo da categoria.
 * Dedup + teto de {@link MAX_QUERIES}. Categoria com subcategoria/gênero escolhido
 * NÃO repete a frase crua da categoria (a fina já cobre).
 */
export function buildProfileSearchQueries(
  categories: EventCategory[],
  subcategories: string[],
  locale: string = DEFAULT_LOCALE,
): string[] {
  const categoryLabel = new Map(
    listCategories(locale).map((c) => [c.value, c.label]),
  )
  const queries: string[] = []
  const covered = new Set<EventCategory>()

  for (const key of subcategories) {
    const [label] = interestLabels([key], locale)
    if (!label) continue
    const parent = parentCategoryOf(key)
    if (parent) {
      queries.push(label)
      covered.add(parent)
      continue
    }
    const appliesTo = GENRE_APPLIES_TO.get(key)
    if (appliesTo) {
      queries.push(`balada ${label.toLowerCase()}`)
      for (const c of appliesTo) {
        if (categories.includes(c)) covered.add(c)
      }
    }
    // chave desconhecida (nem subcategoria nem gênero): ignorada.
  }

  for (const c of categories) {
    if (covered.has(c)) continue
    const label = categoryLabel.get(c)
    if (label) queries.push(label)
  }

  return [...new Set(queries)].slice(0, MAX_QUERIES)
}
