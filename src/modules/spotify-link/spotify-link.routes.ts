import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { rateLimit } from '../../lib/rate-limit'
import {
  deleteSpotifyLink,
  getSpotifyProfile,
  patchHiddenArtists,
  postApplyGenres,
  postSpotifyLink,
} from './spotify-link.controller'
import {
  applyGenresBodySchema,
  applyGenresResponseSchema,
  hiddenArtistsBodySchema,
  linkSpotifyBodySchema,
  spotifyProfileResponseSchema,
} from './spotify-link.schema'

export async function spotifyLinkRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  // Limite baixo: cada tentativa gasta uma troca de code no Spotify.
  api.post(
    '/spotify/link',
    {
      schema: {
        body: linkSpotifyBodySchema,
        response: { 201: spotifyProfileResponseSchema },
      },
      config: { rateLimit: rateLimit(5) },
      onRequest: [app.authenticate],
    },
    postSpotifyLink,
  )

  api.delete(
    '/spotify/link',
    {
      config: { rateLimit: rateLimit(10) },
      onRequest: [app.authenticate],
    },
    deleteSpotifyLink,
  )

  api.get(
    '/spotify/profile',
    {
      schema: { response: { 200: spotifyProfileResponseSchema } },
      config: { rateLimit: rateLimit(60) },
      onRequest: [app.authenticate],
    },
    getSpotifyProfile,
  )

  api.post(
    '/spotify/apply-genres',
    {
      schema: {
        body: applyGenresBodySchema,
        response: { 200: applyGenresResponseSchema },
      },
      config: { rateLimit: rateLimit(10) },
      onRequest: [app.authenticate],
    },
    postApplyGenres,
  )

  api.patch(
    '/spotify/hidden-artists',
    {
      schema: {
        body: hiddenArtistsBodySchema,
        response: { 200: spotifyProfileResponseSchema },
      },
      config: { rateLimit: rateLimit(30) },
      onRequest: [app.authenticate],
    },
    patchHiddenArtists,
  )
}
