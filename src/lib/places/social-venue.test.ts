import { describe, expect, it } from 'vitest'
import { isSocialVenue } from './social-venue'

describe('isSocialVenue', () => {
  it('aceita venue com tipo social entre genéricos', () => {
    expect(isSocialVenue(['bar', 'point_of_interest', 'establishment'])).toBe(
      true,
    )
    expect(
      isSocialVenue([
        'restaurant',
        'food',
        'point_of_interest',
        'establishment',
      ]),
    ).toBe(true)
  })

  it('aceita comida-varejo social (padaria carrega o genérico "store")', () => {
    // Padaria/sorveteria sociais vêm com 'store' — não pode ser vetado.
    expect(
      isSocialVenue(['bakery', 'store', 'food', 'point_of_interest']),
    ).toBe(true)
    expect(
      isSocialVenue(['ice_cream_shop', 'store', 'food', 'point_of_interest']),
    ).toBe(true)
  })

  it('rejeita academia, salão, escola e serviços', () => {
    expect(isSocialVenue(['gym', 'point_of_interest', 'establishment'])).toBe(
      false,
    )
    expect(isSocialVenue(['beauty_salon', 'point_of_interest'])).toBe(false)
    expect(isSocialVenue(['university', 'point_of_interest'])).toBe(false)
    expect(isSocialVenue(['veterinary_care'])).toBe(false)
    expect(isSocialVenue(['pet_store', 'store'])).toBe(false)
  })

  it('aceita loja de roupa: brechó/garimpo é rolê (BRECHO é categoria social)', () => {
    expect(
      isSocialVenue(['clothing_store', 'store', 'point_of_interest']),
    ).toBe(true)
  })

  it('rejeita venue só com tipos genéricos (sem âncora social)', () => {
    expect(isSocialVenue(['point_of_interest', 'establishment'])).toBe(false)
    expect(isSocialVenue([])).toBe(false)
  })

  it('a âncora social VENCE tipos de varejo/serviço secundários (casos reais)', () => {
    // Validado no probe real: vetar por tipo secundário derrubava venue legítimo.
    expect(isSocialVenue(['night_club', 'bar', 'spa'])).toBe(true) // balada+spa
    expect(
      isSocialVenue(['japanese_restaurant', 'sushi_restaurant', 'hotel']),
    ).toBe(true) // restaurante em hotel
    expect(isSocialVenue(['coffee_shop', 'cafe', 'book_store'])).toBe(true) // café-livraria
    expect(isSocialVenue(['live_music_venue', 'event_venue'])).toBe(true) // casa de show
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
