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
import { unblock } from '../../lib/moderation-denylist'
import {
  clearExpiredSuspension,
  reactivateOnLogin,
} from '../users/users.repository'
import {
  claimRefreshToken,
  consumeRecoveryCode,
  findUserAccountStatus,
  findUserByEmail,
  findUserMfaById,
  linkRefreshTokenSuccessor,
  revokeAllRefreshTokensForUser,
  revokeRefreshTokenByHash,
  updateUserMfa,
} from './auth.repository'
import type { LoginBody } from './auth.schema'
import { hashRefreshToken } from './auth.session'

export type LoginResult =
  | { status: 'ok'; user: { id: string } }
  | { status: 'mfa_required' }
  | { status: 'mfa_setup_required'; user: { id: string } }

// O recovery code é consumido direto no banco (consumeRecoveryCode), então só
// precisamos do segredo TOTP cifrado aqui.
type MfaState = {
  mfaSecret: string | null
}

// Valida o segundo fator — TOTP ou um código de recuperação (uso único, que é
// consumido ao usar). Retorna true se o código confere.
async function verifyMfaCode(
  userId: string,
  state: MfaState,
  code: string,
): Promise<boolean> {
  if (state.mfaSecret) {
    try {
      if (verifyTotp(decryptSecret(state.mfaSecret), code)) return true
    } catch {
      // Segredo indecifrável (JWT_SECRET rotacionado / dado corrompido): trata
      // como falha de verificação, não erro de servidor — segue pro recovery.
    }
  }
  // Recovery code: consumo atômico no banco (uso único, à prova de corrida).
  return consumeRecoveryCode(userId, hashRecoveryCode(code))
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

  // Moderação: conta punida não loga (a sessão já existente é barrada na denylist
  // do authenticate). Checado após a senha pra só o dono saber o motivo.
  if (user.accountStatus === 'BANNED') {
    throw { statusCode: 403, message: 'Esta conta foi banida permanentemente.' }
  }
  if (user.accountStatus === 'SUSPENDED') {
    if (user.suspendedUntil && user.suspendedUntil > new Date()) {
      throw {
        statusCode: 403,
        message: `Esta conta está suspensa até ${user.suspendedUntil.toISOString()}.`,
      }
    }
    // Suspensão vencida: auto-cura e segue (espírito do reactivateOnLogin).
    const res = await clearExpiredSuspension(user.id, new Date())
    if (res.count > 0) await unblock(user.id)
  }

  // Segundo fator: conta com MFA ativo exige o código. Sem código → sinaliza o
  // desafio (o cliente reapresenta o formulário pedindo o código de 6 dígitos).
  if (user.mfaEnabled && user.mfaSecret) {
    if (!data.mfaCode) return { status: 'mfa_required' }
    const ok = await verifyMfaCode(user.id, user, data.mfaCode)
    if (!ok) {
      throw { statusCode: 401, message: 'Código de verificação inválido' }
    }
  } else if (user.role === 'ADMIN') {
    // MFA é obrigatório no backoffice: admin sem segundo fator cadastrado não
    // recebe sessão — precisa matricular o MFA antes (o controller emite um
    // token de matrícula de curta duração só para o fluxo de cadastro).
    // Retornamos antes do reactivateOnLogin de propósito: um admin
    // DEACTIVATED/PENDING_DELETION só é reativado quando completa o 2º fator e
    // loga de fato — o token de matrícula não concede acesso a mais nada.
    return { status: 'mfa_setup_required', user }
  }

  // Logar dentro da janela de carência reativa a conta (cancela exclusão
  // agendada / desativação). No-op para contas já ACTIVE.
  await reactivateOnLogin(user.id)

  return { status: 'ok', user }
}

// ── Refresh token: rotação, reuso e revogação ────────────────────────────────

// Valida e autoriza a rotação reivindicando o refresh de forma ATÔMICA (revoga
// no mesmo passo da validação — ver claimRefreshToken). Detecção de reuso: se o
// token já estava revogado (reapresentação de um token rotacionado), assume
// comprometimento e revoga TODA a família do usuário, negando a troca.
export async function rotateRefreshToken(
  rawToken: string,
): Promise<{ userId: string; previousTokenId: string }> {
  const { record, claimed } = await claimRefreshToken(
    hashRefreshToken(rawToken),
  )
  if (!record) {
    throw { statusCode: 401, message: 'Refresh token inválido' }
  }
  if (!claimed) {
    // Não venceu a reivindicação: já estava revogado (reuso) ou expirado/concorrência.
    if (record.revokedAt) {
      await revokeAllRefreshTokensForUser(record.userId)
      throw { statusCode: 401, message: 'Refresh token inválido' }
    }
    const expired = record.expiresAt.getTime() <= Date.now()
    throw {
      statusCode: 401,
      message: expired ? 'Refresh token expirado' : 'Refresh token inválido',
    }
  }
  // Defesa em profundidade: conta anonimizada é terminal e não renova sessão —
  // espelha o bloqueio explícito do login (validateLogin).
  const user = await findUserAccountStatus(record.userId)
  if (user?.accountStatus === 'ANONYMIZED') {
    await revokeAllRefreshTokensForUser(record.userId)
    throw { statusCode: 401, message: 'Refresh token inválido' }
  }
  return { userId: record.userId, previousTokenId: record.id }
}

// Encadeia o sucessor na cadeia de rotação (o antigo já foi revogado no claim).
export async function markRefreshTokenRotated(
  previousTokenId: string,
  replacedByTokenId: string,
) {
  await linkRefreshTokenSuccessor(previousTokenId, replacedByTokenId)
}

// Logout: revoga o refresh apresentado (restrito ao dono autenticado).
export async function revokeRefreshTokenForUser(
  rawToken: string,
  userId: string,
) {
  await revokeRefreshTokenByHash(hashRefreshToken(rawToken), userId)
}

// Logout-all: encerra todas as sessões do usuário.
export async function revokeAllSessions(userId: string) {
  await revokeAllRefreshTokensForUser(userId)
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
  let codeValid: boolean
  try {
    codeValid = verifyTotp(decryptSecret(user.mfaSecret), code)
  } catch {
    // Segredo pendente indecifrável (ex.: JWT_SECRET rotacionado entre setup e
    // enable) → trata como código inválido, não deixa virar 500.
    codeValid = false
  }
  if (!codeValid) {
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
  // Desligar o 2º fator encerra as sessões: força relogar já sem MFA exigido.
  await revokeAllRefreshTokensForUser(userId)
  return { mfaEnabled: false }
}
