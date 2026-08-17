import { logger } from '../logger'
import type { PluralBaseKey, TranslationKey } from './dictionary'
import { DEFAULT_LOCALE, type Locale } from './locale'
import { en } from './locales/en'
import { es } from './locales/es'
import { ptBR } from './locales/pt-BR'

const DICTIONARIES: Record<Locale, unknown> = { 'pt-BR': ptBR, en, es }

export type TranslationParams = Record<string, string | number>

function lookup(dictionary: unknown, key: string): string | undefined {
  let node: unknown = dictionary
  for (const segment of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[segment]
  }
  return typeof node === 'string' ? node : undefined
}

function resolveMessage(
  dictionary: unknown,
  key: string,
  locale: Locale,
  count: number | undefined,
): string | undefined {
  if (count !== undefined) {
    const category = new Intl.PluralRules(locale).select(count)
    // Só _one/_other existem no dicionário; categorias raras (ex.: 'many' do
    // pt/es para milhões) caem em _other, e chave sem variação vale como está.
    return (
      lookup(dictionary, `${key}_${category}`) ??
      lookup(dictionary, `${key}_other`) ??
      lookup(dictionary, key)
    )
  }
  return lookup(dictionary, key)
}

function interpolate(message: string, params?: TranslationParams): string {
  if (!params) return message
  return message.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) =>
    name in params ? String(params[name]) : placeholder,
  )
}

/**
 * Núcleo puro de tradução sobre um conjunto arbitrário de dicionários.
 * Exportado para os testes exercitarem interpolação/plural/fallback com
 * fixtures; o código de produção usa `t`, que fecha sobre os dicionários reais.
 */
export function translateWith(
  dictionaries: Partial<Record<Locale, unknown>>,
  key: string,
  locale: Locale,
  params?: TranslationParams,
): string {
  const count = typeof params?.count === 'number' ? params.count : undefined
  let message = resolveMessage(dictionaries[locale], key, locale, count)
  if (message === undefined && locale !== DEFAULT_LOCALE) {
    logger.warn(
      { key, locale },
      'i18n: chave sem tradução no locale pedido, usando o padrão',
    )
    message = resolveMessage(
      dictionaries[DEFAULT_LOCALE],
      key,
      DEFAULT_LOCALE,
      count,
    )
  }
  if (message === undefined) {
    // Inalcançável com dicionários tipados (Dictionary exige todas as chaves)
    logger.error({ key, locale }, 'i18n: chave ausente em todos os dicionários')
    return key
  }
  return interpolate(message, params)
}

/** Traduz uma chave do dicionário no locale pedido, com fallback pt-BR. */
export function t(
  key: TranslationKey | PluralBaseKey,
  locale: Locale,
  params?: TranslationParams,
): string {
  return translateWith(DICTIONARIES, key, locale, params)
}
