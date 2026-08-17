import { describe, expect, it } from 'vitest'
import {
  decodeSealed,
  encodeSealed,
  IV_BYTES,
  open,
  randomDek,
  randomIv,
  seal,
  TAG_BYTES,
} from './aead'

const AAD = 'conv:11111111-1111-1111-1111-111111111111'

describe('seal/open', () => {
  it('faz roundtrip do plaintext', () => {
    const key = randomDek()
    const plain = Buffer.from('mensagem secreta', 'utf8')

    const opened = open(key, seal(key, plain, AAD), AAD)

    expect(opened.toString('utf8')).toBe('mensagem secreta')
  })

  it('preserva acentuação e emoji no roundtrip utf8', () => {
    const key = randomDek()
    const texto = 'ação, coração e ñ — 🎉🔐'

    const opened = open(key, seal(key, Buffer.from(texto, 'utf8'), AAD), AAD)

    expect(opened.toString('utf8')).toBe(texto)
  })

  it('lança quando o ciphertext é adulterado', () => {
    const key = randomDek()
    const sealed = seal(key, Buffer.from('conteúdo'), AAD)
    sealed.ct[0] ^= 0x01

    expect(() => open(key, sealed, AAD)).toThrow()
  })

  it('lança quando a tag é adulterada', () => {
    const key = randomDek()
    const sealed = seal(key, Buffer.from('conteúdo'), AAD)
    sealed.tag[0] ^= 0x01

    expect(() => open(key, sealed, AAD)).toThrow()
  })

  // O AAD é o que impede mover um blob cifrado de um registro para outro.
  it('lança quando o AAD não é o mesmo do seal', () => {
    const key = randomDek()
    const sealed = seal(key, Buffer.from('conteúdo'), AAD)

    expect(() => open(key, sealed, 'conv:outra-conversa')).toThrow()
  })

  it('lança quando a chave é outra', () => {
    const sealed = seal(randomDek(), Buffer.from('conteúdo'), AAD)

    expect(() => open(randomDek(), sealed, AAD)).toThrow()
  })

  it('rejeita chave fora de 32 bytes', () => {
    const curta = Buffer.alloc(31)

    expect(() => seal(curta, Buffer.from('x'), AAD)).toThrow(
      /esperado 32 bytes/,
    )
  })

  it('cifra o mesmo plaintext de forma diferente a cada chamada', () => {
    const key = randomDek()
    const plain = Buffer.from('idêntico')

    const a = seal(key, plain, AAD)
    const b = seal(key, plain, AAD)

    expect(a.iv.equals(b.iv)).toBe(false)
    expect(a.ct.equals(b.ct)).toBe(false)
  })
})

describe('randomIv', () => {
  // Repetir (chave, IV) em GCM quebra a confidencialidade — o IV nunca pode
  // ser derivado de contador nem reaproveitado.
  it('gera IVs distintos', () => {
    const ivs = new Set(
      Array.from({ length: 100 }, () => randomIv().toString('base64')),
    )

    expect(ivs.size).toBe(100)
  })

  it('gera IV de 12 bytes e DEK de 32', () => {
    expect(randomIv()).toHaveLength(IV_BYTES)
    expect(randomDek()).toHaveLength(32)
  })
})

describe('encodeSealed/decodeSealed', () => {
  it('faz roundtrip da serialização', () => {
    const key = randomDek()
    const sealed = seal(key, Buffer.from('para a coluna TEXT'), AAD)

    const decoded = decodeSealed(encodeSealed(sealed))

    expect(decoded.iv.equals(sealed.iv)).toBe(true)
    expect(decoded.tag.equals(sealed.tag)).toBe(true)
    expect(open(key, decoded, AAD).toString('utf8')).toBe('para a coluna TEXT')
  })

  it('serializa com prefixo de versão', () => {
    const sealed = seal(randomDek(), Buffer.from('x'), AAD)

    expect(encodeSealed(sealed).startsWith('1.')).toBe(true)
  })

  it('lança em payload com número errado de segmentos', () => {
    expect(() => decodeSealed('1.abc.def')).toThrow(/4 segmentos/)
  })

  it('lança em versão desconhecida', () => {
    const sealed = encodeSealed(seal(randomDek(), Buffer.from('x'), AAD))

    expect(() => decodeSealed(sealed.replace(/^1\./, '9.'))).toThrow(
      /Versão de payload cifrado desconhecida/,
    )
  })

  it('lança em IV de tamanho inválido', () => {
    const tag = Buffer.alloc(TAG_BYTES).toString('base64')

    expect(() =>
      decodeSealed(`1.${Buffer.alloc(8).toString('base64')}.${tag}.`),
    ).toThrow(/IV inválido/)
  })

  it('lança em tag de tamanho inválido', () => {
    const iv = Buffer.alloc(IV_BYTES).toString('base64')

    expect(() =>
      decodeSealed(`1.${iv}.${Buffer.alloc(8).toString('base64')}.`),
    ).toThrow(/Tag inválida/)
  })
})
