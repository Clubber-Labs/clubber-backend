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

describe('hora de parede através do DST', () => {
  // Nova York vira o relógio em 08/03/2026 (2h → 3h). Antes: 22h local = 03h UTC;
  // depois: 22h local = 02h UTC. O que o usuário marcou foi "22h", não o UTC.
  const NY = 'America/New_York'

  it('WEEKLY mantém 22h locais antes e depois da virada', () => {
    const dates = buildOccurrenceDates({
      start: new Date('2026-03-05T03:00:00Z'), // qui 05/03, 22h em NY (EST)
      frequency: 'WEEKLY',
      interval: 1,
      now: new Date('2026-03-01T00:00:00Z'),
      count: 3,
      timeZone: NY,
    })

    const wallTimes = dates.map((d) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: NY,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(d),
    )
    expect(wallTimes).toEqual(['22:00', '22:00', '22:00'])
    // O instante UTC MUDA (é esse o ponto): 03h antes, 02h depois da virada.
    expect(dates[0].toISOString()).toBe('2026-03-05T03:00:00.000Z')
    expect(dates[1].toISOString()).toBe('2026-03-12T02:00:00.000Z')
  })

  it('MONTHLY mantém a hora local e o clamp de fim de mês', () => {
    const dates = buildOccurrenceDates({
      start: new Date('2026-02-01T03:00:00Z'), // sáb 31/01, 22h em NY (EST)
      frequency: 'MONTHLY',
      interval: 1,
      now: new Date('2026-01-10T00:00:00Z'),
      count: 3,
      timeZone: NY,
    })

    const local = dates.map((d) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: NY,
        dateStyle: 'short',
        timeStyle: 'short',
        hour12: false,
      }).format(d),
    )
    // 31 jan → 28 fev (clamp) → 31 mar (volta ao dia 31, sem drift).
    expect(local).toEqual([
      '2026-01-31, 22:00',
      '2026-02-28, 22:00',
      '2026-03-31, 22:00',
    ])
    // Março já em EDT: mesma hora de parede, offset UTC diferente.
    expect(dates[2].toISOString()).toBe('2026-04-01T02:00:00.000Z')
  })

  it('sem timeZone informado, computa em UTC (comportamento de série antiga)', () => {
    const dates = buildOccurrenceDates({
      start: new Date('2026-03-05T03:00:00Z'),
      frequency: 'WEEKLY',
      interval: 1,
      now: new Date('2026-03-01T00:00:00Z'),
      count: 2,
    })
    expect(dates[1].toISOString()).toBe('2026-03-12T03:00:00.000Z')
  })
})
