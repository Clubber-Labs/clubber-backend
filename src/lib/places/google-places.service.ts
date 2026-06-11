import {
  categoryForPlaceTypes,
  placeTypesForCategories,
} from './place-category-map'
import type {
  IPlacesClient,
  PlaceCandidate,
  SearchNearbyParams,
} from './places.interface'

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby'
const DEFAULT_RADIUS_M = 1500
const DEFAULT_LIMIT = 10
const REQUEST_TIMEOUT_MS = 5000

type GooglePlace = {
  id: string
  displayName?: { text?: string }
  location: { latitude: number; longitude: number }
  types?: string[]
  formattedAddress?: string
}

/**
 * Impl real do Google Places API (New) — Nearby Search. Não roda em testes
 * (o setup injeta o fake via setPlacesClient); em produção exige a chave.
 * O FieldMask pede só o necessário, controlando o tier de cobrança.
 */
export class GooglePlacesService implements IPlacesClient {
  constructor(private readonly apiKey: string) {}

  async searchNearby(params: SearchNearbyParams): Promise<PlaceCandidate[]> {
    const includedTypes = placeTypesForCategories(params.categories)
    const body = {
      ...(includedTypes.length > 0 && { includedTypes }),
      maxResultCount: params.limit ?? DEFAULT_LIMIT,
      locationRestriction: {
        circle: {
          center: { latitude: params.latitude, longitude: params.longitude },
          radius: params.radiusMeters ?? DEFAULT_RADIUS_M,
        },
      },
    }

    let res: Response
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': [
            'places.id',
            'places.displayName',
            'places.location',
            'places.types',
            'places.formattedAddress',
          ].join(','),
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

    const data = (await res.json()) as { places?: GooglePlace[] }
    return (data.places ?? []).map((p) => ({
      placeId: p.id,
      name: p.displayName?.text ?? 'Local',
      latitude: p.location.latitude,
      longitude: p.location.longitude,
      category: categoryForPlaceTypes(p.types ?? []),
      address: p.formattedAddress ?? null,
    }))
  }
}
