import type { EventCategory } from '../event-categories'

/** Candidato de local retornado pela busca (efêmero — não persiste). */
export type PlaceCandidate = {
  placeId: string
  name: string
  latitude: number
  longitude: number
  category: EventCategory
  address: string | null
}

export type SearchNearbyParams = {
  latitude: number
  longitude: number
  /** Categorias de interesse (preferências do usuário) → tipos do Places. */
  categories: EventCategory[]
  radiusMeters?: number
  limit?: number
}

/** Provedor de busca de estabelecimentos por proximidade (Google Places). */
export interface IPlacesClient {
  searchNearby(params: SearchNearbyParams): Promise<PlaceCandidate[]>
}
