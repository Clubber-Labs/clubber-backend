import type {
  AutocompleteParams,
  IPlacesClient,
  PlaceCandidate,
  PlaceDetails,
  PlaceSuggestion,
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
  autocompleteCalls = 0
  lastAutocomplete: AutocompleteParams | null = null
  detailsCalls = 0
  lastDetails: { placeId: string; sessionToken?: string } | null = null
  /** Sobrescreva para roteirizar o retorno da Text Search num cenário. */
  override:
    | ((params: { latitude: number; longitude: number }) => PlaceCandidate[])
    | null = null
  /** Sobrescreva para roteirizar o Details (null = placeId inexistente). */
  detailsOverride: ((placeId: string) => PlaceDetails | null) | null = null

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

  async autocomplete(params: AutocompleteParams): Promise<PlaceSuggestion[]> {
    this.autocompleteCalls++
    this.lastAutocomplete = params
    return [
      {
        placeId: `fake_ac_${params.input}`,
        name: `Sugestão: ${params.input}`,
        address: 'Rua Fake, 100 - Curitiba',
      },
    ]
  }

  async getDetails(
    placeId: string,
    sessionToken?: string,
  ): Promise<PlaceDetails | null> {
    this.detailsCalls++
    this.lastDetails = { placeId, sessionToken }
    if (this.detailsOverride) return this.detailsOverride(placeId)
    return {
      placeId,
      latitude: -25.4,
      longitude: -49.3,
      address: 'Rua Fake, 100 - Curitiba',
      types: ['bar'],
    }
  }

  reset(): void {
    this.calls = 0
    this.lastText = null
    this.autocompleteCalls = 0
    this.lastAutocomplete = null
    this.detailsCalls = 0
    this.lastDetails = null
    this.override = null
    this.detailsOverride = null
  }
}

export const fakePlaces = new FakePlacesService()
