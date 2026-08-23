import type { ptBR } from './locales/pt-BR'

type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> }

/**
 * Forma do dicionário canônico (pt-BR) com as folhas alargadas para `string`.
 * `en.ts` e `es.ts` são anotados com este tipo: chave faltando (ou sobrando) é
 * erro de compilação, não string vazia em runtime.
 */
export type Dictionary = Widen<typeof ptBR>

type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`
}[keyof T & string]

/** Caminhos pontuados até as folhas: 'categories.MUSIC' | 'genres.GENRE_FUNK' | ... */
export type TranslationKey = Paths<Dictionary>

type StripPluralSuffix<K> = K extends `${infer Base}_one`
  ? Base
  : K extends `${infer Base}_other`
    ? Base
    : never

/**
 * Base das chaves plurais: o dicionário guarda `x_one`/`x_other` e o caller
 * chama `t('x', locale, { count })` — o sufixo é escolhido por Intl.PluralRules.
 */
export type PluralBaseKey = StripPluralSuffix<TranslationKey>
