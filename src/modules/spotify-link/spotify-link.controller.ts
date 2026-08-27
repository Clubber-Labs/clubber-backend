import type { FastifyReply, FastifyRequest } from 'fastify'
import { extractRequestMeta } from '../../lib/request-meta'
import type {
  ApplyGenresBody,
  HiddenArtistsBody,
  LinkSpotifyBody,
} from './spotify-link.schema'
import {
  applyImportedGenres,
  getSpotifyProfileState,
  linkSpotifyAccount,
  setHiddenArtists,
  unlinkSpotifyAccount,
} from './spotify-link.service'

export async function postSpotifyLink(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const profile = await linkSpotifyAccount(
    request.user.sub,
    request.body as LinkSpotifyBody,
    extractRequestMeta(request),
  )
  request.log.info({ userId: request.user.sub }, 'Spotify account linked')
  return reply.status(201).send(profile)
}

export async function deleteSpotifyLink(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  await unlinkSpotifyAccount(request.user.sub, extractRequestMeta(request))
  request.log.info({ userId: request.user.sub }, 'Spotify account unlinked')
  return reply.status(204).send()
}

export async function getSpotifyProfile(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  return reply.send(await getSpotifyProfileState(request.user.sub))
}

export async function postApplyGenres(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = await applyImportedGenres(
    request.user.sub,
    request.body as ApplyGenresBody,
  )
  return reply.send(result)
}

export async function patchHiddenArtists(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { hiddenArtistIds } = request.body as HiddenArtistsBody
  return reply.send(await setHiddenArtists(request.user.sub, hiddenArtistIds))
}
