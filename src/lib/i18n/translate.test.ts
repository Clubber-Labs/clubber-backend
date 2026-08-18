import { afterEach, describe, expect, it, vi } from 'vitest'
import { logger } from '../logger'
import { DEFAULT_LOCALE, resolveLocale } from './locale'
import { t, translateWith } from './translate'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveLocale', () => {
  it('cai em DEFAULT_LOCALE sem header ou com header vazio', () => {
    expect(resolveLocale()).toBe(DEFAULT_LOCALE)
    expect(resolveLocale('')).toBe(DEFAULT_LOCALE)
  })

  it('casa tag exata, sem case-sensitivity', () => {
    expect(resolveLocale('en')).toBe('en')
    expect(resolveLocale('es')).toBe('es')
    expect(resolveLocale('pt-br')).toBe('pt-BR')
    expect(resolveLocale('EN')).toBe('en')
  })

  it('trunca subtags regionais até casar (RFC 4647 lookup)', () => {
    expect(resolveLocale('en-GB')).toBe('en')
    expect(resolveLocale('es-AR')).toBe('es')
    expect(resolveLocale('es-419')).toBe('es')
  })

  it('casa idioma base com a variante regional suportada', () => {
    expect(resolveLocale('pt')).toBe('pt-BR')
    expect(resolveLocale('pt-PT')).toBe('pt-BR')
  })

  it('ordena por q-value, não pela posição no header', () => {
    expect(resolveLocale('es;q=0.8,en')).toBe('en')
    expect(resolveLocale('en;q=0.7,es;q=0.9')).toBe('es')
  })

  it('pula ranges não suportados mesmo com q maior', () => {
    expect(resolveLocale('fr;q=1,es;q=0.5')).toBe('es')
    expect(resolveLocale('es-AR,es;q=0.9,en;q=0.8')).toBe('es')
  })

  it('trata q=0 como não aceitável', () => {
    expect(resolveLocale('en;q=0,es;q=0.5')).toBe('es')
  })

  it('ignora wildcard e cai em DEFAULT_LOCALE quando nada casa', () => {
    expect(resolveLocale('*')).toBe(DEFAULT_LOCALE)
    expect(resolveLocale('fr-FR,fr;q=0.9')).toBe(DEFAULT_LOCALE)
    expect(resolveLocale('*;q=1,en;q=0.5')).toBe('en')
  })

  it('tolera q-value malformado tratando-o como 1', () => {
    expect(resolveLocale('en;q=abc,es;q=0.9')).toBe('en')
  })
})

describe('t (dicionários reais)', () => {
  it('traduz a taxonomia em cada locale suportado', () => {
    expect(t('categories.MUSIC', 'pt-BR')).toBe('Música')
    expect(t('categories.GASTRONOMY', 'en')).toBe('Food')
    expect(t('categories.NIGHTLIFE', 'es')).toBe('Vida nocturna')
    expect(t('subcategories.NIGHTLIFE_BALADA', 'en')).toBe('Clubbing')
    expect(t('genres.GENRE_FUNK', 'es')).toBe('Funk brasileño')
  })
})

// Fixtures com chaves plurais e lacunas propositais: os dicionários reais são
// completos por tipo, então plural e fallback só são exercitáveis por aqui.
const fixtures = {
  'pt-BR': {
    greeting: 'E aí, {{name}}!',
    friends_one: '{{count}} amigo confirmou',
    friends_other: '{{count}} amigos confirmaram',
    onlyDefault: 'só no dicionário padrão',
  },
  en: {
    greeting: 'Hey {{name}}!',
    friends_one: '{{count}} friend is going',
    friends_other: '{{count}} friends are going',
  },
  es: {
    greeting: '¡Qué onda, {{name}}!',
    friends_one: '{{count}} amigo va',
    friends_other: '{{count}} amigos van',
  },
} as const

describe('translateWith', () => {
  it('interpola parâmetros {{nome}}', () => {
    expect(translateWith(fixtures, 'greeting', 'en', { name: 'Ana' })).toBe(
      'Hey Ana!',
    )
  })

  it('mantém o placeholder quando o parâmetro não foi passado', () => {
    expect(translateWith(fixtures, 'greeting', 'pt-BR')).toBe('E aí, {{name}}!')
  })

  it('resolve plural por Intl.PluralRules a partir de params.count', () => {
    expect(translateWith(fixtures, 'friends', 'pt-BR', { count: 1 })).toBe(
      '1 amigo confirmou',
    )
    expect(translateWith(fixtures, 'friends', 'en', { count: 2 })).toBe(
      '2 friends are going',
    )
    expect(translateWith(fixtures, 'friends', 'es', { count: 5 })).toBe(
      '5 amigos van',
    )
  })

  it('segue a regra de plural do locale, não a do português', () => {
    // CLDR: zero é "one" em pt e "other" em en/es
    expect(translateWith(fixtures, 'friends', 'pt-BR', { count: 0 })).toBe(
      '0 amigo confirmou',
    )
    expect(translateWith(fixtures, 'friends', 'en', { count: 0 })).toBe(
      '0 friends are going',
    )
  })

  it('cai em _other para categorias sem variante própria (ex.: many)', () => {
    // 1e6 é "many" em pt/es no CLDR; o dicionário só tem _one/_other
    expect(
      translateWith(fixtures, 'friends', 'pt-BR', { count: 1_000_000 }),
    ).toBe('1000000 amigos confirmaram')
  })

  it('chave ausente no locale pedido cai no padrão e loga warn', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})

    expect(translateWith(fixtures, 'onlyDefault', 'en')).toBe(
      'só no dicionário padrão',
    )
    expect(warn).toHaveBeenCalledWith(
      { key: 'onlyDefault', locale: 'en' },
      expect.any(String),
    )
  })

  it('nunca devolve string vazia para chave inexistente', () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    expect(translateWith(fixtures, 'missing.key', 'en')).not.toBe('')
  })
})
