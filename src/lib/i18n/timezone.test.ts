import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMEZONE,
  isValidTimezone,
  timezoneForLocation,
} from './timezone'

describe('timezoneForLocation', () => {
  it('resolve o IANA a partir da coordenada, offline', () => {
    expect(timezoneForLocation(-25.4284, -49.2733)).toBe('America/Sao_Paulo')
    expect(timezoneForLocation(40.7128, -74.006)).toBe('America/New_York')
    expect(timezoneForLocation(35.6762, 139.6503)).toBe('Asia/Tokyo')
  })

  it('resolve coordenada arbitrária, não só de estabelecimento', () => {
    // Meio do Atlântico: evento pode nascer em qualquer ponto do mapa.
    expect(isValidTimezone(timezoneForLocation(-15, -25))).toBe(true)
  })

  it('coordenada fora de faixa cai no padrão em vez de derrubar a criação', () => {
    expect(timezoneForLocation(999, 999)).toBe(DEFAULT_TIMEZONE)
  })
})
