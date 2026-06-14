import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from 'node:crypto'
import * as OTPAuth from 'otpauth'
import QRCode from 'qrcode'
import { env } from './env'

// MFA por TOTP (RFC 6238). Compatível com Google/Microsoft Authenticator etc.
// Janela de ±1 passo de 30s tolera relógio dessincronizado.

const ISSUER = 'ConnectAI'
const TOTP_WINDOW = 1

// ── TOTP ─────────────────────────────────────────────────────────────────────

function totpFor(secret: string, label = ISSUER): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  })
}

export function generateSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32 // 160 bits
}

export function buildOtpauthUrl(accountName: string, secret: string): string {
  return totpFor(secret, accountName).toString()
}

export function buildQrCodeDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl)
}

export function verifyTotp(secret: string, token: string): boolean {
  try {
    return (
      totpFor(secret).validate({ token: token.trim(), window: TOTP_WINDOW }) !==
      null
    )
  } catch {
    return false
  }
}

// ── Cifra do segredo em repouso (AES-256-GCM) ────────────────────────────────
// Chave derivada do JWT_SECRET via HKDF — não há segredo MFA em claro no banco e
// não exige uma env nova. (Rotacionar JWT_SECRET invalida os segredos MFA, que é
// o trade-off aceito; nesse caso os usuários recadastram o MFA.)

const encryptionKey = Buffer.from(
  hkdfSync(
    'sha256',
    env.JWT_SECRET,
    'connectai-mfa-salt',
    'mfa-secret-encryption-v1',
    32,
  ),
)

export function encryptSecret(plain: string): string {
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

export function decryptSecret(payload: string): string {
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

// ── Códigos de recuperação (uso único, guardados como hash) ──────────────────

export function generateRecoveryCodes(n = 10): string[] {
  // 10 bytes = 80 bits de entropia (20 hex chars — cabe no max(20) do schema).
  return Array.from({ length: n }, () => randomBytes(10).toString('hex'))
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.trim().toLowerCase()).digest('hex')
}
