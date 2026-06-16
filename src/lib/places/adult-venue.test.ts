import { describe, expect, it } from 'vitest'
import { isAdultVenue } from './adult-venue'

describe('isAdultVenue', () => {
  it('detecta casas de swing / liberais / adultas', () => {
    for (const name of [
      'Clube de Swing Curitiba',
      'Balada Liberal',
      'Festa Liberal CWB',
      'Le Privê',
      'Privê das Estrelas',
      'Termas Status',
      'Sexy Night Club',
      'Erótica Show Bar',
      'Strip Club Diamond',
      'Cabaré da Lua',
      'Sex Shop & Lounge',
      'Pole Dance House',
      'Bordel Moderno',
    ]) {
      expect(isAdultVenue(name)).toBe(true)
    }
  })

  it('não derruba venues comuns (sem falso positivo)', () => {
    for (const name of [
      'Bar do Zé',
      'Bar da Sexta', // "sexta" não casa "sex"
      'Boate Tropicana', // boate ≠ adulto
      'Restaurante Essex', // "essex" não casa "sex"
      'Cervejaria Liberdade', // "liberdade" não casa "liberal"
      'Swingueira do Amor', // "swingueira" é gênero de festa, não swing adulto
      'Bar do Gogó', // "gogó" (garganta) ≠ go-go bar
      'Café Cultura',
      'Pizzaria Napolitana',
      'Casa de Show Opinião',
    ]) {
      expect(isAdultVenue(name)).toBe(false)
    }
  })

  it('é robusto a acento e caixa', () => {
    expect(isAdultVenue('ERÓTICO BAR')).toBe(true)
    expect(isAdultVenue('privê')).toBe(true)
    expect(isAdultVenue('Casa de Swing CWB')).toBe(true)
  })
})
