import type { EventCategory } from '../event-categories'
import { SUBCATEGORIES } from '../subcategories'

// Filtro ESTRUTURAL de "venue social" para a recomendação de spots: decide, pelos
// `types` do Google Places, se um lugar serve para um rolê em grupo (passar um
// tempo junto) ou não (loja onde se compra e vai embora, academia, escola,
// serviço). Roda ANTES da IA — tira do prompt a frágil heurística por palavra no
// nome ("loja", "curso", "estúdio"), atacando a raiz: o tipo do lugar é o sinal.

// Categorias da taxonomia que representam "lugar de passar tempo em grupo".
// SPORTS, HEALTH_WELLNESS, FASHION, EDUCATION, PETS ficam de fora (uso
// individual/serviço/varejo) — seus tipos simplesmente não entram na whitelist.
const SOCIAL_CATEGORIES = new Set<EventCategory>([
  'PARTY',
  'NIGHTLIFE',
  'MUSIC',
  'GASTRONOMY',
  'CAFE',
  'FILM_THEATER',
  'GAMING',
  'ART',
  'OUTDOORS',
  'FAMILY',
  'MARKETS',
])

// Reforço/extensão da whitelist social. A maioria são tipos que o Places (New)
// emite mas a taxonomia não lista nominalmente (cozinhas específicas, variações de
// bar, casas de evento). Alguns (restaurant, bar) já vêm da taxonomia e estão aqui
// de propósito: repeti-los (o Set dedupa) fixa o núcleo social explícito, imune a
// futuras edições nas subcategorias. Validados no probe real (Curitiba): sem eles,
// casas de show (live_music_venue) e restaurantes de cozinha específica eram
// descartados. NÃO inclui o genérico 'food' (casaria supermercado).
const SOCIAL_EXTRA_TYPES = [
  'restaurant',
  'fine_dining_restaurant',
  'hamburger_restaurant',
  'seafood_restaurant',
  'italian_restaurant',
  'mexican_restaurant',
  'chinese_restaurant',
  'japanese_restaurant',
  'asian_restaurant',
  'thai_restaurant',
  'indian_restaurant',
  'french_restaurant',
  'spanish_restaurant',
  'greek_restaurant',
  'korean_restaurant',
  'vietnamese_restaurant',
  'middle_eastern_restaurant',
  'vegetarian_restaurant',
  'vegan_restaurant',
  'ramen_restaurant',
  'barbecue_restaurant',
  'breakfast_restaurant',
  'buffet_restaurant',
  'cafeteria',
  'bar',
  'cocktail_bar',
  'hookah_bar',
  'acai_shop',
  'diner',
  'bistro',
  // casas de show / espaços de evento (rolê é justamente o que acontece nelas)
  'live_music_venue',
  'event_venue',
  'banquet_hall',
]

/** Tipos do Places que ANCORAM um candidato como social (derivado da taxonomia). */
export const SOCIAL_PLACE_TYPES = new Set<string>([
  ...SUBCATEGORIES.filter((s) => SOCIAL_CATEGORIES.has(s.category)).flatMap(
    (s) => s.placeTypes,
  ),
  ...SOCIAL_EXTRA_TYPES,
])

/**
 * Um candidato é um venue social quando carrega ao menos um tipo social. A âncora
 * social VENCE tipos de varejo/serviço que apareçam junto: o probe real mostrou
 * que vetar por tipo secundário derruba venues legítimos (uma balada que também é
 * `spa`, um restaurante dentro de `hotel`, um café que também é `book_store`).
 * Varejo/serviço puro (loja, academia, escola) simplesmente não tem tipo social e
 * cai fora. A IA ainda ranqueia e descarta matches fracos numa segunda passada.
 */
export function isSocialVenue(types: string[]): boolean {
  return types.some((t) => SOCIAL_PLACE_TYPES.has(t))
}
