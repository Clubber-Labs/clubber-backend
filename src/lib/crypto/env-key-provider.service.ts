import { IV_BYTES, open, seal, TAG_BYTES } from './aead'
import type { IKeyProvider, WrappedKey } from './key-provider.interface'

// KEKs vindas do ambiente (`CHAT_KEK_V<n>`), versionadas. Recebe o mapa pronto
// no construtor em vez de ler `env` direto: mantém a classe testável sem mexer
// em process.env e deixa o boot decidir a política de falha.
//
// Formato do blob (opaco fora daqui): iv(12) || tag(16) || ciphertext.

export class EnvKeyProvider implements IKeyProvider {
  private readonly keks: ReadonlyMap<number, Buffer>
  private readonly active: number

  constructor(keks: ReadonlyMap<number, Buffer>, activeVersion: number) {
    this.keks = keks
    this.active = activeVersion
  }

  activeVersion(): number {
    return this.active
  }

  private kekFor(version: number): Buffer {
    const kek = this.keks.get(version)
    if (!kek) {
      throw new Error(
        `CHAT_KEK_V${version} não configurada — chave necessária para desembrulhar dados existentes`,
      )
    }
    return kek
  }

  async wrap(key: Buffer, aad: string): Promise<WrappedKey> {
    const sealed = seal(this.kekFor(this.active), key, aad)
    return {
      kekVersion: this.active,
      blob: Buffer.concat([sealed.iv, sealed.tag, sealed.ct]),
    }
  }

  async unwrap(wrapped: WrappedKey, aad: string): Promise<Buffer> {
    // Desembrulha na versão GRAVADA, não na ativa: durante a rotação as duas
    // convivem, e a KEK antiga só sai do ambiente quando o rewrap termina.
    const kek = this.kekFor(wrapped.kekVersion)
    if (wrapped.blob.length <= IV_BYTES + TAG_BYTES) {
      throw new Error('Chave envelopada malformada: blob curto demais')
    }
    return open(
      kek,
      {
        iv: wrapped.blob.subarray(0, IV_BYTES),
        tag: wrapped.blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES),
        ct: wrapped.blob.subarray(IV_BYTES + TAG_BYTES),
      },
      aad,
    )
  }
}
