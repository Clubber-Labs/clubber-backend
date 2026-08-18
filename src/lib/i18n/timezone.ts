import tzLookup from 'tz-lookup'
import { z } from 'zod'

/** Usado quando não há sinal de fuso (conta nova, coordenada fora do mapa). */
export const DEFAULT_TIMEZONE = 'America/Sao_Paulo'

/**
 * IANA do ponto, offline (tz-lookup, ~100KB — sem chamada de rede). Evento pode
 * nascer em coordenada arbitrária, não só em resultado do Places, então derivar
 * de lat/lng é o único caminho que cobre os dois casos.
 */
export function timezoneForLocation(latitude: number, longitude: number) {
  try {
    return tzLookup(latitude, longitude)
  } catch {
    // Só cai aqui com coordenada fora de faixa, que o schema já barra na borda —
    // é rede de segurança para não derrubar a criação do evento. Sem log: manter
    // este módulo puro é o que permite usá-lo no seed e nas factories.
    return DEFAULT_TIMEZONE
  }
}

/**
 * Valida IANA pelo runtime (aceita aliases como America/Buenos_Aires, que
 * Intl.supportedValuesOf não lista).
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

export const timezoneSchema = z
  .string()
  .max(64)
  .refine(isValidTimezone, 'Fuso horário inválido')
