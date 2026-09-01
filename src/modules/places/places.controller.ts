import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  PlaceDetailsParams,
  PlaceDetailsQuery,
  PlacesAutocompleteQuery,
} from './places.schema'
import { autocompletePlaces, getPlaceDetails } from './places.service'

export async function getAutocomplete(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const query = request.query as PlacesAutocompleteQuery
  const result = await autocompletePlaces(query, request.locale)
  return reply.send(result)
}

export async function getDetails(request: FastifyRequest, reply: FastifyReply) {
  const { placeId } = request.params as PlaceDetailsParams
  const { sessionToken } = request.query as PlaceDetailsQuery
  const details = await getPlaceDetails(placeId, request.locale, sessionToken)
  return reply.send(details)
}
