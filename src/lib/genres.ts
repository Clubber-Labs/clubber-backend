import type { EventCategory } from './event-categories'
import { DEFAULT_LOCALE, type Locale } from './i18n/locale'
import { t } from './i18n/translate'

/**
 * Gêneros/estilos musicais — dimensão TRANSVERSAL às categorias de vida noturna
 * (PARTY, MUSIC, NIGHTLIFE). Diferente das subcategorias de venue, o gênero NÃO
 * mapeia para tipo do Google Places (não existe "funk_club"): enriquece o perfil,
 * o match de eventos e o sinal para a IA, mas não estreita a busca de lugares.
 *
 * Config-driven (sem enum). Compartilham o mesmo armazenamento das subcategorias
 * (user_subcategory_preferences) — são "chaves de interesse" do 2º nível.
 */
export type Genre = {
  key: string
  /** Categorias a que o gênero se aplica (para agrupar na UI). */
  appliesTo: EventCategory[]
}

const NIGHTLIFE_CATS: EventCategory[] = [
  'PARTY',
  'MUSIC',
  'NIGHTLIFE',
  'FESTIVAL',
]

// `as const` estreita as chaves para literais (GenreKey), amarrando cada gênero
// ao seu rótulo nos dicionários de i18n em tempo de compilação.
// Curadoria jovem: só os gêneros que tocam em rolê/evento. As vertentes
// eletrônicas substituem o antigo GENRE_ELETRONICA genérico.
export const GENRES = [
  { key: 'GENRE_SERTANEJO', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_FUNK', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_PAGODE_SAMBA', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_ROCK', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_POP', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_RAP', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_FORRO', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_PISEIRO', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_AXE', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_INDIE', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_HOUSE', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_TECH_HOUSE', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_TECHNO', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_PSYTRANCE', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_DNB', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_EDM', appliesTo: NIGHTLIFE_CATS },
] as const satisfies readonly Genre[]

export type GenreKey = (typeof GENRES)[number]['key']

export const GENRE_KEYS = GENRES.map((g) => g.key)

// `appliesTo` acompanha cada gênero no contrato para o cliente fazer o gating
// dinâmico: a seção de gêneros (e o tagueamento de evento/spot) só vale quando
// uma das categorias do gênero está selecionada. Evita hardcodar a regra de
// vida noturna no app — se a taxonomia mudar, o cliente acompanha sem release.
export type GenreOption = {
  value: string
  label: string
  appliesTo: EventCategory[]
}

/** Gêneros com rótulo no locale pedido (fallback pt-BR) + categorias a que se aplicam. */
export function listGenres(locale: Locale = DEFAULT_LOCALE): GenreOption[] {
  return GENRES.map((g) => ({
    value: g.key,
    label: t(`genres.${g.key}`, locale),
    appliesTo: g.appliesTo,
  }))
}
