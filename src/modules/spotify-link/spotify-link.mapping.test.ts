import { describe, expect, it } from 'vitest'
import type { SpotifyArtist } from '../../lib/spotify'
import { mapSpotifyGenres } from './spotify-link.mapping'

function artist(genres: string[], over: Partial<SpotifyArtist> = {}) {
  return {
    id: over.id ?? 'artist',
    name: over.name ?? 'Artista',
    imageUrl: null,
    genres,
  }
}

/** Um artista só, para checar o de-para de um gênero isolado. */
function mapOne(genre: string) {
  return mapSpotifyGenres([artist([genre])])
}

describe('de-para de gêneros do Spotify', () => {
  it.each([
    ['sertanejo', 'GENRE_SERTANEJO'],
    ['sertanejo universitario', 'GENRE_SERTANEJO'],
    ['agronejo', 'GENRE_SERTANEJO'],
    ['arrocha', 'GENRE_SERTANEJO'],
    ['funk carioca', 'GENRE_FUNK'],
    ['brazilian funk', 'GENRE_FUNK'],
    ['funk ostentacao', 'GENRE_FUNK'],
    ['funk mandelao', 'GENRE_FUNK'],
    ['pagode', 'GENRE_PAGODE_SAMBA'],
    ['samba', 'GENRE_PAGODE_SAMBA'],
    ['pagode baiano', 'GENRE_PAGODE_SAMBA'],
    ['forro', 'GENRE_FORRO'],
    ['piseiro', 'GENRE_PISEIRO'],
    ['axe', 'GENRE_AXE'],
    ['rock', 'GENRE_ROCK'],
    ['hard rock', 'GENRE_ROCK'],
    ['punk', 'GENRE_ROCK'],
    ['heavy metal', 'GENRE_ROCK'],
    ['pop', 'GENRE_POP'],
    ['k-pop', 'GENRE_POP'],
    ['pop nacional', 'GENRE_POP'],
    ['rap', 'GENRE_RAP'],
    ['hip hop', 'GENRE_RAP'],
    ['trap brasileiro', 'GENRE_RAP'],
    ['indie', 'GENRE_INDIE'],
    ['indie rock', 'GENRE_INDIE'],
    ['house', 'GENRE_HOUSE'],
    ['deep house', 'GENRE_HOUSE'],
    ['afro house', 'GENRE_HOUSE'],
    ['brazilian bass', 'GENRE_HOUSE'],
    ['tech house', 'GENRE_TECH_HOUSE'],
    ['techno', 'GENRE_TECHNO'],
    ['melodic techno', 'GENRE_TECHNO'],
    ['psytrance', 'GENRE_PSYTRANCE'],
    ['full on', 'GENRE_PSYTRANCE'],
    ['drum and bass', 'GENRE_DNB'],
    ['dnb', 'GENRE_DNB'],
    ['jungle', 'GENRE_DNB'],
    ['edm', 'GENRE_EDM'],
    ['big room', 'GENRE_EDM'],
    ['electro house', 'GENRE_EDM'],
  ])('mapeia "%s" para %s', (spotifyGenre, expected) => {
    expect(mapOne(spotifyGenre).genreKeys).toEqual([expected])
  })

  it('normaliza acento, caixa e espaço', () => {
    expect(mapOne('  SERTANEJO Universitário  ').genreKeys).toEqual([
      'GENRE_SERTANEJO',
    ])
    expect(mapOne('Forró').genreKeys).toEqual(['GENRE_FORRO'])
  })

  // A ordem das regras É o algoritmo: a mais específica precisa vencer.
  it('prefere tech house a house', () => {
    expect(mapOne('brazilian tech house').genreKeys).toEqual([
      'GENRE_TECH_HOUSE',
    ])
  })

  it('mapeia liquid funk como drum and bass, não como funk', () => {
    expect(mapOne('liquid funk').genreKeys).toEqual(['GENRE_DNB'])
  })

  it('não confunde funk americano com funk carioca', () => {
    const result = mapOne('funk')
    expect(result.genreKeys).toEqual([])
    expect(result.unmapped).toEqual(['funk'])
  })

  it('deixa gênero desconhecido sem mapa em vez de chutar', () => {
    const result = mapSpotifyGenres([artist(['mpb', 'bossa nova'])])
    expect(result.genreKeys).toEqual([])
    expect(result.unmapped).toEqual(['mpb', 'bossa nova'])
  })

  it('não repete gênero nem chave no resultado', () => {
    const result = mapSpotifyGenres([
      artist(['house', 'deep house'], { id: 'a' }),
      artist(['house'], { id: 'b' }),
      artist(['xote', 'xote'], { id: 'c' }),
    ])
    expect(result.genreKeys).toEqual(['GENRE_HOUSE'])
    expect(result.unmapped).toEqual(['xote'])
  })

  it('ordena por afinidade: o gênero dos artistas mais ouvidos vem antes', () => {
    // Rank 0 é o artista mais ouvido; techno aparece só no último.
    const result = mapSpotifyGenres([
      artist(['house'], { id: '1' }),
      artist(['house'], { id: '2' }),
      artist(['techno'], { id: '3' }),
    ])
    expect(result.genreKeys).toEqual(['GENRE_HOUSE', 'GENRE_TECHNO'])
  })

  it('desempata pelo artista mais bem colocado', () => {
    const result = mapSpotifyGenres([
      artist(['rap'], { id: '1' }),
      artist(['pop'], { id: '2' }),
    ])
    expect(result.genreKeys).toEqual(['GENRE_RAP', 'GENRE_POP'])
  })

  it('devolve vazio para lista sem artistas', () => {
    expect(mapSpotifyGenres([])).toEqual({ genreKeys: [], unmapped: [] })
  })

  it('só devolve chaves que existem na taxonomia do Clubber', async () => {
    const { GENRE_KEYS } = await import('../../lib/genres')
    const result = mapSpotifyGenres([
      artist(['funk carioca', 'sertanejo', 'techno', 'psytrance']),
    ])
    for (const key of result.genreKeys) {
      expect(GENRE_KEYS).toContain(key)
    }
  })
})
