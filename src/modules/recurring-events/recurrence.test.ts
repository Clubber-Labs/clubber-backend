import { describe, expect, it } from 'vitest'
import {
  buildOccurrenceDates,
  nextOccurrenceDate,
  RECURRENCE_HORIZON_DAYS,
  RECURRENCE_MAX_OCCURRENCES,
} from './recurrence'

describe('nextOccurrenceDate', () => {
  it('WEEKLY soma 7 dias por interval', () => {
    const d = new Date('2026-06-01T20:00:00Z')
    expect(nextOccurrenceDate(d, 'WEEKLY', 1)).toEqual(
      new Date('2026-06-08T20:00:00Z'),
    )
    expect(nextOccurrenceDate(d, 'WEEKLY', 2)).toEqual(
      new Date('2026-06-15T20:00:00Z'),
    )
  })

  it('MONTHLY mantém o mesmo dia do mês', () => {
    const d = new Date('2026-01-15T20:00:00Z')
    expect(nextOccurrenceDate(d, 'MONTHLY', 1)).toEqual(
      new Date('2026-02-15T20:00:00Z'),
    )
  })

  it('MONTHLY faz clamp para o último dia em meses curtos (31 jan -> 28 fev)', () => {
    const d = new Date('2026-01-31T20:00:00Z')
    // 2026 não é bissexto → fevereiro tem 28 dias
    expect(nextOccurrenceDate(d, 'MONTHLY', 1)).toEqual(
      new Date('2026-02-28T20:00:00Z'),
    )
  })

  it('MONTHLY faz clamp para 29 fev em ano bissexto', () => {
    const d = new Date('2024-01-31T20:00:00Z')
    expect(nextOccurrenceDate(d, 'MONTHLY', 1)).toEqual(
      new Date('2024-02-29T20:00:00Z'),
    )
  })

  it('MONTHLY com interval pula meses', () => {
    const d = new Date('2026-01-10T12:00:00Z')
    expect(nextOccurrenceDate(d, 'MONTHLY', 3)).toEqual(
      new Date('2026-04-10T12:00:00Z'),
    )
  })
})

describe('buildOccurrenceDates', () => {
  const start = new Date('2026-06-01T20:00:00Z')

  it('gera ocorrências semanais até o horizonte de 90 dias quando não há until/count', () => {
    const dates = buildOccurrenceDates({
      start,
      frequency: 'WEEKLY',
      interval: 1,
      now: start,
    })
    // 90 dias / 7 ≈ 12 ocorrências futuras + a inicial
    expect(dates[0]).toEqual(start)
    const horizon = new Date(
      start.getTime() + RECURRENCE_HORIZON_DAYS * 86_400_000,
    )
    for (const d of dates)
      expect(d.getTime()).toBeLessThanOrEqual(horizon.getTime())
    expect(dates.length).toBeGreaterThan(10)
    expect(dates.length).toBeLessThanOrEqual(14)
  })

  it('respeita count (total de ocorrências incluindo a inicial)', () => {
    const dates = buildOccurrenceDates({
      start,
      frequency: 'WEEKLY',
      interval: 1,
      count: 4,
      now: start,
    })
    expect(dates).toHaveLength(4)
    expect(dates[3]).toEqual(new Date('2026-06-22T20:00:00Z'))
  })

  it('respeita until (não gera ocorrência depois da data limite)', () => {
    const until = new Date('2026-06-20T20:00:00Z')
    const dates = buildOccurrenceDates({
      start,
      frequency: 'WEEKLY',
      interval: 1,
      until,
      now: start,
    })
    // 01, 08, 15 (22 passaria de until)
    expect(dates).toHaveLength(3)
    expect(dates[dates.length - 1]).toEqual(new Date('2026-06-15T20:00:00Z'))
  })

  it('nunca passa do cap de RECURRENCE_MAX_OCCURRENCES', () => {
    const dates = buildOccurrenceDates({
      start,
      frequency: 'WEEKLY',
      interval: 1,
      count: 999,
      now: start,
    })
    expect(dates.length).toBeLessThanOrEqual(RECURRENCE_MAX_OCCURRENCES)
  })

  it('gera a partir de um ponto futuro (reposição) sem incluir datas <= from', () => {
    const from = new Date('2026-07-01T20:00:00Z')
    const dates = buildOccurrenceDates({
      start,
      frequency: 'WEEKLY',
      interval: 1,
      now: start,
      after: from,
    })
    for (const d of dates) expect(d.getTime()).toBeGreaterThan(from.getTime())
  })
})
