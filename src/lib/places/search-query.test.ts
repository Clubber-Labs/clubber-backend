import { describe, expect, it } from 'vitest'
import { buildProfileSearchQueries } from './search-query'

describe('buildProfileSearchQueries', () => {
  it('subcategoria de venue vira o rótulo e cobre a categoria-pai', () => {
    const q = buildProfileSearchQueries(['GASTRONOMY'], ['GASTRONOMY_JAPONESA'])
    // só a frase fina; sem a frase crua "Gastronomia" (a subcategoria cobre).
    expect(q).toEqual(['Japonesa'])
  })

  it('gênero é ancorado num venue e cobre a categoria de vida noturna', () => {
    const q = buildProfileSearchQueries(['PARTY'], ['GENRE_ELETRONICA'])
    expect(q).toEqual(['balada eletrônica'])
  })

  it('categoria sem interesse fino vira o rótulo da categoria', () => {
    // TECH não tem tipo no Places, mas com Text Search vira pesquisável por texto.
    const q = buildProfileSearchQueries(['PARTY', 'TECH'], [])
    expect(q).toEqual(['Festa', 'Tecnologia'])
  })

  it('mistura: fina cobre seu pai, categoria sem fina entra crua', () => {
    const q = buildProfileSearchQueries(
      ['GASTRONOMY', 'PARTY'],
      ['GASTRONOMY_JAPONESA'],
    )
    expect(q).toEqual(['Japonesa', 'Festa'])
  })

  it('gênero cobre a vida noturna, mas categoria fora dela ainda entra', () => {
    const q = buildProfileSearchQueries(['PARTY', 'GASTRONOMY'], ['GENRE_FUNK'])
    expect(q).toEqual(['balada funk', 'Gastronomia'])
  })

  it('aplica o teto de 3 frases, priorizando as mais específicas', () => {
    const q = buildProfileSearchQueries(['PARTY', 'MUSIC', 'TECH', 'ART'], [])
    expect(q).toHaveLength(3)
    expect(q).toEqual(['Festa', 'Música', 'Tecnologia'])
  })
})
