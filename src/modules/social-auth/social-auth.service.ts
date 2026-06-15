import { randomBytes, randomUUID } from 'node:crypto'
import { Prisma, type SocialProvider } from '@prisma/client'
import { unblock } from '../../lib/moderation-denylist'
import {
  clearExpiredSuspension,
  findOwnUserById,
  findUserByEmail,
  findUserByUsername,
  reactivateOnLogin,
} from '../users/users.repository'
import { verifyFacebookToken, verifyGoogleToken } from './social-auth.providers'
import {
  createSocialAccount,
  createUserWithSocialAccount,
  findSocialAccount,
} from './social-auth.repository'
import type {
  SocialLoginBody,
  VerifiedSocialProfile,
} from './social-auth.schema'

const USERNAME_RETRY_ATTEMPTS = 5

function isUsernameUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false
  if (err.code !== 'P2002') return false
  const target = err.meta?.target
  if (Array.isArray(target)) return target.includes('username')
  if (typeof target === 'string') return target.includes('username')
  return false
}

async function verifyTokenByProvider(
  provider: SocialLoginBody['provider'],
  token: string,
): Promise<VerifiedSocialProfile> {
  if (provider === 'google') return verifyGoogleToken(token)
  return verifyFacebookToken(token)
}

function sanitizeUsernameBase(email: string) {
  const localPart = email.split('@')[0] ?? ''
  const slug = localPart.toLowerCase().replace(/[^a-z0-9_]/g, '_')
  if (slug.length >= 4) return slug.slice(0, 20)
  return `${slug}_user`.slice(0, 20)
}

async function generateUniqueUsername(email: string) {
  const base = sanitizeUsernameBase(email)
  if (!(await findUserByUsername(base))) return base

  for (let i = 0; i < USERNAME_RETRY_ATTEMPTS; i++) {
    const candidate = `${base}_${randomBytes(3).toString('hex')}`.slice(0, 25)
    if (!(await findUserByUsername(candidate))) return candidate
  }

  return `${base}_${randomUUID().slice(0, 8)}`.slice(0, 25)
}

async function loadUserAndDecorate(userId: string) {
  const user = await findOwnUserById(userId)
  if (!user) {
    throw {
      statusCode: 500,
      message: 'Usuário não encontrado após autenticação social',
    }
  }
  // Defesa em profundidade (simétrico ao getMe): conta anonimizada não loga.
  // Inatingível na prática — a anonimização apaga as social accounts e troca o
  // email por placeholder, então nem `existing` nem `linkable` resolvem aqui.
  if (user.accountStatus === 'ANONYMIZED') {
    throw { statusCode: 401, message: 'Sessão inválida' }
  }
  // Moderação: conta punida não loga (sessão existente é barrada na denylist do
  // authenticate). suspendedUntil vem no próprio select privado (sem 2ª query).
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
    const res = await clearExpiredSuspension(user.id, new Date())
    if (res.count > 0) await unblock(user.id)
  }
  // Espelha o shape de getMe: achata _count em eventsCount e expõe hasPassword
  // (derivado, sem vazar o hash) pra o cliente decidir o fluxo de exclusão.
  const { _count, password, ...rest } = user
  const profileIncomplete = !user.phone || !user.birthdate
  return {
    user: {
      ...rest,
      eventsCount: _count.events,
      hasPassword: password !== null,
    },
    profileIncomplete,
  }
}

export async function socialLogin(body: SocialLoginBody) {
  const profile = await verifyTokenByProvider(body.provider, body.token)

  if (!profile.email) {
    throw { statusCode: 400, message: 'Permissão de email é obrigatória' }
  }
  if (!profile.emailVerified) {
    throw { statusCode: 400, message: 'Email não verificado pelo provider' }
  }

  // Normaliza pra case-insensitive: Postgres unique é binário, mas provedores
  // (Google em particular) podem retornar o email com case variado.
  profile.email = profile.email.toLowerCase()

  const existing = await findSocialAccount(
    profile.provider,
    profile.providerUserId,
  )
  if (existing) {
    // Login social dentro da janela de carência reativa a conta.
    await reactivateOnLogin(existing.userId)
    return loadUserAndDecorate(existing.userId)
  }

  const linkable = await findUserByEmail(profile.email)
  if (linkable) {
    // Auto-link só pra Google: o ID token assina explicitamente email_verified,
    // dando garantia criptográfica de propriedade do email. O Facebook só
    // sinaliza isso indiretamente (Graph API omite email não-confirmado),
    // o que é heurística, não asserção auditada — fraco demais pra ganchar
    // numa conta tradicional existente. Pra Facebook + email já cadastrado,
    // exigimos login tradicional primeiro (linkagem manual via perfil — TODO).
    if (profile.provider !== 'GOOGLE') {
      throw {
        statusCode: 409,
        message:
          'Esse email já tem uma conta. Faça login com sua senha primeiro.',
      }
    }
    await createSocialAccount({
      userId: linkable.id,
      provider: profile.provider,
      providerUserId: profile.providerUserId,
      email: profile.email,
    })
    // Auto-link via Google em conta na janela de carência também reativa.
    await reactivateOnLogin(linkable.id)
    return loadUserAndDecorate(linkable.id)
  }

  const userBase = {
    name: profile.firstName?.trim() || 'Usuário',
    lastname: profile.lastName?.trim() || 'Social',
    email: profile.email,
    avatarUrl: profile.pictureUrl,
  }
  const social = {
    provider: profile.provider as SocialProvider,
    providerUserId: profile.providerUserId,
    email: profile.email,
  }

  // Retry em P2002 no username: generateUniqueUsername faz check-then-create,
  // então dois signups concorrentes podem ler o mesmo candidato livre e o
  // segundo INSERT estoura o unique constraint. Regenera e tenta de novo.
  for (let attempt = 0; attempt < USERNAME_RETRY_ATTEMPTS; attempt++) {
    const username = await generateUniqueUsername(profile.email)
    try {
      const created = await createUserWithSocialAccount({
        user: { ...userBase, username },
        social,
      })
      return loadUserAndDecorate(created.id)
    } catch (err) {
      if (!isUsernameUniqueViolation(err)) throw err
    }
  }

  throw {
    statusCode: 500,
    message: 'Não foi possível gerar username único após múltiplas tentativas',
  }
}
