import { z } from 'zod'

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
