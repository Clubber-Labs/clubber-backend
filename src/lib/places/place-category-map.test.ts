import { describe, expect, it } from 'vitest'
import { EVENT_CATEGORIES } from '../event-categories'
import {
  categoryForPlaceTypes,
  placeTypesForCategories,
} from './place-category-map'

describe('placeTypesForCategories', () => {
  it('é uma partição: nenhum tipo do Places pertence a duas categorias', () => {
    const owner = new Map<string, string>()
    for (const c of EVENT_CATEGORIES) {
      for (const t of placeTypesForCategories([c])) {
        expect(owner.has(t), `tipo "${t}" em ${owner.get(t)} e ${c}`).toBe(
          false,
        )
        owner.set(t, c)
      }
    }
  })

  it('reparte a vida noturna em PARTY/NIGHTLIFE/MUSIC distintos', () => {
    expect(placeTypesForCategories(['PARTY'])).toContain('night_club')
    expect(placeTypesForCategories(['NIGHTLIFE'])).toContain('bar')
    expect(placeTypesForCategories(['MUSIC'])).toContain('concert_hall')
    // Sem sobreposição entre as três (cada tipo tem um dono).
    expect(placeTypesForCategories(['MUSIC'])).not.toContain('bar')
  })

  it('separa CAFE de GASTRONOMY (café/doceria ≠ refeição)', () => {
    expect(placeTypesForCategories(['CAFE'])).toContain('coffee_shop')
    expect(placeTypesForCategories(['CAFE'])).toContain('bakery')
    expect(placeTypesForCategories(['GASTRONOMY'])).toContain('restaurant')
    expect(placeTypesForCategories(['GASTRONOMY'])).not.toContain('bakery')
  })

  it('cobre as categorias novas (COMEDY, MARKETS)', () => {
    expect(placeTypesForCategories(['COMEDY'])).toEqual(['comedy_club'])
    expect(placeTypesForCategories(['MARKETS'])).toContain('market')
  })

  it('mantém órfãs sem equivalente social como lista vazia', () => {
    for (const c of ['TECH', 'BUSINESS', 'VOLUNTEERING', 'OTHER'] as const) {
      expect(placeTypesForCategories([c])).toEqual([])
    }
  })
})

describe('categoryForPlaceTypes', () => {
  it('rotula os tipos de volta para suas categorias (partição)', () => {
    expect(categoryForPlaceTypes(['coffee_shop'])).toBe('CAFE')
    expect(categoryForPlaceTypes(['comedy_club'])).toBe('COMEDY')
    expect(categoryForPlaceTypes(['market'])).toBe('MARKETS')
    expect(categoryForPlaceTypes(['night_club'])).toBe('PARTY')
    expect(categoryForPlaceTypes(['concert_hall'])).toBe('MUSIC')
    expect(categoryForPlaceTypes(['restaurant'])).toBe('GASTRONOMY')
    expect(categoryForPlaceTypes(['dog_park'])).toBe('PETS')
  })

  it('cai em OTHER quando nenhum tipo é conhecido', () => {
    expect(categoryForPlaceTypes(['unknown_type'])).toBe('OTHER')
  })
})
