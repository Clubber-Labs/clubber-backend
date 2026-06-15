import type {
  IPlacesClient,
  PlaceCandidate,
  SearchNearbyParams,
  SearchTextParams,
} from '../lib/places'

function fakeCandidate(
  over: Partial<PlaceCandidate> & Pick<PlaceCandidate, 'placeId' | 'category'>,
): PlaceCandidate {
  return {
    name: `Lugar ${over.category}`,
    latitude: -25.4,
    longitude: -49.3,
    address: null,
    rating: null,
    userRatingCount: null,
    priceLevel: null,
    openNow: null,
    distanceMeters: 0,
    ...over,
  }
}

/**
 * Places fake para testes: não chama a API do Google. Devolve candidatos
 * determinísticos e conta as chamadas (`calls`, e `lastNearby`/`lastText` com os
 * params recebidos) para verificar cache hit e roteamento. Injetado via
 * setPlacesClient no setup.ts.
 */
export class FakePlacesService implements IPlacesClient {
  calls = 0
  lastNearby: SearchNearbyParams | null = null
  lastText: SearchTextParams | null = null
  /** Sobrescreva para roteirizar o retorno da Nearby num cenário. */
  override: ((params: SearchNearbyParams) => PlaceCandidate[]) | null = null

  async searchNearby(params: SearchNearbyParams): Promise<PlaceCandidate[]> {
    this.calls++
    this.lastNearby = params
    if (this.override) return this.override(params)
    return params.categories.map((category, i) =>
      fakeCandidate({
        placeId: `fake_${category}`,
        category,
        latitude: params.latitude + i * 0.0001,
        longitude: params.longitude + i * 0.0001,
        distanceMeters: i * 100,
      }),
    )
  }

  async searchText(params: SearchTextParams): Promise<PlaceCandidate[]> {
    this.calls++
    this.lastText = params
    // Determinístico: um candidato "de texto" rotulado como OTHER (a Text Search
    // não deriva de categoria de perfil).
    return [
      fakeCandidate({
        placeId: `fake_text_${params.textQuery}`,
        name: `Resultado: ${params.textQuery}`,
        category: 'OTHER',
        latitude: params.latitude,
        longitude: params.longitude,
      }),
    ]
  }

  reset(): void {
    this.calls = 0
    this.lastNearby = null
    this.lastText = null
    this.override = null
  }
}

export const fakePlaces = new FakePlacesService()
