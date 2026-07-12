import { getPlacesClient } from '../../lib/places'
import type { PlacesAutocompleteQuery } from './places.schema'

export async function autocompletePlaces(query: PlacesAutocompleteQuery) {
  const suggestions = await getPlacesClient().autocomplete({
    input: query.q,
    latitude: query.lat,
    longitude: query.lng,
    radiusMeters: query.radiusMeters,
    sessionToken: query.sessionToken,
  })
  return { suggestions }
}

export async function getPlaceDetails(placeId: string, sessionToken?: string) {
  const details = await getPlacesClient().getDetails(placeId, sessionToken)
  if (!details) throw { statusCode: 404, message: 'Local não encontrado' }
  return details
}
