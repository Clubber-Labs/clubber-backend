import { AppError } from '../../lib/errors/app-error'
import type { Locale } from '../../lib/i18n/locale'
import { getPlacesClient } from '../../lib/places'
import type { PlacesAutocompleteQuery } from './places.schema'

export async function autocompletePlaces(
  query: PlacesAutocompleteQuery,
  locale: Locale,
) {
  const suggestions = await getPlacesClient().autocomplete({
    input: query.q,
    latitude: query.lat,
    longitude: query.lng,
    radiusMeters: query.radiusMeters,
    sessionToken: query.sessionToken,
    languageCode: locale,
  })
  return { suggestions }
}

export async function getPlaceDetails(
  placeId: string,
  locale: Locale,
  sessionToken?: string,
) {
  const details = await getPlacesClient().getDetails(
    placeId,
    sessionToken,
    locale,
  )
  if (!details) throw new AppError(404, 'PLACE_NOT_FOUND')
  return details
}
