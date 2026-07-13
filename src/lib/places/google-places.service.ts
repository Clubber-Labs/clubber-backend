import { haversineMeters } from '../geo/distance'
import { placesSearchTotal } from '../metrics'
import type {
  AutocompleteParams,
  IPlacesClient,
  PlaceCandidate,
  PlaceDetails,
  PlaceSuggestion,
  SearchTextParams,
} from './places.interface'

const BASE = 'https://places.googleapis.com/v1/places'
const TEXT_ENDPOINT = `${BASE}:searchText`
const AUTOCOMPLETE_ENDPOINT = `${BASE}:autocomplete`
const DEFAULT_RADIUS_M = 1500
// Viés do autocomplete: "minha região", não "meu quarteirão" — o raio de 1500m
// da Text Search é curto demais para achar o estabelecimento pelo nome.
const AUTOCOMPLETE_BIAS_RADIUS_M = 50000
const DEFAULT_LIMIT = 10
const REQUEST_TIMEOUT_MS = 5000

// FieldMask da Text Search: pede só o necessário (controla o tier de cobrança) +
// os sinais de qualidade/relevância (types, userRatingCount) para o ranqueamento.
// FieldMask do Autocomplete: só o id e o texto estruturado das predições —
// nada além do necessário para a lista de sugestões.
const AUTOCOMPLETE_FIELD_MASK = [
  'suggestions.placePrediction.placeId',
  'suggestions.placePrediction.structuredFormat',
].join(',')

// FieldMask do Details: campos do tier Essentials. displayName (SKU Pro) fica
// de fora de propósito — o nome do lugar vem da sugestão do autocomplete.
const DETAILS_FIELD_MASK = ['id', 'location', 'formattedAddress', 'types'].join(
  ',',
)

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.types',
  'places.formattedAddress',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.currentOpeningHours.openNow',
].join(',')

type GooglePlace = {
  id: string
  displayName?: { text?: string }
  location: { latitude: number; longitude: number }
  types?: string[]
  formattedAddress?: string
  rating?: number
  userRatingCount?: number
  priceLevel?: string
  currentOpeningHours?: { openNow?: boolean }
}

type GoogleSuggestion = {
  placePrediction?: {
    placeId?: string
    structuredFormat?: {
      mainText?: { text?: string }
      secondaryText?: { text?: string }
    }
  }
}

type GooglePlaceDetails = {
  id: string
  location?: { latitude: number; longitude: number }
  formattedAddress?: string
  types?: string[]
}

/**
 * Impl real do Google Places API (New) — Text Search (busca semântica por uma
 * frase de intenção). Não roda em testes (o setup injeta o fake via
 * setPlacesClient); em produção exige a chave.
 */
export class GooglePlacesService implements IPlacesClient {
  constructor(private readonly apiKey: string) {}

  async searchText(params: SearchTextParams): Promise<PlaceCandidate[]> {
    const body = {
      textQuery: params.textQuery,
      maxResultCount: params.limit ?? DEFAULT_LIMIT,
      // locationBias (não Restriction): o ponto é só viés — a Text Search pode
      // trazer um lugar excelente além do raio quando casa com a intenção.
      locationBias: {
        circle: {
          center: { latitude: params.latitude, longitude: params.longitude },
          radius: params.radiusMeters ?? DEFAULT_RADIUS_M,
        },
      },
    }
    return this.search(body, params.latitude, params.longitude)
  }

  async autocomplete(params: AutocompleteParams): Promise<PlaceSuggestion[]> {
    placesSearchTotal.inc({ type: 'autocomplete' })
    const body = {
      input: params.input,
      // Não muda o preço (a cobrança é por sessão, não por abrangência), mas
      // corta sugestões de outros países — menos sessão desperdiçada.
      includedRegionCodes: ['br'],
      ...(params.sessionToken && { sessionToken: params.sessionToken }),
      ...(params.latitude !== undefined &&
        params.longitude !== undefined && {
          locationBias: {
            circle: {
              center: {
                latitude: params.latitude,
                longitude: params.longitude,
              },
              radius: params.radiusMeters ?? AUTOCOMPLETE_BIAS_RADIUS_M,
            },
          },
        }),
    }

    const res = await this.fetchPlaces(AUTOCOMPLETE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': AUTOCOMPLETE_FIELD_MASK,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      throw {
        statusCode: 502,
        message: `Busca de locais falhou (Places ${res.status})`,
      }
    }

    let data: { suggestions?: GoogleSuggestion[] }
    try {
      data = (await res.json()) as { suggestions?: GoogleSuggestion[] }
    } catch {
      throw { statusCode: 502, message: 'Resposta inválida do Places' }
    }
    return (data.suggestions ?? []).flatMap((s) => {
      // queryPrediction (sugestão de busca, sem lugar) não serve para escolher
      // o local do evento — só predições com placeId entram.
      const p = s.placePrediction
      if (!p?.placeId) return []
      return [
        {
          placeId: p.placeId,
          name: p.structuredFormat?.mainText?.text ?? 'Local',
          address: p.structuredFormat?.secondaryText?.text ?? null,
        },
      ]
    })
  }

  async getDetails(
    placeId: string,
    sessionToken?: string,
  ): Promise<PlaceDetails | null> {
    placesSearchTotal.inc({ type: 'details' })
    // sessionToken aqui FECHA a sessão iniciada no autocomplete — sem ele o
    // Google cobra cada keystroke da sessão como request avulsa.
    const query = sessionToken
      ? `?sessionToken=${encodeURIComponent(sessionToken)}`
      : ''
    const res = await this.fetchPlaces(
      `${BASE}/${encodeURIComponent(placeId)}${query}`,
      {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': DETAILS_FIELD_MASK,
        },
      },
    )
    if (res.status === 404) return null
    if (!res.ok) {
      throw {
        statusCode: 502,
        message: `Busca de locais falhou (Places ${res.status})`,
      }
    }

    let data: GooglePlaceDetails
    try {
      data = (await res.json()) as GooglePlaceDetails
    } catch {
      throw { statusCode: 502, message: 'Resposta inválida do Places' }
    }
    if (!data.location) {
      throw { statusCode: 502, message: 'Resposta inválida do Places' }
    }
    return {
      placeId: data.id,
      latitude: data.location.latitude,
      longitude: data.location.longitude,
      address: data.formattedAddress ?? null,
      types: data.types ?? [],
    }
  }

  /** fetch com timeout; falha de rede/timeout vira 503 (indisponível). */
  private async fetchPlaces(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      throw {
        statusCode: 503,
        message: 'Busca de locais indisponível no momento',
      }
    }
  }

  /** Request + parse + mapeamento da Text Search. */
  private async search(
    body: unknown,
    centerLat: number,
    centerLng: number,
  ): Promise<PlaceCandidate[]> {
    // Conta a chamada (billable) — acompanha o volume e o custo da Text Search.
    placesSearchTotal.inc({ type: 'text' })
    let res: Response
    try {
      res = await fetch(TEXT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify(body),
        // Sem timeout, lentidão do Places deixaria o handler pendurado (Fastify
        // não tem timeout de resposta). Timeout/rede viram 503 (indisponível).
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      throw {
        statusCode: 503,
        message: 'Busca de locais indisponível no momento',
      }
    }

    if (!res.ok) {
      throw {
        statusCode: 502,
        message: `Busca de locais falhou (Places ${res.status})`,
      }
    }

    let data: { places?: GooglePlace[] }
    try {
      data = (await res.json()) as { places?: GooglePlace[] }
    } catch {
      throw { statusCode: 502, message: 'Resposta inválida do Places' }
    }
    return (data.places ?? []).map((p) => ({
      placeId: p.id,
      name: p.displayName?.text ?? 'Local',
      latitude: p.location.latitude,
      longitude: p.location.longitude,
      types: p.types ?? [],
      address: p.formattedAddress ?? null,
      rating: p.rating ?? null,
      userRatingCount: p.userRatingCount ?? null,
      priceLevel: p.priceLevel ?? null,
      openNow: p.currentOpeningHours?.openNow ?? null,
      distanceMeters: haversineMeters(
        centerLat,
        centerLng,
        p.location.latitude,
        p.location.longitude,
      ),
    }))
  }
}
