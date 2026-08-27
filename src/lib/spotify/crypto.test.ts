import { describe, expect, it } from 'vitest'
import { decryptRefreshToken, encryptRefreshToken } from './crypto'

describe('spotify crypto', () => {
  it('cifra e decifra o refresh token (round-trip)', () => {
    const plain = 'AQBrefresh-token-do-spotify_123'
    const payload = encryptRefreshToken(plain)

    expect(payload).not.toContain(plain)
    expect(payload.split('.')).toHaveLength(3)
    expect(decryptRefreshToken(payload)).toBe(plain)
  })

  it('gera payloads diferentes para o mesmo plaintext (iv aleatório)', () => {
    const plain = 'mesmo-token'
    expect(encryptRefreshToken(plain)).not.toBe(encryptRefreshToken(plain))
  })

  it('rejeita payload adulterado (GCM autentica)', () => {
    const payload = encryptRefreshToken('token-integro')
    const [iv, tag, ct] = payload.split('.')
    const flipped = Buffer.from(ct, 'base64')
    flipped[0] ^= 0xff
    const tampered = [iv, tag, flipped.toString('base64')].join('.')

    expect(() => decryptRefreshToken(tampered)).toThrow()
  })
})
