import { describe, expect, it } from 'vitest'
import { EVENT_CATEGORIES } from './event-categories'
import {
  listCategoriesWithSubcategories,
  parentCategoryOf,
  SUBCATEGORIES,
  subcategoriesByCategory,
} from './subcategories'

describe('taxonomia de subcategorias — invariantes', () => {
  it('é uma partição: nenhum tipo do Places aparece em duas subcategorias', () => {
    const seen = new Map<string, string>()
    for (const s of SUBCATEGORIES) {
      for (const t of s.placeTypes) {
        expect(
          seen.has(t),
          `tipo "${t}" duplicado em ${seen.get(t)} e ${s.key}`,
        ).toBe(false)
        seen.set(t, s.key)
      }
    }
  })

  it('toda subcategoria tem pai válido em EVENT_CATEGORIES', () => {
    for (const s of SUBCATEGORIES) {
      expect(EVENT_CATEGORIES).toContain(s.category)
      expect(parentCategoryOf(s.key)).toBe(s.category)
    }
  })

  it('subcategoria de venue tem tipo do Places; interesse-sem-venue é exceção nomeada', () => {
    // placeTypes vazio é permitido só para interesses que não têm tipo no
    // Places (tabuleiro/RPG) — a lista explícita evita esvaziar venue por acidente.
    const NO_VENUE_KEYS = new Set(['GAMING_TABULEIRO', 'GAMING_RPG'])
    for (const s of SUBCATEGORIES) {
      if (NO_VENUE_KEYS.has(s.key)) {
        expect(s.placeTypes).toHaveLength(0)
      } else {
        expect(s.placeTypes.length).toBeGreaterThan(0)
      }
    }
  })

  it('chaves de subcategoria são únicas', () => {
    const keys = SUBCATEGORIES.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('listCategoriesWithSubcategories', () => {
  it('aninha as subcategorias rotuladas em cada categoria selecionável', () => {
    const data = listCategoriesWithSubcategories('pt-BR')

    const gastronomy = data.find((c) => c.value === 'GASTRONOMY')
    expect(gastronomy?.subcategories).toEqual(
      expect.arrayContaining([
        { value: 'GASTRONOMY_JAPONESA', label: 'Japonesa' },
      ]),
    )

    // Toda subcategoria tem rótulo de verdade (fallback seria a própria chave).
    for (const cat of data) {
      for (const sub of cat.subcategories) {
        expect(sub.label).not.toBe(sub.value)
      }
    }
  })

  it('não inclui categoria descontinuada (RELIGION)', () => {
    const values = listCategoriesWithSubcategories().map((c) => c.value)
    expect(values).not.toContain('RELIGION')
  })

  it('categorias órfãs aparecem com lista de subcategorias vazia', () => {
    const data = listCategoriesWithSubcategories()
    expect(data.find((c) => c.value === 'COMEDY')?.subcategories).toEqual([])
    expect(data.find((c) => c.value === 'FESTIVAL')?.subcategories).toEqual([])
    expect(subcategoriesByCategory.COMEDY ?? []).toEqual([])
  })
})
