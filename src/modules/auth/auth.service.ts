import { compare } from 'bcryptjs'
import { reactivateOnLogin } from '../users/users.repository'
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

  // Logar dentro da janela de carência reativa a conta (cancela exclusão
  // agendada / desativação). No-op para contas já ACTIVE. Conta ANONYMIZED nem
  // chega aqui: email vira placeholder e password é null (cai no 401 acima).
  await reactivateOnLogin(user.id)

  return user
}
