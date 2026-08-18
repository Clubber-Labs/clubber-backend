import { describe, expect, it } from 'vitest'
import {
  type RankContext,
  rankEvent,
  DEFAULT_RANK_WEIGHTS as W,
} from './event-ranker'

// Evento e contexto neutros: só o sinal de afinidade (categoria/subcategoria)
// varia entre os casos, então o delta de score isola exatamente esse sinal.
const baseEvent = {
  date: new Date('2026-06-20T20:00:00Z'),
  endDate: null,
  canceledAt: null,
  categories: [] as string[],
  subcategories: [] as string[],
}

const baseContext: RankContext = {
  preferredCategories: [],
  preferredSubcategories: [],
  reason: { kind: 'discovery' },
  counts: { attendances: 0, comments: 0, reactions: 0 },
  distanceMeters: null,
  friendInteractionCount: 0,
}

const NOW = new Date('2026-06-15T12:00:00Z')

function score(
  ev: Partial<typeof baseEvent>,
  ctx: Partial<RankContext>,
): number {
  return rankEvent({ ...baseEvent, ...ev }, { ...baseContext, ...ctx }, W, NOW)
}

// Score sem nenhum casamento de afinidade — referência para isolar o sinal.
const NEUTRAL = score({}, {})

describe('rankEvent — sinal de afinidade (categoria × subcategoria)', () => {
  it('casar subcategoria pontua mais que casar categoria na mesma posição', () => {
    const catMatch = score(
      { categories: ['MUSIC'] },
      { preferredCategories: ['MUSIC'] },
    )
    const subMatch = score(
      { categories: ['OTHER'], subcategories: ['NIGHTLIFE_BALADA'] },
      { preferredSubcategories: ['NIGHTLIFE_BALADA'] },
    )
    expect(catMatch - NEUTRAL).toBe(W.categoryTop1)
    expect(subMatch - NEUTRAL).toBe(W.subcategoryTop1)
    expect(subMatch).toBeGreaterThan(catMatch)
  })

  it('combina por max, não por soma: casar os dois níveis = só o maior', () => {
    const both = score(
      { categories: ['MUSIC'], subcategories: ['NIGHTLIFE_BALADA'] },
      {
        preferredCategories: ['MUSIC'],
        preferredSubcategories: ['NIGHTLIFE_BALADA'],
      },
    )
    // max(25, 35) = 35 — NÃO 60. Sem crédito dobrado.
    expect(both - NEUTRAL).toBe(W.subcategoryTop1)
    expect(both - NEUTRAL).not.toBe(W.categoryTop1 + W.subcategoryTop1)
  })

  it('a posição na lista de interesses gradua o peso (top1 > top2 > top3)', () => {
    const top1 = score(
      { subcategories: ['NIGHTLIFE_BALADA'] },
      {
        preferredSubcategories: [
          'NIGHTLIFE_BALADA',
          'GENRE_FUNK',
          'NIGHTLIFE_BAR',
        ],
      },
    )
    const top2 = score(
      { subcategories: ['GENRE_FUNK'] },
      {
        preferredSubcategories: [
          'NIGHTLIFE_BALADA',
          'GENRE_FUNK',
          'NIGHTLIFE_BAR',
        ],
      },
    )
    const top3 = score(
      { subcategories: ['NIGHTLIFE_BAR'] },
      {
        preferredSubcategories: [
          'NIGHTLIFE_BALADA',
          'GENRE_FUNK',
          'NIGHTLIFE_BAR',
        ],
      },
    )
    expect(top1 - NEUTRAL).toBe(W.subcategoryTop1)
    expect(top2 - NEUTRAL).toBe(W.subcategoryTop2)
    expect(top3 - NEUTRAL).toBe(W.subcategoryTop3)
    expect(top1).toBeGreaterThan(top2)
    expect(top2).toBeGreaterThan(top3)
  })

  it('retrocompat: evento e usuário só-categoria pontuam como antes (sem subcat)', () => {
    const onlyCategory = score(
      { categories: ['MUSIC'] },
      { preferredCategories: ['MUSIC'], preferredSubcategories: [] },
    )
    // max(categoryTop1, 0) — idêntico ao comportamento pré-subcategoria.
    expect(onlyCategory - NEUTRAL).toBe(W.categoryTop1)
  })

  it('subcategoria do evento que o usuário não prefere não pontua', () => {
    const noMatch = score(
      { categories: ['OTHER'], subcategories: ['NIGHTLIFE_BALADA'] },
      { preferredSubcategories: ['NIGHTLIFE_BAR'] },
    )
    expect(noMatch).toBe(NEUTRAL)
  })
})
