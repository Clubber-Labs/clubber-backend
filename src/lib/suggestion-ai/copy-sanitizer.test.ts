import { describe, expect, it } from 'vitest'
import {
  isCleanFact,
  sanitizeAbout,
  sanitizeHighlights,
} from './copy-sanitizer'

// Os casos vêm dos vazamentos reais observados na probe de 2026-09-01: cada
// grupo reproduz um texto que o modelo escreveu apesar da regra no prompt.
describe('isCleanFact', () => {
  it.each([
    'Drinks bem avaliados',
    'Comida muito elogiada pelos frequentadores',
    'DJs renomados internacionalmente',
    'Ambiente elogiado como o melhor da cena',
    'Referência em eletrônica em Curitiba',
    'As reviews falam de artistas',
  ])('reputação/fonte: rejeita %j', (text) => {
    expect(isCleanFact(text)).toBe(false)
  })

  it.each([
    'Casa da cena LGBT',
    'Club voltado ao público LGBTQIAPN+',
    'Apresentações de drags ao vivo',
    'Recepção com hostess drag',
    'Festa do orgulho todo ano',
  ])('identidade: rejeita %j', (text) => {
    expect(isCleanFact(text)).toBe(false)
  })

  it.each([
    'Lugar pequeno que fica apertado',
    'Pista lotada nos picos',
    'Atendimento demorado',
  ])('depreciativo: rejeita %j', (text) => {
    expect(isCleanFact(text)).toBe(false)
  })

  it.each([
    'Banda ou DJ sexta e sábado',
    'Público mais alternativo',
    'Som mais pop e funk nas festas',
    'Área externa com sofás',
    'Open bar por preço acessível',
    'Volume adequado pra conversar',
    'Programação com festas temáticas',
  ])('fato limpo passa: %j', (text) => {
    expect(isCleanFact(text)).toBe(true)
  })
})

describe('sanitizeHighlights', () => {
  it('remove só os itens violados, preservando a ordem dos limpos', () => {
    expect(
      sanitizeHighlights([
        'Banda de jazz ao vivo',
        'Drinks bem avaliados',
        'Área externa',
      ]),
    ).toEqual(['Banda de jazz ao vivo', 'Área externa'])
  })
})

describe('sanitizeAbout', () => {
  it('about violado vira null; limpo passa; null passa', () => {
    expect(sanitizeAbout('Club voltado ao público LGBTQIAPN+')).toBeNull()
    expect(sanitizeAbout('Bar com música ao vivo em dois níveis')).toBe(
      'Bar com música ao vivo em dois níveis',
    )
    expect(sanitizeAbout(null)).toBeNull()
  })
})
