/**
 * Locales com dicionário no backend. É o tipo que circula pelo sistema:
 * negociação (resolveLocale), plugin de request e t().
 */
export const SUPPORTED_LOCALES = ['pt-BR', 'en', 'es'] as const

export type Locale = (typeof SUPPORTED_LOCALES)[number]

/** Locale padrão (lançamento no Brasil): vale quando não há sinal do aparelho. */
export const DEFAULT_LOCALE: Locale = 'pt-BR'

/**
 * Fallback internacional: aparelho num idioma SEM dicionário (fr, de...) cai no
 * inglês, que se entende melhor que pt-BR fora do Brasil. pt-BR fica para quem
 * pede pt ou não manda idioma nenhum.
 */
export const FALLBACK_LOCALE: Locale = 'en'

const SUPPORTED_BY_TAG = new Map(
  SUPPORTED_LOCALES.map((locale) => [locale.toLowerCase(), locale]),
)

type LanguageRange = { range: string; quality: number }

function parseAcceptLanguage(header: string): LanguageRange[] {
  const ranges: LanguageRange[] = []
  for (const part of header.split(',')) {
    const [tag, ...params] = part.trim().split(';')
    const range = tag?.trim()
    if (!range) continue
    let quality = 1
    for (const param of params) {
      const [name, value] = param.trim().split('=')
      if (name?.trim().toLowerCase() === 'q') {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) quality = parsed
      }
    }
    // q=0 é "não aceitável" (RFC 9110); fora da negociação
    if (quality > 0) ranges.push({ range, quality })
  }
  // sort é estável: empate de q preserva a ordem do header
  return ranges.sort((a, b) => b.quality - a.quality)
}

function matchRange(range: string): Locale | undefined {
  // '*' não expressa preferência por um suportado; deixa a decisão para o resto
  // da lista (ou para o DEFAULT_LOCALE)
  if (range === '*') return undefined
  const tag = range.toLowerCase()
  // Lookup do RFC 4647 §3.4: trunca subtags do fim ('pt-PT' → 'pt') até casar
  let candidate = tag
  while (candidate) {
    const exact = SUPPORTED_BY_TAG.get(candidate)
    if (exact) return exact
    const cut = candidate.lastIndexOf('-')
    candidate = cut === -1 ? '' : candidate.slice(0, cut)
  }
  // Idioma base casa com a variante regional suportada ('pt' → 'pt-BR')
  const base = tag.split('-')[0]
  return SUPPORTED_LOCALES.find(
    (locale) => locale.split('-')[0]?.toLowerCase() === base,
  )
}

/**
 * Tag crua de maior q-value do Accept-Language ('fr-CA'), mesmo sem dicionário.
 * É o que se guarda como User.deviceLocale: quando o idioma ganhar dicionário,
 * effectiveLocale passa a resolvê-lo sem esperar novo login.
 */
export function preferredLanguage(acceptLanguage?: string): string | undefined {
  if (!acceptLanguage) return undefined
  const tag = parseAcceptLanguage(acceptLanguage).find(
    (r) => r.range !== '*',
  )?.range
  // Teto do BCP 47 — protege a coluna de header malicioso/malformado.
  return tag?.slice(0, 35)
}

/**
 * Resolve o locale suportado a partir de um header Accept-Language, por ordem
 * de q-value: cada range casa por tag exata, por truncamento de subtags
 * ('pt-PT' → 'pt') ou por idioma base ('pt' → 'pt-BR'). Sem header ou sem
 * match, cai em DEFAULT_LOCALE.
 */
export function resolveLocale(acceptLanguage?: string): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE
  const ranges = parseAcceptLanguage(acceptLanguage)
  for (const { range } of ranges) {
    const match = matchRange(range)
    if (match) return match
  }
  // Idioma concreto sem dicionário → inglês; só wildcard/vazio → padrão.
  return ranges.some((r) => r.range !== '*') ? FALLBACK_LOCALE : DEFAULT_LOCALE
}
