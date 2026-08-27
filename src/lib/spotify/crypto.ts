import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto'
import { env } from '../env'

// Chave derivada do JWT_SECRET via HKDF — nenhum refresh token do Spotify fica
// em claro no banco e não exige uma env nova. (Rotacionar JWT_SECRET torna os
// tokens gravados indecifráveis: o sync trata a falha de decrypt como revogação
// e o usuário revincula — mesmo trade-off aceito no mfaSecret.)
const encryptionKey = Buffer.from(
  hkdfSync(
    'sha256',
    env.JWT_SECRET,
    // NÃO renomear: é o salt do HKDF que deriva a chave do refresh token.
    // Trocar aqui torna todo token já gravado indecifrável — rotação de chave
    // se faz bumpando o info abaixo (v2) com fallback de leitura na v1.
    'connectai-spotify-salt',
    'spotify-refresh-token-v1',
    32,
  ),
)

export function encryptRefreshToken(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    iv.toString('base64'),
    tag.toString('base64'),
    enc.toString('base64'),
  ].join('.')
}

export function decryptRefreshToken(payload: string): string {
  const [ivB64, tagB64, encB64] = payload.split('.')
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey,
    Buffer.from(ivB64, 'base64'),
  )
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(encB64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
