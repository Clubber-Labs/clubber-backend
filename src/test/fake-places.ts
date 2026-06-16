import type {
  IPlacesClient,
  PlaceCandidate,
  SearchTextParams,
} from '../lib/places'

function fakeCandidate(
  over: Partial<PlaceCandidate> & Pick<PlaceCandidate, 'placeId'>,
): PlaceCandidate {
  return {
    name: `Lugar ${over.placeId}`,
    latitude: -25.4,
    longitude: -49.3,
    // Tipo social por padrão (passa o filtro de venue), sobrescrevível por cenário.
    types: ['bar'],
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
 * determinísticos e conta as chamadas (`calls`, e `lastText` com os params
 * recebidos) para verificar cache hit e roteamento. Injetado via setPlacesClient
 * no setup.ts.
 */
export class FakePlacesService implements IPlacesClient {
  calls = 0
  lastText: SearchTextParams | null = null
  /** Sobrescreva para roteirizar o retorno da Text Search num cenário. */
  override:
    | ((params: { latitude: number; longitude: number }) => PlaceCandidate[])
    | null = null

  async searchText(params: SearchTextParams): Promise<PlaceCandidate[]> {
    this.calls++
    this.lastText = params
    if (this.override) return this.override(params)
    // Determinístico: um candidato "de texto" com tipo social (passa o filtro).
    return [
      fakeCandidate({
        placeId: `fake_text_${params.textQuery}`,
        name: `Resultado: ${params.textQuery}`,
        latitude: params.latitude,
        longitude: params.longitude,
      }),
    ]
  }

  reset(): void {
    this.calls = 0
    this.lastText = null
    this.override = null
  }
}

export const fakePlaces = new FakePlacesService()
