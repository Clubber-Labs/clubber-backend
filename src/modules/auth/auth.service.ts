import { compare } from 'bcryptjs'
import {
  buildOtpauthUrl,
  buildQrCodeDataUrl,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  verifyTotp,
} from '../../lib/mfa'
import { reactivateOnLogin } from '../users/users.repository'
import {
  findUserByEmail,
  findUserMfaById,
  updateUserMfa,
} from './auth.repository'
import type { LoginBody } from './auth.schema'

export type LoginResult =
  | { status: 'ok'; user: { id: string } }
  | { status: 'mfa_required' }

type MfaState = {
  mfaSecret: string | null
  mfaRecoveryCodes: string[]
}

// Valida o segundo fator — TOTP ou um código de recuperação (uso único, que é
// consumido ao usar). Retorna true se o código confere.
async function verifyMfaCode(
  userId: string,
  state: MfaState,
  code: string,
): Promise<boolean> {
  if (state.mfaSecret && verifyTotp(decryptSecret(state.mfaSecret), code)) {
    return true
  }
  const hash = hashRecoveryCode(code)
  if (state.mfaRecoveryCodes.includes(hash)) {
    await updateUserMfa(userId, {
      mfaRecoveryCodes: state.mfaRecoveryCodes.filter((h) => h !== hash),
    })
    return true
  }
  return false
}

export async function validateLogin(data: LoginBody): Promise<LoginResult> {
  const user = await findUserByEmail(data.email)
  // Conta anonimizada é terminal: nega o login (defesa em profundidade — na
  // prática o email já é placeholder e o password é null).
  if (!user || !user.password || user.accountStatus === 'ANONYMIZED') {
    throw { statusCode: 401, message: 'Invalid credentials' }
  }

  const valid = await compare(data.password, user.password)
  if (!valid) {
    throw { statusCode: 401, message: 'Invalid credentials' }
  }

  // Segundo fator: conta com MFA ativo exige o código. Sem código → sinaliza o
  // desafio (o cliente reapresenta o formulário pedindo o código de 6 dígitos).
  if (user.mfaEnabled && user.mfaSecret) {
    if (!data.mfaCode) return { status: 'mfa_required' }
    const ok = await verifyMfaCode(user.id, user, data.mfaCode)
    if (!ok) {
      throw { statusCode: 401, message: 'Código de verificação inválido' }
    }
  }

  // Logar dentro da janela de carência reativa a conta (cancela exclusão
  // agendada / desativação). No-op para contas já ACTIVE.
  await reactivateOnLogin(user.id)

  return { status: 'ok', user }
}

// ── Cadastro / gerenciamento do MFA (TOTP) ───────────────────────────────────
// O MFA é um recurso do backoffice: só contas ADMIN podem cadastrar/gerenciar.
// O usuário comum do app não tem painel administrativo, então não expõe o fluxo.

function assertAdmin(role: string) {
  if (role !== 'ADMIN') {
    throw {
      statusCode: 403,
      message: 'MFA disponível apenas para contas administrativas',
    }
  }
}

export async function setupMfa(userId: string) {
  const user = await findUserMfaById(userId)
  if (!user) throw { statusCode: 404, message: 'Usuário não encontrado' }
  assertAdmin(user.role)
  if (user.mfaEnabled) {
    throw {
      statusCode: 409,
      message: 'MFA já está ativo. Desative antes de cadastrar novamente.',
    }
  }
  const secret = generateSecret()
  await updateUserMfa(userId, { mfaSecret: encryptSecret(secret) })
  const otpauthUrl = buildOtpauthUrl(user.email, secret)
  const qrCode = await buildQrCodeDataUrl(otpauthUrl)
  // `secret` é devolvido para entrada manual no app (quando não dá pra escanear).
  return { otpauthUrl, qrCode, secret }
}

export async function enableMfa(userId: string, code: string) {
  const user = await findUserMfaById(userId)
  if (!user) throw { statusCode: 404, message: 'Usuário não encontrado' }
  assertAdmin(user.role)
  if (user.mfaEnabled) {
    throw { statusCode: 409, message: 'MFA já está ativo.' }
  }
  if (!user.mfaSecret) {
    throw { statusCode: 400, message: 'Inicie o cadastro do MFA primeiro.' }
  }
  if (!verifyTotp(decryptSecret(user.mfaSecret), code)) {
    throw { statusCode: 401, message: 'Código inválido.' }
  }
  const recoveryCodes = generateRecoveryCodes()
  await updateUserMfa(userId, {
    mfaEnabled: true,
    mfaRecoveryCodes: recoveryCodes.map(hashRecoveryCode),
  })
  // Exibidos UMA única vez — o usuário deve guardá-los.
  return { recoveryCodes }
}

export async function disableMfa(userId: string, code: string) {
  const user = await findUserMfaById(userId)
  if (!user) throw { statusCode: 404, message: 'Usuário não encontrado' }
  assertAdmin(user.role)
  if (!user.mfaEnabled) return { mfaEnabled: false } // idempotente
  const ok = await verifyMfaCode(userId, user, code)
  if (!ok) throw { statusCode: 401, message: 'Código inválido.' }
  await updateUserMfa(userId, {
    mfaEnabled: false,
    mfaSecret: null,
    mfaRecoveryCodes: [],
  })
  return { mfaEnabled: false }
}
