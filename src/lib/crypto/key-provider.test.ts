import { describe, expect, it } from 'vitest'
import { randomDek } from './aead'
import { EnvKeyProvider } from './env-key-provider.service'

const KEK_V1 = Buffer.alloc(32, 0x11)
const KEK_V2 = Buffer.alloc(32, 0x22)
const AAD = 'conv:11111111-1111-1111-1111-111111111111'

function providerWith(
  entries: [number, Buffer][],
  active: number,
): EnvKeyProvider {
  return new EnvKeyProvider(new Map(entries), active)
}

describe('EnvKeyProvider', () => {
  it('envelopa e desembrulha na versão ativa', async () => {
    const provider = providerWith([[1, KEK_V1]], 1)
    const dek = randomDek()

    const wrapped = await provider.wrap(dek, AAD)

    expect(wrapped.kekVersion).toBe(1)
    expect(wrapped.blob.equals(dek)).toBe(false)
    expect((await provider.unwrap(wrapped, AAD)).equals(dek)).toBe(true)
  })

  it('expõe a versão ativa', () => {
    expect(providerWith([[2, KEK_V2]], 2).activeVersion()).toBe(2)
  })

  // O cerne da rotação: enquanto o rewrap não termina, o que foi envelopado na
  // v1 precisa continuar legível com a v2 já ativa.
  it('desembrulha blob da v1 com a v2 ativa', async () => {
    const antes = providerWith([[1, KEK_V1]], 1)
    const dek = randomDek()
    const wrapped = await antes.wrap(dek, AAD)

    const depois = providerWith(
      [
        [1, KEK_V1],
        [2, KEK_V2],
      ],
      2,
    )

    expect((await depois.unwrap(wrapped, AAD)).equals(dek)).toBe(true)
    // E toda DEK nova já nasce na v2.
    expect((await depois.wrap(randomDek(), AAD)).kekVersion).toBe(2)
  })

  it('erro em português quando a KEK da versão gravada saiu do ambiente', async () => {
    const provider = providerWith([[1, KEK_V1]], 1)
    const wrapped = await provider.wrap(randomDek(), AAD)

    const semV1 = providerWith([[2, KEK_V2]], 2)

    await expect(semV1.unwrap(wrapped, AAD)).rejects.toThrow(
      'CHAT_KEK_V1 não configurada — chave necessária para desembrulhar dados existentes',
    )
  })

  it('falha ao envelopar se a KEK ativa não está configurada', async () => {
    const provider = providerWith([[1, KEK_V1]], 2)

    await expect(provider.wrap(randomDek(), AAD)).rejects.toThrow(
      /CHAT_KEK_V2 não configurada/,
    )
  })

  it('rejeita KEK fora de 32 bytes', async () => {
    const provider = providerWith([[1, Buffer.alloc(31)]], 1)

    await expect(provider.wrap(randomDek(), AAD)).rejects.toThrow(
      /esperado 32 bytes/,
    )
  })

  // Sem AAD, um dump permitiria mover o wrappedDek de uma conversa para outra.
  it('falha ao desembrulhar com AAD diferente', async () => {
    const provider = providerWith([[1, KEK_V1]], 1)
    const wrapped = await provider.wrap(randomDek(), AAD)

    await expect(provider.unwrap(wrapped, 'conv:outra')).rejects.toThrow()
  })

  it('falha em blob adulterado', async () => {
    const provider = providerWith([[1, KEK_V1]], 1)
    const wrapped = await provider.wrap(randomDek(), AAD)
    wrapped.blob[wrapped.blob.length - 1] ^= 0x01

    await expect(provider.unwrap(wrapped, AAD)).rejects.toThrow()
  })

  it('falha em blob curto demais para conter iv e tag', async () => {
    const provider = providerWith([[1, KEK_V1]], 1)

    await expect(
      provider.unwrap({ kekVersion: 1, blob: Buffer.alloc(16) }, AAD),
    ).rejects.toThrow(/blob curto demais/)
  })
})
