import { randomInt } from 'node:crypto'
import { compare, hash } from 'bcryptjs'
import { env } from '../../lib/env'
import { logger } from '../../lib/logger'
import { getMailer } from '../../lib/mailer'
import { revokeAllSessions } from '../auth/auth.service'
import { reactivateOnLogin } from '../users/users.repository'
import {
  consumeCodeAndSetPassword,
  createCodeIfNoneActive,
  findActiveCodeByUser,
  findUserByEmailForReset,
  incrementAttempts,
} from './password-reset.repository'
import type {
  ForgotPasswordBody,
  ResetPasswordBody,
} from './password-reset.schema'

const log = logger.child({ component: 'password-reset' })

// Mensagem única para TODA falha de reset (e-mail desconhecido, código errado,
// expirado ou travado): não revela qual parte falhou nem se o e-mail existe.
const INVALID_RESET = {
  statusCode: 400,
  message: 'Código inválido ou expirado',
}

function generateCode(): string {
  // randomInt é cripto-forte; padStart preserva zeros à esquerda (ex.: 012345).
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function buildEmail(code: string) {
  const minutes = env.PASSWORD_RESET_CODE_TTL_MINUTES
  const text = `Seu código de recuperação de senha é: ${code}\n\nEle expira em ${minutes} minutos. Se você não pediu, ignore este e-mail.`
  const html = `<p>Seu código de recuperação de senha é:</p><p style="font-size:24px;font-weight:bold;letter-spacing:2px">${code}</p><p>Ele expira em ${minutes} minutos. Se você não pediu, ignore este e-mail.</p>`
  return { text, html }
}

export async function requestPasswordReset({ email }: ForgotPasswordBody) {
  const user = await findUserByEmailForReset(email)

  // Sem enumeração: conta inexistente ou anonimizada (terminal) → silêncio.
  // O controller responde 200 de qualquer forma.
  if (!user || user.accountStatus === 'ANONYMIZED') return

  const code = generateCode()
  const codeHash = await hash(code, 10)
  const expiresAt = new Date(
    Date.now() + env.PASSWORD_RESET_CODE_TTL_MINUTES * 60_000,
  )

  // Cooldown por conta (decidido atomicamente sob advisory lock): se já há um
  // código ativo recém-criado, não gera/envia outro. Barra email bombing e impede
  // contornar o teto de tentativas trocando de código à vontade. Retorna false →
  // não envia (o código vigente continua válido).
  const created = await createCodeIfNoneActive(
    user.id,
    codeHash,
    expiresAt,
    env.PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS * 1000,
  )
  if (!created) return

  // Envio best-effort: uma falha transitória do provedor não pode quebrar o
  // contrato sempre-200/sem-enumeração. O usuário simplesmente pede de novo.
  try {
    const { text, html } = buildEmail(code)
    await getMailer().sendMail({
      to: email,
      subject: 'Código de recuperação de senha',
      text,
      html,
    })
  } catch (err) {
    log.error({ err, userId: user.id }, 'falha ao enviar e-mail de recuperação')
  }
}

export async function resetPassword({
  email,
  code,
  newPassword,
}: ResetPasswordBody) {
  const user = await findUserByEmailForReset(email)
  if (!user || user.accountStatus === 'ANONYMIZED') throw INVALID_RESET

  const record = await findActiveCodeByUser(user.id)
  if (!record) throw INVALID_RESET

  // Trava por brute-force: checa o teto ANTES de comparar o código.
  if (record.attempts >= env.PASSWORD_RESET_MAX_ATTEMPTS) throw INVALID_RESET

  const valid = await compare(code, record.codeHash)
  if (!valid) {
    await incrementAttempts(record.id)
    throw INVALID_RESET
  }

  const passwordHash = await hash(newPassword, 10)
  // Consome o código (guarda de uso único) e troca a senha atomicamente. Se outra
  // requisição já consumiu este código (corrida), retorna false → erro genérico.
  const ok = await consumeCodeAndSetPassword(record.id, user.id, passwordHash)
  if (!ok) throw INVALID_RESET

  // Trocar a senha encerra TODAS as sessões: se alguém entrou com a senha antiga,
  // o reset (tipicamente "esqueci a senha") o expulsa de todos os dispositivos.
  await revokeAllSessions(user.id)

  // Como no login: reativa contas DEACTIVATED/PENDING_DELETION e cancela a
  // exclusão agendada. No-op para contas ACTIVE. Idempotente — seguro fora da tx.
  await reactivateOnLogin(user.id)
}
