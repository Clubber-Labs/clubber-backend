import { type Locale, resolveLocale } from './locale'

export type UserLocaleFields = {
  localePreference: string | null
  deviceLocale: string
}

/**
 * Locale efetivo de um usuário fora de request (push/e-mail, que rodam em job
 * sem Accept-Language): escolha explícita > última tag vista do aparelho, ambas
 * resolvidas contra os dicionários suportados (fallback DEFAULT_LOCALE).
 */
export function effectiveLocale(user: UserLocaleFields): Locale {
  return resolveLocale(user.localePreference ?? user.deviceLocale)
}
