import { haversineMeters } from '../geo/distance'
import { placesSearchTotal } from '../metrics'
import {
  categoryForPlaceTypes,
  placeTypesForCategories,
} from './place-category-map'
import type {
  IPlacesClient,
  PlaceCandidate,
  SearchNearbyParams,
  SearchTextParams,
} from './places.interface'

const BASE = 'https://places.googleapis.com/v1/places'
const NEARBY_ENDPOINT = `${BASE}:searchNearby`
const TEXT_ENDPOINT = `${BASE}:searchText`
const DEFAULT_RADIUS_M = 1500
const DEFAULT_LIMIT = 10
const REQUEST_TIMEOUT_MS = 5000

// FieldMask único para as duas buscas: pede só o necessário (controla o tier de
// cobrança) + os sinais de qualidade/relevância para o ranqueamento da IA.
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
 * Impl real do Google Places API (New) — Nearby Search (por preferências) e Text
 * Search (por intenção em texto livre). Não roda em testes (o setup injeta o fake
 * via setPlacesClient); em produção exige a chave.
 */
export class GooglePlacesService implements IPlacesClient {
  constructor(private readonly apiKey: string) {}

  async searchNearby(params: SearchNearbyParams): Promise<PlaceCandidate[]> {
    const includedTypes = placeTypesForCategories(params.categories)
    const body = {
      ...(includedTypes.length > 0 && { includedTypes }),
      maxResultCount: params.limit ?? DEFAULT_LIMIT,
      // POPULARITY (e não DISTANCE) para que o raio amplo traga os melhores rolês
      // da região, não só os mais colados no usuário. A IA rebalanceia depois.
      rankPreference: 'POPULARITY',
      locationRestriction: {
        circle: {
          center: { latitude: params.latitude, longitude: params.longitude },
          radius: params.radiusMeters ?? DEFAULT_RADIUS_M,
        },
      },
    }
    return this.search(
      NEARBY_ENDPOINT,
      'nearby',
      body,
      params.latitude,
      params.longitude,
    )
  }

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
    return this.search(
      TEXT_ENDPOINT,
      'text',
      body,
      params.latitude,
      params.longitude,
    )
  }

  /** Request + parse + mapeamento compartilhados entre as duas buscas. */
  private async search(
    endpoint: string,
    type: 'nearby' | 'text',
    body: unknown,
    centerLat: number,
    centerLng: number,
  ): Promise<PlaceCandidate[]> {
    // Conta a chamada (billable) por tipo de SKU, antes de disparar o request.
    placesSearchTotal.inc({ type })
    let res: Response
    try {
      res = await fetch(endpoint, {
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
      category: categoryForPlaceTypes(p.types ?? []),
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
