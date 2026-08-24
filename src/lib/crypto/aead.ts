import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// Primitiva AEAD do envelope encryption. Módulo PURO: não conhece env, banco
// nem domínio — só bytes. Quem escolhe a chave é o chamador (chat.crypto para
// conteúdo, key-provider para envelopar DEKs).

export const AEAD_ALG = 'AES-256-GCM' as const

const CIPHER = 'aes-256-gcm'
const ENCODING_VERSION = '1'

export const DEK_BYTES = 32
export const IV_BYTES = 12
export const TAG_BYTES = 16

export type Sealed = { iv: Buffer; tag: Buffer; ct: Buffer }

function assertKey(key: Buffer) {
  if (key.length !== DEK_BYTES) {
    throw new Error(
      `Chave AEAD inválida: esperado ${DEK_BYTES} bytes, recebido ${key.length}`,
    )
  }
}

/**
 * O `aad` é OBRIGATÓRIO (não opcional) de propósito: amarra o ciphertext ao seu
 * contexto (`conv:<id>`, `evidence:v1:<reportId>`…). Sem ele, um dump do banco
 * permitiria mover um blob cifrado de um registro para outro sem detecção.
 */
export function seal(key: Buffer, plaintext: Buffer, aad: string): Sealed {
  assertKey(key)
  const iv = randomIv()
  const cipher = createCipheriv(CIPHER, key, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return { iv, tag: cipher.getAuthTag(), ct }
}

/** Lança em tag/AAD inválidos — o erro NUNCA deve ser engolido pelo chamador. */
export function open(key: Buffer, sealed: Sealed, aad: string): Buffer {
  assertKey(key)
  const decipher = createDecipheriv(CIPHER, key, sealed.iv)
  decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(sealed.tag)
  return Buffer.concat([decipher.update(sealed.ct), decipher.final()])
}

/** Serialização compacta para coluna TEXT: `1.<b64 iv>.<b64 tag>.<b64 ct>`. */
export function encodeSealed(sealed: Sealed): string {
  return [
    ENCODING_VERSION,
    sealed.iv.toString('base64'),
    sealed.tag.toString('base64'),
    sealed.ct.toString('base64'),
  ].join('.')
}

export function decodeSealed(payload: string): Sealed {
  const parts = payload.split('.')
  if (parts.length !== 4) {
    throw new Error('Payload cifrado malformado: esperado 4 segmentos')
  }
  const [version, ivB64, tagB64, ctB64] = parts
  if (version !== ENCODING_VERSION) {
    throw new Error(`Versão de payload cifrado desconhecida: ${version}`)
  }
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  if (iv.length !== IV_BYTES) {
    throw new Error(`IV inválido: esperado ${IV_BYTES} bytes`)
  }
  if (tag.length !== TAG_BYTES) {
    throw new Error(`Tag inválida: esperado ${TAG_BYTES} bytes`)
  }
  return { iv, tag, ct: Buffer.from(ctB64, 'base64') }
}

export function randomDek(): Buffer {
  return randomBytes(DEK_BYTES)
}

/** IV SEMPRE aleatório: repetir (key, iv) em GCM quebra a confidencialidade. */
export function randomIv(): Buffer {
  return randomBytes(IV_BYTES)
}
