import { z } from 'zod'
import {
  type CategoryOption,
  DEFAULT_LOCALE,
  type EventCategory,
  listCategories,
} from './event-categories'
import { GENRE_KEYS, GENRES, listGenres } from './genres'

/**
 * Taxonomia de SUBCATEGORIAS — segundo nível abaixo de EventCategory, para
 * enriquecer o perfil do usuário e tornar a recomendação de rolês precisa
 * (ex.: GASTRONOMY > "Japonesa" busca só sushi, não todo restaurante).
 *
 * É CONFIG-DRIVEN (não enum): adicionar/ajustar subcategoria = editar este array
 * + um rótulo, sem migration. As chaves são identificadores estáveis e neutros,
 * namespaced pelo pai; o rótulo exibível vive em SUBCATEGORY_LABELS.
 *
 * PARTIÇÃO: cada tipo do Google Places aparece em UMA única subcategoria (logo,
 * numa única categoria). Mantém determinístico quem é "venue social" para a
 * recomendação de spots — ver lib/places/social-venue, que deriva a whitelist
 * dos placeTypes das categorias sociais.
 */
export type Subcategory = {
  key: string
  category: EventCategory
  /** Tipos do Google Places (New) que esta subcategoria representa. */
  placeTypes: string[]
}

export const SUBCATEGORIES: Subcategory[] = [
  // PARTY / NIGHTLIFE / MUSIC — a vida noturna repartida
  { key: 'PARTY_BALADA', category: 'PARTY', placeTypes: ['night_club'] },
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
  {
    key: 'GASTRONOMY_FAST_FOOD',
    category: 'GASTRONOMY',
    placeTypes: ['fast_food_restaurant', 'meal_takeaway'],
  },
  {
    key: 'GASTRONOMY_ALTA',
    category: 'GASTRONOMY',
    placeTypes: ['fine_dining_restaurant'],
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
  {
    key: 'SPORTS_RADICAIS',
    category: 'SPORTS',
    placeTypes: ['skateboard_park', 'ski_resort'],
  },
  {
    key: 'SPORTS_PATINACAO',
    category: 'SPORTS',
    placeTypes: ['ice_skating_rink'],
  },

  // HEALTH_WELLNESS
  {
    key: 'HEALTH_WELLNESS_SPA',
    category: 'HEALTH_WELLNESS',
    placeTypes: ['spa', 'sauna', 'massage'],
  },
  {
    key: 'HEALTH_WELLNESS_YOGA',
    category: 'HEALTH_WELLNESS',
    placeTypes: ['yoga_studio', 'wellness_center'],
  },
  {
    key: 'HEALTH_WELLNESS_BELEZA',
    category: 'HEALTH_WELLNESS',
    placeTypes: ['beauty_salon'],
  },

  // ART
  { key: 'ART_MUSEU', category: 'ART', placeTypes: ['museum'] },
  {
    key: 'ART_GALERIA',
    category: 'ART',
    placeTypes: ['art_gallery', 'art_studio'],
  },
  { key: 'ART_CULTURAL', category: 'ART', placeTypes: ['cultural_center'] },
  {
    key: 'ART_MONUMENTO',
    category: 'ART',
    placeTypes: ['monument', 'sculpture'],
  },
  { key: 'ART_PLANETARIO', category: 'ART', placeTypes: ['planetarium'] },

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

  // GAMING
  {
    key: 'GAMING_FLIPERAMA',
    category: 'GAMING',
    placeTypes: ['video_arcade', 'amusement_center'],
  },
  { key: 'GAMING_BOLICHE', category: 'GAMING', placeTypes: ['bowling_alley'] },
  { key: 'GAMING_CASSINO', category: 'GAMING', placeTypes: ['casino'] },
  { key: 'GAMING_LAN', category: 'GAMING', placeTypes: ['internet_cafe'] },

  // FAMILY
  {
    key: 'FAMILY_DIVERSOES',
    category: 'FAMILY',
    placeTypes: ['amusement_park', 'water_park'],
  },
  {
    key: 'FAMILY_ZOO',
    category: 'FAMILY',
    placeTypes: ['zoo', 'aquarium', 'wildlife_park', 'wildlife_refuge'],
  },
  {
    key: 'FAMILY_PLAY',
    category: 'FAMILY',
    placeTypes: ['playground', 'childrens_camp'],
  },

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
    key: 'OUTDOORS_JARDIM',
    category: 'OUTDOORS',
    placeTypes: ['garden', 'botanical_garden'],
  },
  { key: 'OUTDOORS_MARINA', category: 'OUTDOORS', placeTypes: ['marina'] },
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

  // FASHION
  {
    key: 'FASHION_SHOPPING',
    category: 'FASHION',
    placeTypes: ['shopping_mall', 'department_store'],
  },
  { key: 'FASHION_LOJAS', category: 'FASHION', placeTypes: ['clothing_store'] },

  // EDUCATION
  {
    key: 'EDUCATION_BIBLIOTECA',
    category: 'EDUCATION',
    placeTypes: ['library'],
  },
  {
    key: 'EDUCATION_CAMPUS',
    category: 'EDUCATION',
    placeTypes: ['university', 'school'],
  },

  // PETS
  { key: 'PETS_PARQUE', category: 'PETS', placeTypes: ['dog_park'] },
  { key: 'PETS_PETSHOP', category: 'PETS', placeTypes: ['pet_store'] },
  { key: 'PETS_VET', category: 'PETS', placeTypes: ['veterinary_care'] },
]

/** Rótulos exibíveis por locale (mesmo padrão de CATEGORY_LABELS). */
const SUBCATEGORY_LABELS: Record<string, Record<string, string>> = {
  'pt-BR': {
    PARTY_BALADA: 'Balada',
    PARTY_DANCA: 'Dança',
    NIGHTLIFE_BAR: 'Bar',
    NIGHTLIFE_PUB: 'Pub',
    NIGHTLIFE_VINHO: 'Bar de vinhos',
    MUSIC_SHOW: 'Casa de show',
    MUSIC_KARAOKE: 'Karaokê',
    GASTRONOMY_RESTAURANTE: 'Restaurante',
    GASTRONOMY_PIZZA: 'Pizzaria',
    GASTRONOMY_JAPONESA: 'Japonesa',
    GASTRONOMY_CHURRASCO: 'Churrasco',
    GASTRONOMY_BRUNCH: 'Brunch',
    GASTRONOMY_FAST_FOOD: 'Fast-food',
    GASTRONOMY_ALTA: 'Alta gastronomia',
    CAFE_CAFETERIA: 'Cafeteria',
    CAFE_PADARIA: 'Padaria',
    CAFE_DOCERIA: 'Doceria',
    CAFE_SORVETERIA: 'Sorveteria',
    CAFE_CHA: 'Casa de chá',
    CAFE_SUCOS: 'Sucos',
    MARKETS_FEIRA: 'Feira e mercado',
    MARKETS_PRACA: 'Praça de alimentação',
    SPORTS_ACADEMIA: 'Academia',
    SPORTS_QUADRA: 'Quadra e estádio',
    SPORTS_NATACAO: 'Natação',
    SPORTS_GOLFE: 'Golfe',
    SPORTS_RADICAIS: 'Esportes radicais',
    SPORTS_PATINACAO: 'Patinação',
    HEALTH_WELLNESS_SPA: 'Spa e massagem',
    HEALTH_WELLNESS_YOGA: 'Yoga e bem-estar',
    HEALTH_WELLNESS_BELEZA: 'Beleza',
    ART_MUSEU: 'Museu',
    ART_GALERIA: 'Galeria e ateliê',
    ART_CULTURAL: 'Centro cultural',
    ART_MONUMENTO: 'Monumento',
    ART_PLANETARIO: 'Planetário',
    FILM_CINEMA: 'Cinema',
    FILM_TEATRO: 'Teatro',
    GAMING_FLIPERAMA: 'Fliperama',
    GAMING_BOLICHE: 'Boliche',
    GAMING_CASSINO: 'Cassino',
    GAMING_LAN: 'Lan house',
    FAMILY_DIVERSOES: 'Parque de diversões',
    FAMILY_ZOO: 'Zoológico e aquário',
    FAMILY_PLAY: 'Playground',
    OUTDOORS_PARQUE: 'Parque',
    OUTDOORS_TRILHA: 'Trilha e camping',
    OUTDOORS_PRAIA: 'Praia',
    OUTDOORS_JARDIM: 'Jardim',
    OUTDOORS_MARINA: 'Marina',
    OUTDOORS_TURISMO: 'Ponto turístico',
    FASHION_SHOPPING: 'Shopping',
    FASHION_LOJAS: 'Lojas e boutiques',
    EDUCATION_BIBLIOTECA: 'Biblioteca',
    EDUCATION_CAMPUS: 'Universidade',
    PETS_PARQUE: 'Parque para cães',
    PETS_PETSHOP: 'Pet shop',
    PETS_VET: 'Veterinário',
  },
}

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
  Partial<Record<EventCategory, Subcategory[]>>
>((acc, s) => {
  const list = acc[s.category] ?? []
  list.push(s)
  acc[s.category] = list
  return acc
}, {})

const SUBCATEGORY_BY_KEY = new Map(SUBCATEGORIES.map((s) => [s.key, s]))
const GENRE_BY_KEY = new Map(GENRES.map((g) => [g.key, g]))

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
  locale: string = DEFAULT_LOCALE,
): CategoryWithSubcategories[] {
  const labels =
    SUBCATEGORY_LABELS[locale] ?? SUBCATEGORY_LABELS[DEFAULT_LOCALE]
  return listCategories(locale).map((cat) => ({
    ...cat,
    subcategories: (subcategoriesByCategory[cat.value] ?? []).map((s) => ({
      value: s.key,
      label: labels[s.key] ?? s.key,
    })),
  }))
}

/**
 * Rótulos (locale) das chaves de interesse — subcategoria de venue OU gênero.
 * Usado para passar à IA texto humano em vez das chaves cruas.
 */
export function interestLabels(
  keys: string[],
  locale: string = DEFAULT_LOCALE,
): string[] {
  const subLabels =
    SUBCATEGORY_LABELS[locale] ?? SUBCATEGORY_LABELS[DEFAULT_LOCALE]
  const genres = new Map(listGenres(locale).map((g) => [g.value, g.label]))
  return keys.map((k) => subLabels[k] ?? genres.get(k) ?? k)
}
