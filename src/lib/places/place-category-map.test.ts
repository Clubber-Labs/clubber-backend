import { describe, expect, it } from 'vitest'
import {
  categoryForPlaceTypes,
  placeTypesForCategories,
} from './place-category-map'

describe('placeTypesForCategories', () => {
  it('dedup os tipos quando categorias compartilham o mesmo tipo', () => {
    // SPORTS e HEALTH_WELLNESS compartilham 'gym'.
    const types = placeTypesForCategories(['SPORTS', 'HEALTH_WELLNESS'])
    expect(types.filter((t) => t === 'gym')).toHaveLength(1)
  })

  it('cobre PETS (antes órfã) com tipos sociais do Places', () => {
    expect(placeTypesForCategories(['PETS'])).toContain('dog_park')
  })

  it('mantém órfãs sem equivalente social como lista vazia', () => {
    // TECH/BUSINESS/VOLUNTEERING/OTHER não têm tipo social no Places (New).
    for (const c of ['TECH', 'BUSINESS', 'VOLUNTEERING', 'OTHER'] as const) {
      expect(placeTypesForCategories([c])).toEqual([])
    }
  })

  it('enriquece categorias antes magras (OUTDOORS, FAMILY, GASTRONOMY)', () => {
    expect(placeTypesForCategories(['OUTDOORS'])).toContain('hiking_area')
    expect(placeTypesForCategories(['FAMILY'])).toContain('aquarium')
    expect(placeTypesForCategories(['GASTRONOMY'])).toContain('bakery')
  })
})

describe('categoryForPlaceTypes', () => {
  it('rotula os tipos novos de volta para suas categorias', () => {
    expect(categoryForPlaceTypes(['dog_park'])).toBe('PETS')
    expect(categoryForPlaceTypes(['aquarium'])).toBe('FAMILY')
    expect(categoryForPlaceTypes(['hiking_area'])).toBe('OUTDOORS')
    expect(categoryForPlaceTypes(['bakery'])).toBe('GASTRONOMY')
  })

  it('cai em OTHER quando nenhum tipo é conhecido', () => {
    expect(categoryForPlaceTypes(['unknown_type'])).toBe('OTHER')
  })
})
