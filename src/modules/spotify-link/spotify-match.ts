import { readSnapshotArtists, spotifyArtistUrl } from './spotify-link.service'

/** Quantos artistas em comum ganham nome e foto na tela. */
const NAMED_MATCH_LIMIT = 3

export type SharedArtist = {
  id: string
  name: string
  imageUrl: string | null
  spotifyUrl: string
}

/**
 * `named` vem vazio quando o dono do perfil escondeu os artistas: nesse caso
 * só a contagem sai, porque revelar os nomes desfaria a escolha dele.
 */
export type ArtistMatch = {
  count: number
  named: SharedArtist[]
}

/**
 * Artistas que duas pessoas ouvem em comum.
 *
 * A contagem sai sobre o snapshot INTEIRO (os 20 sincronizados), não sobre os
 * poucos que o perfil exibe. É o que mantém a versão só-contagem segura: com a
 * base pequena, "5 em comum" contra uma lista visível de 5 entregaria a lista
 * inteira de quem pediu para não aparecer.
 */
export function matchArtists(
  viewerArtists: unknown,
  targetArtists: unknown,
  opts: { revealNames: boolean },
): ArtistMatch | null {
  const mine = readSnapshotArtists(viewerArtists)
  const theirs = readSnapshotArtists(targetArtists)
  if (mine.length === 0 || theirs.length === 0) return null

  const mineIds = new Set(mine.map((a) => a.id))
  // Percorre a lista do DONO do perfil: a ordem dele é que decide quais
  // aparecem primeiro, então o destaque é do gosto de quem está sendo visto.
  const shared = theirs.filter((a) => mineIds.has(a.id))
  if (shared.length === 0) return null

  return {
    count: shared.length,
    named: opts.revealNames
      ? shared.slice(0, NAMED_MATCH_LIMIT).map((a) => ({
          id: a.id,
          name: a.name,
          imageUrl: a.imageUrl,
          spotifyUrl: spotifyArtistUrl(a.id),
        }))
      : [],
  }
}
