import { DEFAULT_LOCALE, type EventCategory } from './event-categories'

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

const NIGHTLIFE_CATS: EventCategory[] = ['PARTY', 'MUSIC', 'NIGHTLIFE']

export const GENRES: Genre[] = [
  { key: 'GENRE_SERTANEJO', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_FUNK', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_PAGODE_SAMBA', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_ROCK', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_POP', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_ELETRONICA', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_MPB', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_RAP', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_FORRO', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_PISEIRO', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_REGGAE', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_AXE', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_JAZZ_BLUES', appliesTo: NIGHTLIFE_CATS },
  { key: 'GENRE_INDIE', appliesTo: NIGHTLIFE_CATS },
]

const GENRE_LABELS: Record<string, Record<string, string>> = {
  'pt-BR': {
    GENRE_SERTANEJO: 'Sertanejo',
    GENRE_FUNK: 'Funk',
    GENRE_PAGODE_SAMBA: 'Pagode e samba',
    GENRE_ROCK: 'Rock',
    GENRE_POP: 'Pop',
    GENRE_ELETRONICA: 'Eletrônica',
    GENRE_MPB: 'MPB',
    GENRE_RAP: 'Rap e hip-hop',
    GENRE_FORRO: 'Forró',
    GENRE_PISEIRO: 'Piseiro',
    GENRE_REGGAE: 'Reggae',
    GENRE_AXE: 'Axé',
    GENRE_JAZZ_BLUES: 'Jazz e blues',
    GENRE_INDIE: 'Indie e alternativo',
  },
}

export const GENRE_KEYS = GENRES.map((g) => g.key)

export type GenreOption = { value: string; label: string }

/** Gêneros com rótulo no locale pedido (fallback pt-BR). */
export function listGenres(locale: string = DEFAULT_LOCALE): GenreOption[] {
  const labels = GENRE_LABELS[locale] ?? GENRE_LABELS[DEFAULT_LOCALE]
  return GENRES.map((g) => ({ value: g.key, label: labels[g.key] ?? g.key }))
}
