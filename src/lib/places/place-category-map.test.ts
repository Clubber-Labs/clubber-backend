import { describe, expect, it } from 'vitest'
import {
  categoryForPlaceTypes,
  placeTypesForCategories,
  placeTypesForSubcategories,
  subcategoryForPlaceTypes,
} from './place-category-map'

describe('placeTypesForCategories (derivado das subcategorias)', () => {
  it('une os tipos das subcategorias do pai', () => {
    const g = placeTypesForCategories(['GASTRONOMY'])
    expect(g).toContain('restaurant')
    expect(g).toContain('pizza_restaurant')
    expect(g).toContain('sushi_restaurant')
    expect(placeTypesForCategories(['CAFE'])).toContain('coffee_shop')
  })

  it('mantém órfãs sem equivalente social como lista vazia', () => {
    for (const c of ['TECH', 'BUSINESS', 'VOLUNTEERING', 'OTHER'] as const) {
      expect(placeTypesForCategories([c])).toEqual([])
    }
  })

  it('não devolve duplicatas', () => {
    const types = placeTypesForCategories(['GASTRONOMY', 'CAFE', 'SPORTS'])
    expect(new Set(types).size).toBe(types.length)
  })
})

describe('placeTypesForSubcategories (busca precisa)', () => {
  it('restringe aos tipos da subcategoria escolhida', () => {
    expect(placeTypesForSubcategories(['GASTRONOMY_JAPONESA'])).toEqual([
      'sushi_restaurant',
    ])
    expect(placeTypesForSubcategories(['CAFE_PADARIA'])).toEqual(['bakery'])
  })

  it('une múltiplas subcategorias e ignora chave desconhecida', () => {
    const t = placeTypesForSubcategories(['SPORTS_GOLFE', 'fantasma'])
    expect(t).toEqual(['golf_course'])
  })
})

describe('categoryForPlaceTypes (partição reversa)', () => {
  it('rotula o tipo na categoria dona', () => {
    expect(categoryForPlaceTypes(['night_club'])).toBe('PARTY')
    expect(categoryForPlaceTypes(['bar'])).toBe('NIGHTLIFE')
    expect(categoryForPlaceTypes(['sushi_restaurant'])).toBe('GASTRONOMY')
    expect(categoryForPlaceTypes(['coffee_shop'])).toBe('CAFE')
  })

  it('rotula tipo legado de categoria descontinuada (church → RELIGION)', () => {
    expect(categoryForPlaceTypes(['church'])).toBe('RELIGION')
  })

  it('cai em OTHER quando nenhum tipo é conhecido', () => {
    expect(categoryForPlaceTypes(['unknown_type'])).toBe('OTHER')
  })
})

describe('subcategoryForPlaceTypes', () => {
  it('rotula o tipo na subcategoria dona', () => {
    expect(subcategoryForPlaceTypes(['sushi_restaurant'])).toBe(
      'GASTRONOMY_JAPONESA',
    )
    expect(subcategoryForPlaceTypes(['bowling_alley'])).toBe('GAMING_BOLICHE')
  })

  it('null quando nenhum tipo é conhecido', () => {
    expect(subcategoryForPlaceTypes(['church', 'unknown'])).toBeNull()
  })
})
