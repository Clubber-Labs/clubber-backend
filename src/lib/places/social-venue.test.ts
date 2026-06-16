import { describe, expect, it } from 'vitest'
import { isSocialVenue } from './social-venue'

describe('isSocialVenue', () => {
  it('aceita venue com tipo social entre genéricos', () => {
    expect(isSocialVenue(['bar', 'point_of_interest', 'establishment'])).toBe(
      true,
    )
    expect(
      isSocialVenue(['restaurant', 'food', 'point_of_interest', 'establishment']),
    ).toBe(true)
  })

  it('aceita comida-varejo social (padaria carrega o genérico "store")', () => {
    // Padaria/sorveteria sociais vêm com 'store' — não pode ser vetado.
    expect(isSocialVenue(['bakery', 'store', 'food', 'point_of_interest'])).toBe(
      true,
    )
    expect(
      isSocialVenue(['ice_cream_shop', 'store', 'food', 'point_of_interest']),
    ).toBe(true)
  })

  it('rejeita academia, salão, varejo de roupa, escola e serviços', () => {
    expect(isSocialVenue(['gym', 'point_of_interest', 'establishment'])).toBe(
      false,
    )
    expect(isSocialVenue(['beauty_salon', 'point_of_interest'])).toBe(false)
    expect(isSocialVenue(['clothing_store', 'store', 'point_of_interest'])).toBe(
      false,
    )
    expect(isSocialVenue(['university', 'point_of_interest'])).toBe(false)
    expect(isSocialVenue(['veterinary_care'])).toBe(false)
    expect(isSocialVenue(['pet_store', 'store'])).toBe(false)
  })

  it('rejeita venue só com tipos genéricos (sem âncora social)', () => {
    expect(isSocialVenue(['point_of_interest', 'establishment'])).toBe(false)
    expect(isSocialVenue([])).toBe(false)
  })

  it('um tipo banido VETA mesmo havendo tipo social', () => {
    expect(isSocialVenue(['bar', 'gym'])).toBe(false)
  })

  it('aceita os venues típicos de rolê', () => {
    for (const t of [
      'night_club',
      'pub',
      'wine_bar',
      'cafe',
      'movie_theater',
      'concert_hall',
      'karaoke',
      'bowling_alley',
      'museum',
      'park',
      'beach',
      'amusement_park',
    ]) {
      expect(isSocialVenue([t])).toBe(true)
    }
  })

  it('rejeita os venues de categorias não-sociais (esporte, beleza, pet, ensino)', () => {
    for (const t of [
      'stadium',
      'swimming_pool',
      'golf_course',
      'spa',
      'yoga_studio',
      'shopping_mall',
      'department_store',
      'library',
      'school',
      'dog_park',
    ]) {
      expect(isSocialVenue([t])).toBe(false)
    }
  })
})
