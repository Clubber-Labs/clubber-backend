import { haversineMeters } from '../geo/distance'
import { placesSearchTotal } from '../metrics'
import type {
  IPlacesClient,
  PlaceCandidate,
  SearchTextParams,
} from './places.interface'

const BASE = 'https://places.googleapis.com/v1/places'
const TEXT_ENDPOINT = `${BASE}:searchText`
const DEFAULT_RADIUS_M = 1500
const DEFAULT_LIMIT = 10
const REQUEST_TIMEOUT_MS = 5000

// FieldMask da Text Search: pede só o necessário (controla o tier de cobrança) +
// os sinais de qualidade/relevância (types, userRatingCount) para o ranqueamento.
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
