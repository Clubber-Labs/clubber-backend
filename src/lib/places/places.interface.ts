import type { EventCategory } from '../event-categories'

/** Candidato de local retornado pela busca (efêmero — não persiste). */
export type PlaceCandidate = {
  placeId: string
  name: string
  latitude: number
  longitude: number
  category: EventCategory
  address: string | null
  // Sinais de qualidade/relevância para o ranqueamento da IA. `null` quando o
  // Places não traz o dado; `distanceMeters` é sempre calculado do ponto da busca.
  rating: number | null
  userRatingCount: number | null
  priceLevel: string | null
  openNow: boolean | null
  distanceMeters: number
}

export type SearchNearbyParams = {
  latitude: number
  longitude: number
  /** Categorias de interesse (preferências do usuário) → tipos do Places. */
  categories: EventCategory[]
  radiusMeters?: number
  limit?: number
}

/** Busca por intenção em texto livre (Text Search). O ponto é só viés, não trava. */
export type SearchTextParams = {
  textQuery: string
  latitude: number
  longitude: number
  radiusMeters?: number
  limit?: number
}

/** Provedor de busca de estabelecimentos (Google Places). */
export interface IPlacesClient {
  searchNearby(params: SearchNearbyParams): Promise<PlaceCandidate[]>
  searchText(params: SearchTextParams): Promise<PlaceCandidate[]>
}
