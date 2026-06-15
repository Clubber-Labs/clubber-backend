import { afterEach, describe, expect, it, vi } from 'vitest'
import { placesSearchTotal } from '../metrics'
import { GooglePlacesService } from './google-places.service'

/** Valor atual do contador de buscas do Places para um tipo (0 se ausente). */
async function searchCount(type: string): Promise<number> {
  const metric = await placesSearchTotal.get()
  return metric.values.find((v) => v.labels.type === type)?.value ?? 0
}

function mockFetch(places: unknown[]) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ places }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

const CENTER = { latitude: -23.5614, longitude: -46.6559 }

describe('GooglePlacesService.searchNearby', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('pede os sinais de qualidade no FieldMask', async () => {
    const spy = mockFetch([])
    await new GooglePlacesService('key').searchNearby({
      ...CENTER,
      categories: ['ART'],
    })

    const headers = spy.mock.calls[0]?.[1]?.headers as Record<string, string>
    const fieldMask = headers['X-Goog-FieldMask']
    expect(fieldMask).toContain('places.rating')
    expect(fieldMask).toContain('places.userRatingCount')
    expect(fieldMask).toContain('places.priceLevel')
    expect(fieldMask).toContain('places.currentOpeningHours.openNow')
  })

  it('mapeia rating, contagem, faixa de preço e aberto-agora', async () => {
    mockFetch([
      {
        id: 'p1',
        displayName: { text: 'MASP' },
        location: { latitude: -23.5614, longitude: -46.6559 },
        types: ['museum'],
        formattedAddress: 'Av. Paulista, 1578',
        rating: 4.7,
        userRatingCount: 92000,
        priceLevel: 'PRICE_LEVEL_MODERATE',
        currentOpeningHours: { openNow: true },
      },
    ])

    const [place] = await new GooglePlacesService('key').searchNearby({
      ...CENTER,
      categories: ['ART'],
    })

    expect(place.rating).toBe(4.7)
    expect(place.userRatingCount).toBe(92000)
    expect(place.priceLevel).toBe('PRICE_LEVEL_MODERATE')
    expect(place.openNow).toBe(true)
    expect(place.distanceMeters).toBe(0) // está no centro da busca
  })

  it('calcula distanceMeters do ponto da busca até o local', async () => {
    mockFetch([
      {
        id: 'p2',
        displayName: { text: 'Itaú Cultural' },
        location: { latitude: -23.5704, longitude: -46.6459 },
        types: ['art_gallery'],
      },
    ])

    const [place] = await new GooglePlacesService('key').searchNearby({
      ...CENTER,
      categories: ['ART'],
    })

    expect(place.distanceMeters).toBeGreaterThan(1200)
    expect(place.distanceMeters).toBeLessThan(1500)
  })

  it('busca por popularidade no raio pedido (Nearby)', async () => {
    const spy = mockFetch([])
    await new GooglePlacesService('key').searchNearby({
      ...CENTER,
      categories: ['ART'],
      radiusMeters: 40000,
      limit: 20,
    })

    const body = JSON.parse(spy.mock.calls[0]?.[1]?.body as string)
    expect(body.rankPreference).toBe('POPULARITY')
    expect(body.maxResultCount).toBe(20)
    expect(body.locationRestriction.circle.radius).toBe(40000)
  })

  it('usa null quando o Places não traz os sinais', async () => {
    mockFetch([
      {
        id: 'p3',
        displayName: { text: 'Local sem dados' },
        location: { latitude: -23.5614, longitude: -46.6559 },
        types: ['museum'],
      },
    ])

    const [place] = await new GooglePlacesService('key').searchNearby({
      ...CENTER,
      categories: ['ART'],
    })

    expect(place.rating).toBeNull()
    expect(place.userRatingCount).toBeNull()
    expect(place.priceLevel).toBeNull()
    expect(place.openNow).toBeNull()
  })
})

describe('GooglePlacesService.searchText', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('chama o endpoint de texto com a intenção e viés de localização', async () => {
    const before = await searchCount('text')
    const spy = mockFetch([])
    await new GooglePlacesService('key').searchText({
      textQuery: 'bar com música ao vivo',
      ...CENTER,
      radiusMeters: 15000,
      limit: 20,
    })

    // Conta o SKU de Text Search (mais caro) para acompanhar o custo.
    expect(await searchCount('text')).toBe(before + 1)

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('places:searchText')
    const body = JSON.parse(init.body as string)
    expect(body.textQuery).toBe('bar com música ao vivo')
    expect(body.maxResultCount).toBe(20)
    // Viés (não trava): permite resultados além do raio quando relevantes.
    expect(body.locationBias.circle.radius).toBe(15000)
    const headers = init.headers as Record<string, string>
    expect(headers['X-Goog-FieldMask']).toContain('places.rating')
  })

  it('mapeia candidatos com sinais e distância (igual à Nearby)', async () => {
    mockFetch([
      {
        id: 't1',
        displayName: { text: 'Bar do Zé' },
        location: { latitude: -23.5704, longitude: -46.6459 },
        types: ['bar'],
        rating: 4.4,
        userRatingCount: 1200,
        currentOpeningHours: { openNow: true },
      },
    ])

    const [place] = await new GooglePlacesService('key').searchText({
      textQuery: 'bar',
      ...CENTER,
    })

    expect(place.placeId).toBe('t1')
    expect(place.category).toBe('PARTY') // bar → PARTY no mapa reverso
    expect(place.rating).toBe(4.4)
    expect(place.openNow).toBe(true)
    expect(place.distanceMeters).toBeGreaterThan(1200)
  })
})
