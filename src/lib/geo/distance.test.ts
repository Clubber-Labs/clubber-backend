import { describe, expect, it } from 'vitest'
import { haversineMeters } from './distance'

describe('haversineMeters', () => {
  it('retorna 0 para o mesmo ponto', () => {
    expect(haversineMeters(-23.56, -46.65, -23.56, -46.65)).toBe(0)
  })

  it('calcula a distância entre dois pontos conhecidos (~1km)', () => {
    // Av. Paulista: ~1km entre o MASP e o Itaú Cultural.
    const d = haversineMeters(-23.5614, -46.6559, -23.5704, -46.6459)
    expect(d).toBeGreaterThan(1200)
    expect(d).toBeLessThan(1500)
  })

  it('é simétrico (A→B == B→A)', () => {
    const ab = haversineMeters(-25.4, -49.3, -25.41, -49.31)
    const ba = haversineMeters(-25.41, -49.31, -25.4, -49.3)
    expect(ab).toBeCloseTo(ba, 6)
  })

  it('arredonda para metros inteiros', () => {
    const d = haversineMeters(-25.4, -49.3, -25.4001, -49.3001)
    expect(Number.isInteger(d)).toBe(true)
  })
})
