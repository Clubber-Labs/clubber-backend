import { z } from 'zod'
import {
  type CategoryOption,
  type EventCategory,
  listCategories,
} from './event-categories'
import { GENRE_KEYS, GENRES } from './genres'
import { DEFAULT_LOCALE, type Locale } from './i18n/locale'
import { t } from './i18n/translate'

/**
 * Taxonomia de SUBCATEGORIAS — segundo nível abaixo de EventCategory, para
 * enriquecer o perfil do usuário e tornar a recomendação de rolês precisa
 * (ex.: GASTRONOMY > "Japonesa" busca só sushi, não todo restaurante).
 *
 * É CONFIG-DRIVEN (não enum): adicionar/ajustar subcategoria = editar este array
 * + um rótulo, sem migration. As chaves são identificadores estáveis e neutros,
 * namespaced pelo pai; o rótulo exibível vive nos dicionários de lib/i18n/locales
 * (a estrutura fica aqui, a copy lá — chave sem rótulo não compila).
 *
 * PARTIÇÃO: cada tipo do Google Places aparece em UMA única subcategoria (logo,
 * numa única categoria). Mantém determinístico quem é "venue social" para a
 * recomendação de spots — ver lib/places/social-venue, que deriva a whitelist
 * dos placeTypes das categorias sociais.
 */
export type Subcategory = {
  key: string
  category: EventCategory
  /**
   * Tipos do Google Places (New) que esta subcategoria representa. Vazio =
   * interesse SEM venue (ex.: jogos de tabuleiro, RPG): enriquece perfil,
   * match e o sinal da IA, mas não estreita a busca de lugares — igual gênero.
   */
  placeTypes: readonly string[]
}

// `as const` estreita as chaves para literais (SubcategoryKey), amarrando cada
// subcategoria ao seu rótulo nos dicionários de i18n em tempo de compilação.
export const SUBCATEGORIES = [
  // NIGHTLIFE / PARTY / MUSIC — a vida noturna repartida
  {
    key: 'NIGHTLIFE_BALADA',
    category: 'NIGHTLIFE',
    placeTypes: ['night_club'],
  },
  { key: 'PARTY_DANCA', category: 'PARTY', placeTypes: ['dance_hall'] },
  { key: 'NIGHTLIFE_BAR', category: 'NIGHTLIFE', placeTypes: ['bar'] },
  { key: 'NIGHTLIFE_PUB', category: 'NIGHTLIFE', placeTypes: ['pub'] },
  { key: 'NIGHTLIFE_VINHO', category: 'NIGHTLIFE', placeTypes: ['wine_bar'] },
  {
    key: 'MUSIC_SHOW',
    category: 'MUSIC',
    placeTypes: ['concert_hall', 'amphitheatre'],
  },
  { key: 'MUSIC_KARAOKE', category: 'MUSIC', placeTypes: ['karaoke'] },

  // GASTRONOMY
  {
    key: 'GASTRONOMY_RESTAURANTE',
    category: 'GASTRONOMY',
    placeTypes: ['restaurant'],
  },
  {
    key: 'GASTRONOMY_PIZZA',
    category: 'GASTRONOMY',
    placeTypes: ['pizza_restaurant'],
  },
  {
    key: 'GASTRONOMY_JAPONESA',
    category: 'GASTRONOMY',
    placeTypes: ['sushi_restaurant'],
  },
  {
    key: 'GASTRONOMY_CHURRASCO',
    category: 'GASTRONOMY',
    placeTypes: ['steak_house', 'bar_and_grill'],
  },
  {
    key: 'GASTRONOMY_BRUNCH',
    category: 'GASTRONOMY',
    placeTypes: ['brunch_restaurant'],
  },

  // CAFE
  {
    key: 'CAFE_CAFETERIA',
    category: 'CAFE',
    placeTypes: ['cafe', 'coffee_shop'],
  },
  { key: 'CAFE_PADARIA', category: 'CAFE', placeTypes: ['bakery'] },
  { key: 'CAFE_DOCERIA', category: 'CAFE', placeTypes: ['dessert_shop'] },
  { key: 'CAFE_SORVETERIA', category: 'CAFE', placeTypes: ['ice_cream_shop'] },
  { key: 'CAFE_CHA', category: 'CAFE', placeTypes: ['tea_house'] },
  { key: 'CAFE_SUCOS', category: 'CAFE', placeTypes: ['juice_shop'] },

  // MARKETS
  { key: 'MARKETS_FEIRA', category: 'MARKETS', placeTypes: ['market'] },
  { key: 'MARKETS_PRACA', category: 'MARKETS', placeTypes: ['food_court'] },

  // SPORTS
  {
    key: 'SPORTS_ACADEMIA',
    category: 'SPORTS',
    placeTypes: ['gym', 'fitness_center'],
  },
  {
    key: 'SPORTS_QUADRA',
    category: 'SPORTS',
    placeTypes: [
      'stadium',
      'arena',
      'athletic_field',
      'sports_complex',
      'sports_club',
      'sports_activity_location',
    ],
  },
  { key: 'SPORTS_NATACAO', category: 'SPORTS', placeTypes: ['swimming_pool'] },
  { key: 'SPORTS_GOLFE', category: 'SPORTS', placeTypes: ['golf_course'] },
  { key: 'SPORTS_SKATE', category: 'SPORTS', placeTypes: ['skateboard_park'] },

  // ART
  { key: 'ART_MUSEU', category: 'ART', placeTypes: ['museum'] },
  {
    key: 'ART_GALERIA',
    category: 'ART',
    placeTypes: ['art_gallery', 'art_studio'],
  },
  { key: 'ART_CULTURAL', category: 'ART', placeTypes: ['cultural_center'] },

  // FILM_THEATER
  {
    key: 'FILM_CINEMA',
    category: 'FILM_THEATER',
    placeTypes: ['movie_theater'],
  },
  {
    key: 'FILM_TEATRO',
    category: 'FILM_THEATER',
    placeTypes: ['performing_arts_theater', 'auditorium'],
  },

  // GAMING — jogos de rolê: fliperama, e-sports e mesa (tabuleiro/RPG não têm
  // tipo no Places — interesse sem venue)
  {
    key: 'GAMING_FLIPERAMA',
    category: 'GAMING',
    placeTypes: ['video_arcade', 'amusement_center'],
  },
  { key: 'GAMING_ESPORTS', category: 'GAMING', placeTypes: ['internet_cafe'] },
  { key: 'GAMING_TABULEIRO', category: 'GAMING', placeTypes: [] },
  { key: 'GAMING_RPG', category: 'GAMING', placeTypes: [] },

  // OUTDOORS
  {
    key: 'OUTDOORS_PARQUE',
    category: 'OUTDOORS',
    placeTypes: ['park', 'national_park', 'state_park'],
  },
  {
    key: 'OUTDOORS_TRILHA',
    category: 'OUTDOORS',
    placeTypes: ['hiking_area', 'campground'],
  },
  { key: 'OUTDOORS_PRAIA', category: 'OUTDOORS', placeTypes: ['beach'] },
  {
    key: 'OUTDOORS_TURISMO',
    category: 'OUTDOORS',
    placeTypes: [
      'tourist_attraction',
      'observation_deck',
      'plaza',
      'picnic_ground',
    ],
  },

  // BRECHO — Places não tem tipo "thrift": clothing_store é o sinal aproximado;
  // o garimpo fino fica com a busca semântica dos spots
  {
    key: 'BRECHO_GARIMPO',
    category: 'BRECHO',
    placeTypes: ['clothing_store'],
  },
] as const satisfies readonly Subcategory[]

export type SubcategoryKey = (typeof SUBCATEGORIES)[number]['key']

/** Item de SUBCATEGORIES com a chave literal (para as chaves de tradução). */
type SubcategoryDef = (typeof SUBCATEGORIES)[number]

export const SUBCATEGORY_KEYS = SUBCATEGORIES.map((s) => s.key)

export const subcategorySchema = z.enum(
  SUBCATEGORY_KEYS as [string, ...string[]],
)

// "Interesse" do 2º nível = subcategoria de venue OU gênero musical. Unifica o
// armazenamento/validação (mesma tabela e campo preferredSubcategories); a
// distinção é só de apresentação (/categories) e de Places (gênero não estreita).
export const INTEREST_KEYS = [...SUBCATEGORY_KEYS, ...GENRE_KEYS]

export const interestSchema = z.enum(INTEREST_KEYS as [string, ...string[]])

/** Subcategorias agrupadas pelo pai (categoria com nenhuma subcategoria → []). */
export const subcategoriesByCategory = SUBCATEGORIES.reduce<
  Partial<Record<EventCategory, SubcategoryDef[]>>
>((acc, s) => {
  const list = acc[s.category] ?? []
  list.push(s)
  acc[s.category] = list
  return acc
}, {})

const SUBCATEGORY_BY_KEY = new Map<string, SubcategoryDef>(
  SUBCATEGORIES.map((s) => [s.key, s]),
)
const GENRE_BY_KEY = new Map<string, (typeof GENRES)[number]>(
  GENRES.map((g) => [g.key, g]),
)

/** Categoria pai de uma chave de subcategoria (undefined se desconhecida). */
export function parentCategoryOf(key: string): EventCategory | undefined {
  return SUBCATEGORY_BY_KEY.get(key)?.category
}

/**
 * Uma chave de interesse é COERENTE com um conjunto de categorias quando:
 * - subcategoria de venue → seu pai está entre as categorias;
 * - gênero (transversal) → ao menos uma das categorias a que ele se aplica
 *   (PARTY/MUSIC/NIGHTLIFE) está entre as categorias.
 * Chave desconhecida nunca é coerente. Usado pelo `.superRefine` de evento/spot:
 * só se pode taguear um interesse que faça sentido com as categorias escolhidas
 * (sem tags órfãs que nunca casariam no match hierárquico).
 */
export function interestMatchesCategories(
  key: string,
  categories: EventCategory[],
): boolean {
  const parent = parentCategoryOf(key)
  if (parent) return categories.includes(parent)
  const genre = GENRE_BY_KEY.get(key)
  if (genre) return genre.appliesTo.some((c) => categories.includes(c))
  return false
}

export type SubcategoryOption = { value: string; label: string }
export type CategoryWithSubcategories = CategoryOption & {
  subcategories: SubcategoryOption[]
}

/**
 * Categorias selecionáveis com suas subcategorias aninhadas, rotuladas no locale
 * pedido. Fonte única do GET /categories de duas camadas.
 */
export function listCategoriesWithSubcategories(
  locale: Locale = DEFAULT_LOCALE,
): CategoryWithSubcategories[] {
  return listCategories(locale).map((cat) => ({
    ...cat,
    subcategories: (subcategoriesByCategory[cat.value] ?? []).map((s) => ({
      value: s.key,
      label: t(`subcategories.${s.key}`, locale),
    })),
  }))
}

/**
 * Rótulos (locale) das chaves de interesse — subcategoria de venue OU gênero.
 * Usado para passar à IA texto humano em vez das chaves cruas.
 */
export function interestLabels(
  keys: string[],
  locale: Locale = DEFAULT_LOCALE,
): string[] {
  return keys.map((k) => {
    const sub = SUBCATEGORY_BY_KEY.get(k)
    if (sub) return t(`subcategories.${sub.key}`, locale)
    const genre = GENRE_BY_KEY.get(k)
    if (genre) return t(`genres.${genre.key}`, locale)
    return k
  })
}
