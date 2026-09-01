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
    // Sem includeReviews o mask NÃO pede reviews — é o que segura a chamada na
    // SKU Enterprise em vez de Enterprise+Atmosphere.
    expect(fieldMask).not.toContain('places.reviews')
  })

  it('includeReviews adiciona places.reviews ao FieldMask e mapeia só o texto', async () => {
    const spy = mockFetch([
      {
        id: 't1',
        displayName: { text: 'Bar do Zé' },
        location: { latitude: -23.5614, longitude: -46.6559 },
        reviews: [
          {
            text: { text: 'sempre tem banda' },
            authorAttribution: { displayName: 'Fulano' },
            rating: 5,
          },
          { text: { text: '' } },
          { text: { text: 'área externa boa' } },
          { text: { text: 'r3' } },
          { text: { text: 'r4' } },
          { text: { text: 'r5 além do teto' } },
        ],
      },
    ])

    const [place] = await new GooglePlacesService('key').searchText({
      textQuery: 'bar',
      ...CENTER,
      includeReviews: true,
    })

    const [, init] = spy.mock.calls[0] as [string, RequestInit]
    const fieldMask = (init.headers as Record<string, string>)[
      'X-Goog-FieldMask'
    ]
    expect(fieldMask).toContain('places.reviews')
    // Só o texto sai do adapter (autor/nota da review morrem aqui), texto vazio
    // cai fora e o teto é de 5 por lugar.
    expect(place.reviews).toEqual([
      'sempre tem banda',
      'área externa boa',
      'r3',
      'r4',
    ])
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
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => jsonResponse(payload, status))
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
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

    // Mock vazio dispara a segunda passada — cada chamada conta na métrica.
    expect(await searchCount('autocomplete')).toBe(before + 2)

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('places:autocomplete')
    const body = JSON.parse(init.body as string)
    expect(body.input).toBe('bar do z')
    expect(body.sessionToken).toBe('sess-123')
    // Primeira passada RESTRITA ao círculo: é o que impede "shanghai club" de
    // sugerir Malásia antes do bar da cidade — e vale em qualquer país, ao
    // contrário do filtro por país que só servia a quem estava no Brasil.
    expect(body.locationRestriction.circle.center.latitude).toBe(
      CENTER.latitude,
    )
    expect(body.locationRestriction.circle.radius).toBe(20000)
    expect(body.locationBias).toBeUndefined()
    expect(body.includedRegionCodes).toBeUndefined()
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
    expect(body.locationRestriction).toBeUndefined()
    expect(body.sessionToken).toBeUndefined()
    expect(body.includedRegionCodes).toBeUndefined()
    // Sem "perto" para priorizar, a segunda passada não teria o que somar.
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('sem radiusMeters, o viés cobre a região (50km), não o raio da Text Search', async () => {
    const spy = mockFetchJson({ suggestions: [] })

    await new GooglePlacesService('key').autocomplete({
      input: 'bar do z',
      ...CENTER,
    })

    const [, init] = spy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.locationRestriction.circle.radius).toBe(50000)
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

  function suggestion(placeId: string, name: string) {
    return {
      placePrediction: {
        placeId,
        structuredFormat: { mainText: { text: name } },
      },
    }
  }

  it('lista cheia perto: não faz a segunda passada', async () => {
    const spy = mockFetchJson({
      suggestions: [
        suggestion('br1', 'Bar A'),
        suggestion('br2', 'Bar B'),
        suggestion('br3', 'Bar C'),
        suggestion('br4', 'Bar D'),
        suggestion('br5', 'Bar E'),
      ],
    })

    const suggestions = await new GooglePlacesService('key').autocomplete({
      input: 'bar',
      ...CENTER,
    })

    expect(suggestions).toHaveLength(5)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('lista incompleta perto: completa com o longe sem duplicar (caso Berghain)', async () => {
    // Homônimo perto ("Berghain Cervejaria" em Timbó/SC) não pode esconder o
    // lugar real lá fora — a segunda passada complementa, com o perto na frente.
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          suggestions: [suggestion('br_cervejaria', 'Berghain Cervejaria')],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          suggestions: [
            suggestion('br_cervejaria', 'Berghain Cervejaria'),
            suggestion('berghain_berlin', 'Berghain'),
          ],
        }),
      )

    const suggestions = await new GooglePlacesService('key').autocomplete({
      input: 'berghain',
      ...CENTER,
      sessionToken: 'sess-123',
    })

    expect(spy).toHaveBeenCalledTimes(2)
    const first = JSON.parse(
      (spy.mock.calls[0][1] as RequestInit).body as string,
    )
    const second = JSON.parse(
      (spy.mock.calls[1][1] as RequestInit).body as string,
    )
    expect(first.locationRestriction).toBeDefined()
    expect(second.locationRestriction).toBeUndefined()
    // Bias na segunda: alcança o de fora do círculo sem perder o peso do perto.
    expect(second.locationBias.circle).toEqual(first.locationRestriction.circle)
    // Mesma sessão: a chamada extra do complemento não gera cobrança nova.
    expect(second.sessionToken).toBe('sess-123')

    expect(suggestions.map((s) => s.placeId)).toEqual([
      'br_cervejaria',
      'berghain_berlin',
    ])
  })

  it('sem match perto, a lista vem só da segunda passada', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ suggestions: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ suggestions: [suggestion('berghain', 'Berghain')] }),
      )

    const suggestions = await new GooglePlacesService('key').autocomplete({
      input: 'berghain',
      ...CENTER,
    })

    expect(suggestions.map((s) => s.placeId)).toEqual(['berghain'])
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

describe('GooglePlacesService.autocomplete — alcance geográfico', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function prediction(placeId: string, name: string) {
    return {
      placePrediction: {
        placeId,
        structuredFormat: { mainText: { text: name } },
      },
    }
  }

  // A regressão que motivou a mudança: com filtro fixo no país de lançamento,
  // esta lista vinha cheia de homônimos brasileiros e a segunda passada nem
  // acontecia — o bar da esquina de quem está fora nunca aparecia.
  it('quem está fora do país de lançamento vê o que está perto de si', async () => {
    const NEW_YORK = { latitude: 40.73, longitude: -73.99 }
    const spy = mockFetchJson({
      suggestions: [prediction('nyc_bar', 'Blue Note NYC')],
    })

    const suggestions = await new GooglePlacesService('key').autocomplete({
      input: 'blue note',
      ...NEW_YORK,
    })

    const body = JSON.parse(
      (spy.mock.calls[0][1] as RequestInit).body as string,
    )
    expect(body.locationRestriction.circle.center).toEqual({
      latitude: NEW_YORK.latitude,
      longitude: NEW_YORK.longitude,
    })
    expect(body.includedRegionCodes).toBeUndefined()
    expect(suggestions[0].placeId).toBe('nyc_bar')
  })

  it('manda o languageCode nas duas passadas', async () => {
    const spy = mockFetchJson({ suggestions: [] })

    await new GooglePlacesService('key').autocomplete({
      input: 'bar',
      ...CENTER,
      languageCode: 'en',
    })

    expect(spy).toHaveBeenCalledTimes(2)
    for (const call of spy.mock.calls) {
      const body = JSON.parse((call[1] as RequestInit).body as string)
      expect(body.languageCode).toBe('en')
    }
  })
})
