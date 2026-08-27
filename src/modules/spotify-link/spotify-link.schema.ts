import { z } from 'zod'
import { env } from '../../lib/env'
import { GENRE_KEYS } from '../../lib/genres'
import type { SpotifyTimeRange } from '../../lib/spotify'

/**
 * As três janelas do /me/top/artists, da mais recente para a mais longa. "O que
 * ouço agora" e "o que sempre ouvi" são perguntas diferentes, e a mesma chamada
 * responde as duas — só muda o parâmetro.
 */
export const SPOTIFY_TIME_RANGES = [
  'short_term',
  'medium_term',
  'long_term',
] as const satisfies readonly SpotifyTimeRange[]

/**
 * Janela que responde por "o gosto" quando não há escolha: alimenta os gêneros
 * importados, o match entre perfis e o perfil de quem não ligou o seletor.
 * Seis meses equilibra atual e estável — o curto oscila demais pra virar
 * identidade.
 */
export const DEFAULT_TIME_RANGE = env.SPOTIFY_TOP_TIME_RANGE as SpotifyTimeRange

/**
 * O app manda só o que o fluxo PKCE produziu. `redirectUri` NÃO vem do cliente:
 * o backend usa o valor da env, que é o registrado no Dashboard — aceitar do
 * cliente permitiria desviar a troca do code para outro destino.
 */
export const linkSpotifyBodySchema = z.object({
  code: z.string().min(1).max(1024),
  // Faixa do RFC 7636 para o code_verifier.
  codeVerifier: z.string().min(43).max(128),
})

/**
 * Subconjunto opcional dos gêneros importados — o app deixa o usuário desmarcar
 * antes de aplicar. Omitido = aplica tudo o que o snapshot trouxe. As chaves são
 * validadas contra a NOSSA taxonomia, e o service ainda confere que pertencem ao
 * snapshot do usuário (o cliente não decide o que ele "ouve").
 */
export const applyGenresBodySchema = z.object({
  genres: z
    .array(z.enum(GENRE_KEYS as [string, ...string[]]))
    .max(GENRE_KEYS.length)
    .optional(),
})

/** Ids de artista do Spotify: base62 de 22 caracteres. */
export const hiddenArtistsBodySchema = z.object({
  hiddenArtistIds: z.array(z.string().regex(/^[0-9A-Za-z]{22}$/)).max(50),
})

const spotifyArtistResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  imageUrl: z.string().nullable(),
  /// Atribuição exigida pelas guidelines do Spotify: o artista leva de volta pra lá.
  spotifyUrl: z.string(),
  rank: z.number().int(),
  /// Só no perfil do dono: no público o artista oculto simplesmente não vem.
  hidden: z.boolean(),
})

export const spotifyProfileResponseSchema = z.object({
  linked: z.boolean(),
  status: z.enum(['ACTIVE', 'REVOKED']).nullable(),
  displayName: z.string().nullable(),
  lastSyncedAt: z.date().nullable(),
  artistsVisible: z.boolean(),
  genres: z.array(z.string()),
  artists: z.array(spotifyArtistResponseSchema),
})

export const applyGenresResponseSchema = z.object({
  applied: z.array(z.string()),
  interests: z.array(z.string()),
})

export type LinkSpotifyBody = z.infer<typeof linkSpotifyBodySchema>
export type ApplyGenresBody = z.infer<typeof applyGenresBodySchema>
export type HiddenArtistsBody = z.infer<typeof hiddenArtistsBodySchema>

/** Formato dos artistas dentro do Json do snapshot (validado na leitura). */
export const snapshotArtistSchema = z.object({
  id: z.string(),
  name: z.string(),
  imageUrl: z.string().nullable(),
  genres: z.array(z.string()),
  rank: z.number().int(),
})

export const snapshotArtistsSchema = z.array(snapshotArtistSchema)

export type SnapshotArtist = z.infer<typeof snapshotArtistSchema>
