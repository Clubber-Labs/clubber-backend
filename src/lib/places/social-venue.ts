import type { EventCategory } from '../event-categories'
import { SUBCATEGORIES } from '../subcategories'

// Filtro ESTRUTURAL de "venue social" para a recomendação de spots: decide, pelos
// `types` do Google Places, se um lugar serve para um rolê em grupo (passar um
// tempo junto) ou não (loja onde se compra e vai embora, academia, escola,
// serviço). Roda ANTES da IA — tira do prompt a frágil heurística por palavra no
// nome ("loja", "curso", "estúdio"), atacando a raiz: o tipo do lugar é o sinal.

// Categorias da taxonomia que representam "lugar de passar tempo em grupo".
// SPORTS, HEALTH_WELLNESS, FASHION, EDUCATION, PETS ficam de fora (uso
// individual/serviço/varejo) — e os tipos delas viram a base da blacklist.
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

// Tipos sociais que o Places (New) emite mas a taxonomia não lista nominalmente
// (cozinhas específicas, variações de bar). O Places quase sempre acompanha do
// genérico 'restaurant', mas alguns venues vêm só com o tipo fino — daí o reforço.
const SOCIAL_EXTRA_TYPES = [
  'restaurant',
  'food',
  'meal_takeaway',
  'meal_delivery',
  'fine_dining_restaurant',
  'hamburger_restaurant',
  'seafood_restaurant',
  'italian_restaurant',
  'mexican_restaurant',
  'chinese_restaurant',
  'japanese_restaurant',
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
  'cafeteria',
  'bar',
  'cocktail_bar',
  'acai_shop',
  'diner',
  'bistro',
]

/** Tipos do Places que ANCORAM um candidato como social (derivado da taxonomia). */
export const SOCIAL_PLACE_TYPES = new Set<string>([
  ...SUBCATEGORIES.filter((s) => SOCIAL_CATEGORIES.has(s.category)).flatMap(
    (s) => s.placeTypes,
  ),
  ...SOCIAL_EXTRA_TYPES,
])

// Tipos claramente NÃO-sociais (varejo nominal/serviço/ensino) que VETAM um
// candidato mesmo que ele também carregue um tipo social. NÃO inclui o genérico
// 'store': lojas de COMIDA sociais (padaria, sorveteria, doceria) também o
// carregam — vetá-lo derrubaria venue legítimo. Por isso a blacklist é nominal.
export const NON_SOCIAL_PLACE_TYPES = new Set<string>([
  // esporte / bem-estar / beleza (uso individual)
  'gym',
  'fitness_center',
  'spa',
  'sauna',
  'massage',
  'yoga_studio',
  'wellness_center',
  'beauty_salon',
  'hair_salon',
  'nail_salon',
  'barber_shop',
  // varejo nominal (compra e vai embora)
  'clothing_store',
  'department_store',
  'shopping_mall',
  'shoe_store',
  'jewelry_store',
  'electronics_store',
  'furniture_store',
  'hardware_store',
  'home_goods_store',
  'book_store',
  'convenience_store',
  'grocery_store',
  'supermarket',
  'liquor_store',
  // ensino / produção (aprende ou produz, não curte)
  'library',
  'university',
  'school',
  'primary_school',
  'secondary_school',
  'preschool',
  // pet / saúde / serviços
  'dog_park',
  'pet_store',
  'veterinary_care',
  'hospital',
  'doctor',
  'dentist',
  'pharmacy',
  'bank',
  'atm',
  'gas_station',
  'car_repair',
  'lodging',
  'hotel',
])

/**
 * Um candidato é um venue social quando carrega ao menos um tipo social E nenhum
 * tipo banido. A whitelist garante uma âncora ("é mesmo um lugar de rolê"); a
 * blacklist veta híbridos varejo/serviço que por acaso também tenham tipo social.
 */
export function isSocialVenue(types: string[]): boolean {
  return (
    types.some((t) => SOCIAL_PLACE_TYPES.has(t)) &&
    !types.some((t) => NON_SOCIAL_PLACE_TYPES.has(t))
  )
}
