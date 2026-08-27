import type { GenreKey } from '../../lib/genres'
import { spotifyGenreUnmappedTotal } from '../../lib/metrics'
import type { SpotifyArtist } from '../../lib/spotify'

/**
 * De-para do vocabulário LIVRE do Spotify ("brazilian bass", "funk carioca")
 * para a taxonomia FECHADA do Clubber. É curadoria de produto tanto quanto
 * código: errar aqui personaliza errado, que é pior que não personalizar — por
 * isso o que não tem correspondência honesta fica sem mapa e vai para
 * `unmapped`, que é a fila de trabalho da próxima rodada.
 */

/** Correspondência exata, para o que não pode depender de substring. */
const EXACT: Record<string, GenreKey> = {
  sertanejo: 'GENRE_SERTANEJO',
  'sertanejo universitario': 'GENRE_SERTANEJO',
  'sertanejo pop': 'GENRE_SERTANEJO',
  'sertanejo raiz': 'GENRE_SERTANEJO',
  agronejo: 'GENRE_SERTANEJO',
  arrocha: 'GENRE_SERTANEJO',
  'funk carioca': 'GENRE_FUNK',
  'brazilian funk': 'GENRE_FUNK',
  'funk ostentacao': 'GENRE_FUNK',
  'funk mandelao': 'GENRE_FUNK',
  'funk paulista': 'GENRE_FUNK',
  'funk bh': 'GENRE_FUNK',
  'funk 150 bpm': 'GENRE_FUNK',
  'baile funk': 'GENRE_FUNK',
  'rave funk': 'GENRE_FUNK',
  'brega funk': 'GENRE_FUNK',
  pagode: 'GENRE_PAGODE_SAMBA',
  'pagode baiano': 'GENRE_PAGODE_SAMBA',
  'pagode novo': 'GENRE_PAGODE_SAMBA',
  samba: 'GENRE_PAGODE_SAMBA',
  'samba de roda': 'GENRE_PAGODE_SAMBA',
  'samba enredo': 'GENRE_PAGODE_SAMBA',
  pagodao: 'GENRE_PAGODE_SAMBA',
  forro: 'GENRE_FORRO',
  'forro tradicional': 'GENRE_FORRO',
  'forro universitario': 'GENRE_FORRO',
  piseiro: 'GENRE_PISEIRO',
  'piseiro paraibano': 'GENRE_PISEIRO',
  axe: 'GENRE_AXE',
  'axe music': 'GENRE_AXE',
  pagofunk: 'GENRE_PAGODE_SAMBA',
  // Cena Alok/Vintage Culture: o Spotify chama de "brazilian bass", mas o que
  // toca na pista é house.
  'brazilian bass': 'GENRE_HOUSE',
  'slap house': 'GENRE_HOUSE',
}

/**
 * Regras por palavra-chave, ORDENADAS POR ESPECIFICIDADE — a ordem é o
 * algoritmo. "tech house" tem de ser testado antes de "house", e as vertentes
 * de drum and bass antes de qualquer regra com "funk" (senão "liquid funk"
 * viraria funk carioca).
 */
const KEYWORD_RULES: { match: string[]; key: GenreKey }[] = [
  {
    match: ['drum and bass', 'drum n bass', 'dnb', 'jungle'],
    key: 'GENRE_DNB',
  },
  { match: ['liquid funk', 'neurofunk'], key: 'GENRE_DNB' },
  {
    match: ['psytrance', 'psy trance', 'full on', 'goa trance'],
    key: 'GENRE_PSYTRANCE',
  },
  { match: ['tech house'], key: 'GENRE_TECH_HOUSE' },
  { match: ['techno'], key: 'GENRE_TECHNO' },
  {
    match: ['big room', 'electro house', 'progressive house', 'edm'],
    key: 'GENRE_EDM',
  },
  { match: ['house'], key: 'GENRE_HOUSE' },
  { match: ['sertanejo'], key: 'GENRE_SERTANEJO' },
  { match: ['piseiro'], key: 'GENRE_PISEIRO' },
  { match: ['forro'], key: 'GENRE_FORRO' },
  { match: ['pagode', 'samba'], key: 'GENRE_PAGODE_SAMBA' },
  { match: ['axe'], key: 'GENRE_AXE' },
  { match: ['indie'], key: 'GENRE_INDIE' },
  { match: ['trap', 'hip hop', 'rap'], key: 'GENRE_RAP' },
  { match: ['metal', 'punk', 'rock'], key: 'GENRE_ROCK' },
  { match: ['pop'], key: 'GENRE_POP' },
]

/** Minúsculas, sem acento e sem hífen/pontuação: "Forró" e "forro" são o mesmo. */
function normalize(genre: string): string {
  return (
    genre
      .toLowerCase()
      .normalize('NFD')
      // Marcas diacríticas combinantes que o NFD separou das letras.
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[-_/]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

function resolve(genre: string): GenreKey | null {
  const exact = EXACT[genre]
  if (exact) return exact
  for (const rule of KEYWORD_RULES) {
    if (rule.match.some((m) => genre.includes(m))) return rule.key
  }
  return null
}

export type GenreMappingResult = {
  /** Chaves da taxonomia ordenadas por afinidade (mais forte primeiro). */
  genreKeys: GenreKey[]
  /** Gêneros crus sem correspondência — insumo da curadoria. */
  unmapped: string[]
}

/**
 * Traduz os gêneros dos top artistas em chaves do Clubber, ordenadas por
 * afinidade: cada gênero soma `total - posição do artista`, então o que os
 * artistas mais ouvidos tocam vem primeiro. Essa ordem importa de verdade — o
 * ranking do feed só considera os primeiros interesses do usuário.
 */
export function mapSpotifyGenres(artists: SpotifyArtist[]): GenreMappingResult {
  const scores = new Map<GenreKey, number>()
  const bestRank = new Map<GenreKey, number>()
  const unmapped: string[] = []
  const seenUnmapped = new Set<string>()

  artists.forEach((artist, rank) => {
    const weight = artists.length - rank
    for (const raw of artist.genres) {
      const genre = normalize(raw)
      if (!genre) continue
      const key = resolve(genre)
      if (!key) {
        if (!seenUnmapped.has(genre)) {
          seenUnmapped.add(genre)
          unmapped.push(genre)
          spotifyGenreUnmappedTotal.inc()
        }
        continue
      }
      scores.set(key, (scores.get(key) ?? 0) + weight)
      if (!bestRank.has(key)) bestRank.set(key, rank)
    }
  })

  const genreKeys = [...scores.entries()]
    .sort(([keyA, scoreA], [keyB, scoreB]) => {
      if (scoreB !== scoreA) return scoreB - scoreA
      // Empate: quem apareceu no artista mais bem colocado vem antes.
      return (bestRank.get(keyA) ?? 0) - (bestRank.get(keyB) ?? 0)
    })
    .map(([key]) => key)

  return { genreKeys, unmapped }
}
