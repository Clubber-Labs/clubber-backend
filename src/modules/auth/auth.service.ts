import { compare } from 'bcryptjs'
import { unblock } from '../../lib/moderation-denylist'
import {
  clearExpiredSuspension,
  reactivateOnLogin,
} from '../users/users.repository'
import { findUserByEmail } from './auth.repository'
import type { LoginBody } from './auth.schema'

export async function validateLogin(data: LoginBody) {
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

  // Logar dentro da janela de carência reativa a conta (cancela exclusão
  // agendada / desativação). No-op para contas já ACTIVE. Conta ANONYMIZED nem
  // chega aqui: email vira placeholder e password é null (cai no 401 acima).
  await reactivateOnLogin(user.id)

  return user
}
