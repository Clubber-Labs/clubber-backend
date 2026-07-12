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

describe('GooglePlacesService.searchText', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('chama o endpoint de texto com a intenção, viés e os sinais no FieldMask', async () => {
    const before = await searchCount('text')
    const spy = mockFetch([])
    await new GooglePlacesService('key').searchText({
      textQuery: 'bar com música ao vivo',
      ...CENTER,
      radiusMeters: 15000,
      limit: 20,
    })

    // Conta o SKU de Text Search para acompanhar o custo.
    expect(await searchCount('text')).toBe(before + 1)

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('places:searchText')
    const body = JSON.parse(init.body as string)
    expect(body.textQuery).toBe('bar com música ao vivo')
    expect(body.maxResultCount).toBe(20)
    // Viés (não trava): permite resultados além do raio quando relevantes.
    expect(body.locationBias.circle.radius).toBe(15000)
    const fieldMask = (init.headers as Record<string, string>)[
      'X-Goog-FieldMask'
    ]
    expect(fieldMask).toContain('places.types')
    expect(fieldMask).toContain('places.rating')
    expect(fieldMask).toContain('places.userRatingCount')
    expect(fieldMask).toContain('places.priceLevel')
    expect(fieldMask).toContain('places.currentOpeningHours.openNow')
  })

  it('mapeia types, rating, contagem, faixa de preço e aberto-agora', async () => {
    mockFetch([
      {
        id: 't1',
        displayName: { text: 'Bar do Zé' },
        location: { latitude: -23.5614, longitude: -46.6559 },
        types: ['bar', 'point_of_interest'],
        formattedAddress: 'Rua X, 100',
        rating: 4.4,
        userRatingCount: 1200,
        priceLevel: 'PRICE_LEVEL_MODERATE',
        currentOpeningHours: { openNow: true },
      },
    ])

    const [place] = await new GooglePlacesService('key').searchText({
      textQuery: 'bar',
      ...CENTER,
    })

    expect(place.placeId).toBe('t1')
    expect(place.types).toContain('bar') // tipos crus do Places, sem inferência
    expect(place.rating).toBe(4.4)
    expect(place.userRatingCount).toBe(1200)
    expect(place.priceLevel).toBe('PRICE_LEVEL_MODERATE')
    expect(place.openNow).toBe(true)
    expect(place.distanceMeters).toBe(0) // está no centro da busca
  })

  it('calcula distanceMeters do ponto da busca até o local', async () => {
    mockFetch([
      {
        id: 't2',
        displayName: { text: 'Itaú Cultural' },
        location: { latitude: -23.5704, longitude: -46.6459 },
        types: ['cultural_center'],
      },
    ])

    const [place] = await new GooglePlacesService('key').searchText({
      textQuery: 'centro cultural',
      ...CENTER,
    })

    expect(place.distanceMeters).toBeGreaterThan(1200)
    expect(place.distanceMeters).toBeLessThan(1500)
  })

  it('usa null quando o Places não traz os sinais', async () => {
    mockFetch([
      {
        id: 't3',
        displayName: { text: 'Local sem dados' },
        location: { latitude: -23.5614, longitude: -46.6559 },
        types: ['museum'],
      },
    ])

    const [place] = await new GooglePlacesService('key').searchText({
      textQuery: 'museu',
      ...CENTER,
    })

    expect(place.rating).toBeNull()
    expect(place.userRatingCount).toBeNull()
    expect(place.priceLevel).toBeNull()
    expect(place.openNow).toBeNull()
  })
})

function mockFetchJson(payload: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

describe('GooglePlacesService.autocomplete', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('chama places:autocomplete com sessionToken, viés e FieldMask mínimo', async () => {
    const before = await searchCount('autocomplete')
    const spy = mockFetchJson({ suggestions: [] })

    await new GooglePlacesService('key').autocomplete({
      input: 'bar do z',
      ...CENTER,
      radiusMeters: 20000,
      sessionToken: 'sess-123',
    })

    expect(await searchCount('autocomplete')).toBe(before + 1)

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('places:autocomplete')
    const body = JSON.parse(init.body as string)
    expect(body.input).toBe('bar do z')
    expect(body.sessionToken).toBe('sess-123')
    expect(body.locationBias.circle.center.latitude).toBe(CENTER.latitude)
    expect(body.locationBias.circle.radius).toBe(20000)
    const fieldMask = (init.headers as Record<string, string>)[
      'X-Goog-FieldMask'
    ]
    // Só o necessário para a lista de sugestões — nada de SKU cara aqui.
    expect(fieldMask).toBe(
      'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat',
    )
  })

  it('funciona sem coordenadas (sem locationBias) e sem sessionToken', async () => {
    const spy = mockFetchJson({ suggestions: [] })

    await new GooglePlacesService('key').autocomplete({ input: 'boteco' })

    const [, init] = spy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.locationBias).toBeUndefined()
    expect(body.sessionToken).toBeUndefined()
  })

  it('mapeia placeId, nome e endereço das predições e ignora queryPrediction', async () => {
    mockFetchJson({
      suggestions: [
        {
          placePrediction: {
            placeId: 'p1',
            structuredFormat: {
              mainText: { text: 'Bar do Zé' },
              secondaryText: { text: 'Rua X, 100 - Curitiba' },
            },
          },
        },
        { queryPrediction: { text: { text: 'bares perto de mim' } } },
      ],
    })

    const suggestions = await new GooglePlacesService('key').autocomplete({
      input: 'bar do z',
    })

    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toEqual({
      placeId: 'p1',
      name: 'Bar do Zé',
      address: 'Rua X, 100 - Curitiba',
    })
  })

  it('resposta não-ok vira 502', async () => {
    mockFetchJson({}, 500)

    await expect(
      new GooglePlacesService('key').autocomplete({ input: 'bar' }),
    ).rejects.toMatchObject({ statusCode: 502 })
  })
})

describe('GooglePlacesService.getDetails', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('faz GET do place com sessionToken e FieldMask Essentials (sem displayName)', async () => {
    const before = await searchCount('details')
    const spy = mockFetchJson({
      id: 'p1',
      location: { latitude: -23.5614, longitude: -46.6559 },
      formattedAddress: 'Rua X, 100',
      types: ['bar'],
    })

    const details = await new GooglePlacesService('key').getDetails(
      'p1',
      'sess-123',
    )

    expect(await searchCount('details')).toBe(before + 1)

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/places/p1')
    expect(url).toContain('sessionToken=sess-123')
    expect(init.method ?? 'GET').toBe('GET')
    const fieldMask = (init.headers as Record<string, string>)[
      'X-Goog-FieldMask'
    ]
    // displayName é SKU Pro — o nome vem da sugestão do autocomplete, não daqui.
    expect(fieldMask).toBe('id,location,formattedAddress,types')

    expect(details).toEqual({
      placeId: 'p1',
      latitude: -23.5614,
      longitude: -46.6559,
      address: 'Rua X, 100',
      types: ['bar'],
    })
  })

  it('retorna null quando o Places responde 404 (placeId inexistente)', async () => {
    mockFetchJson({}, 404)

    const details = await new GooglePlacesService('key').getDetails('nope')

    expect(details).toBeNull()
  })

  it('outros erros do Places viram 502', async () => {
    mockFetchJson({}, 500)

    await expect(
      new GooglePlacesService('key').getDetails('p1'),
    ).rejects.toMatchObject({ statusCode: 502 })
  })
})
