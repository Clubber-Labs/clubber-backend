import { describe, expect, it } from 'vitest'
import { preferredLanguage } from './locale'
import { effectiveLocale } from './user-locale'

describe('effectiveLocale', () => {
  it('prioriza a escolha explícita sobre o idioma do aparelho', () => {
    expect(
      effectiveLocale({ localePreference: 'en', deviceLocale: 'pt-BR' }),
    ).toBe('en')
  })

  it('sem escolha explícita, resolve a tag do aparelho', () => {
    expect(
      effectiveLocale({ localePreference: null, deviceLocale: 'es-AR' }),
    ).toBe('es')
  })

  it('aparelho em idioma sem dicionário cai no inglês (fallback internacional)', () => {
    expect(
      effectiveLocale({ localePreference: null, deviceLocale: 'fr-CA' }),
    ).toBe('en')
  })

  it('preferência gravada sem dicionário não quebra: cai no inglês', () => {
    expect(
      effectiveLocale({ localePreference: 'de', deviceLocale: 'en' }),
    ).toBe('en')
  })
})

describe('preferredLanguage', () => {
  it('devolve a tag crua de maior q-value, mesmo sem dicionário', () => {
    expect(preferredLanguage('en-US,en;q=0.9')).toBe('en-US')
    expect(preferredLanguage('fr;q=0.5,es')).toBe('es')
    expect(preferredLanguage('fr-CA')).toBe('fr-CA')
  })

  it('ignora wildcard e header ausente/vazio', () => {
    expect(preferredLanguage('*')).toBeUndefined()
    expect(preferredLanguage('*;q=1,en;q=0.5')).toBe('en')
    expect(preferredLanguage()).toBeUndefined()
    expect(preferredLanguage('')).toBeUndefined()
  })
})
