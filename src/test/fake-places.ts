import type {
  IPlacesClient,
  PlaceCandidate,
  SearchNearbyParams,
} from '../lib/places'

/**
 * Places fake para testes: não chama a API do Google. Devolve um candidato
 * determinístico por categoria pedida, perto do ponto, e conta as chamadas
 * (`calls`) para verificar cache hit. Injetado via setPlacesClient no setup.ts.
 */
export class FakePlacesService implements IPlacesClient {
  calls = 0
  /** Sobrescreva para roteirizar o retorno de um cenário. */
  override: ((params: SearchNearbyParams) => PlaceCandidate[]) | null = null

  async searchNearby(params: SearchNearbyParams): Promise<PlaceCandidate[]> {
    this.calls++
    if (this.override) return this.override(params)
    return params.categories.map((category, i) => ({
      placeId: `fake_${category}`,
      name: `Lugar ${category}`,
      latitude: params.latitude + i * 0.0001,
      longitude: params.longitude + i * 0.0001,
      category,
      address: null,
    }))
  }

  reset(): void {
    this.calls = 0
    this.override = null
  }
}

export const fakePlaces = new FakePlacesService()
