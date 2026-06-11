import type { EventCategory } from '../event-categories'

// Mapa regra (PR2): categoria de rolê -> tipos do Google Places (New) usados
// como includedTypes na busca. Nem toda categoria tem equivalente bom no Places
// (TECH, BUSINESS, PETS, VOLUNTEERING, OTHER ficam sem tipo). A camada de IA do
// PR3 refina isso; aqui é determinístico e barato.
const CATEGORY_TO_PLACE_TYPES: Record<EventCategory, string[]> = {
  PARTY: ['night_club', 'bar'],
  NIGHTLIFE: ['night_club', 'bar'],
  MUSIC: ['night_club', 'bar'],
  GASTRONOMY: ['restaurant', 'cafe'],
  SPORTS: ['gym', 'stadium'],
  ART: ['art_gallery', 'museum'],
  FILM_THEATER: ['movie_theater'],
  OUTDOORS: ['park'],
  GAMING: ['amusement_center'],
  FASHION: ['shopping_mall'],
  HEALTH_WELLNESS: ['spa', 'gym'],
  EDUCATION: ['library'],
  RELIGION: ['church'],
  FAMILY: ['amusement_park', 'zoo'],
  TECH: [],
  BUSINESS: [],
  PETS: [],
  VOLUNTEERING: [],
  OTHER: [],
}

// Reverso: tipo do Places -> categoria de rolê, para rotular o candidato.
const PLACE_TYPE_TO_CATEGORY: Record<string, EventCategory> = {
  night_club: 'NIGHTLIFE',
  bar: 'PARTY',
  restaurant: 'GASTRONOMY',
  cafe: 'GASTRONOMY',
  gym: 'SPORTS',
  stadium: 'SPORTS',
  art_gallery: 'ART',
  museum: 'ART',
  movie_theater: 'FILM_THEATER',
  park: 'OUTDOORS',
  amusement_center: 'GAMING',
  shopping_mall: 'FASHION',
  spa: 'HEALTH_WELLNESS',
  library: 'EDUCATION',
  church: 'RELIGION',
  amusement_park: 'FAMILY',
  zoo: 'FAMILY',
}

/** Tipos de Places (deduplicados) para as categorias pedidas. */
export function placeTypesForCategories(categories: EventCategory[]): string[] {
  const types = new Set<string>()
  for (const c of categories) {
    for (const t of CATEGORY_TO_PLACE_TYPES[c]) types.add(t)
  }
  return [...types]
}

/** Primeira categoria conhecida entre os tipos do Places; OTHER se nenhuma. */
export function categoryForPlaceTypes(types: string[]): EventCategory {
  for (const t of types) {
    const c = PLACE_TYPE_TO_CATEGORY[t]
    if (c) return c
  }
  return 'OTHER'
}
