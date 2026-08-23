import type { FastifyInstance } from 'fastify'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

vi.mock('./social-auth.providers', () => ({
  verifyGoogleToken: vi.fn(),
  verifyAppleToken: vi.fn(),
}))

import { buildApp } from '../../test/app'
import { makeSocialAccount, makeUser } from '../../test/factories'
import { testPrisma } from '../../test/prisma'
import { verifyAppleToken, verifyGoogleToken } from './social-auth.providers'

const mockedGoogle = vi.mocked(verifyGoogleToken)
const mockedApple = vi.mocked(verifyAppleToken)

let app: FastifyInstance

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

beforeEach(() => {
  mockedGoogle.mockReset()
  mockedApple.mockReset()
})

const googleProfile = (
  overrides: Partial<{
    providerUserId: string
    email: string | null
    emailVerified: boolean
    firstName: string | null
    lastName: string | null
    pictureUrl: string | null
  }> = {},
) => ({
  provider: 'GOOGLE' as const,
  providerUserId: overrides.providerUserId ?? 'google_user_123',
  email: overrides.email === undefined ? 'novo@exemplo.com' : overrides.email,
  emailVerified: overrides.emailVerified ?? true,
  firstName: overrides.firstName === undefined ? 'João' : overrides.firstName,
  lastName: overrides.lastName === undefined ? 'Silva' : overrides.lastName,
  pictureUrl:
    overrides.pictureUrl === undefined
      ? 'https://lh3.googleusercontent.com/foo.jpg'
      : overrides.pictureUrl,
})

const appleProfile = (
  overrides: Partial<{
    providerUserId: string
    email: string | null
    firstName: string | null
    lastName: string | null
  }> = {},
) => ({
  provider: 'APPLE' as const,
  providerUserId: overrides.providerUserId ?? 'apple_user_456',
  email: overrides.email === undefined ? 'apple@exemplo.com' : overrides.email,
  emailVerified: overrides.email !== null,
  firstName: overrides.firstName === undefined ? 'Maria' : overrides.firstName,
  lastName: overrides.lastName === undefined ? 'Souza' : overrides.lastName,
  pictureUrl: null,
})

describe('POST /auth/social — signup', () => {
  it('cria usuário novo via Google e retorna profileIncomplete=true', async () => {
    mockedGoogle.mockResolvedValueOnce(
      googleProfile({ email: 'novogoogle@exemplo.com' }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'google', token: 'fake-google-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty('token')
    expect(body.profileIncomplete).toBe(true)
    expect(body.user.email).toBe('novogoogle@exemplo.com')
    // API pública não deve vazar nome interno do Prisma — usa eventsCount.
    expect(body.user).not.toHaveProperty('_count')
    expect(body.user.eventsCount).toBe(0)

    const social = await testPrisma.socialAccount.findFirst({
      where: { providerUserId: 'google_user_123' },
    })
    expect(social).toMatchObject({ provider: 'GOOGLE', userId: body.user.id })
  })

  it('nasce com consentimento e aceite dos documentos, como o cadastro por senha', async () => {
    mockedGoogle.mockResolvedValueOnce(
      googleProfile({ email: 'consentimentosocial@exemplo.com' }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'google', token: 'fake-google-token' },
    })

    expect(res.statusCode).toBe(200)
    const userId = res.json().user.id

    const consent = await testPrisma.userConsent.findUnique({
      where: { userId },
    })
    expect(consent).toMatchObject({ essentialAccepted: true, revokedAt: null })

    const acceptances = await testPrisma.termsAcceptance.count({
      where: { userId },
    })
    expect(acceptances).toBe(2)
  })

  it('cria usuário novo via Apple', async () => {
    mockedApple.mockResolvedValueOnce(
      appleProfile({ email: 'novoapple@exemplo.com' }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'apple', token: 'fake-apple-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.user.email).toBe('novoapple@exemplo.com')
    expect(body.profileIncomplete).toBe(true)

    const social = await testPrisma.socialAccount.findFirst({
      where: { providerUserId: 'apple_user_456' },
    })
    expect(social).toMatchObject({ provider: 'APPLE', userId: body.user.id })
  })

  it('aplica o fullName do body na criação da conta via Apple', async () => {
    mockedApple.mockResolvedValueOnce(
      appleProfile({
        email: 'nomeapple@exemplo.com',
        firstName: 'Ana',
        lastName: 'Luz',
      }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: {
        provider: 'apple',
        token: 'fake-apple-token',
        fullName: { givenName: 'Ana', familyName: 'Luz' },
      },
    })

    expect(res.statusCode).toBe(200)
    expect(mockedApple).toHaveBeenCalledWith('fake-apple-token', {
      givenName: 'Ana',
      familyName: 'Luz',
    })
    expect(res.json().user).toMatchObject({ name: 'Ana', lastname: 'Luz' })
  })

  it('login repetido sem fullName não sobrescreve o nome', async () => {
    // Gotcha da Apple: o fullName só vem no primeiro consentimento. Os logins
    // seguintes chegam sem ele e não podem apagar o nome salvo na criação.
    mockedApple.mockResolvedValueOnce(
      appleProfile({
        email: 'repetido@exemplo.com',
        providerUserId: 'apple_repeat',
        firstName: 'Ana',
        lastName: 'Luz',
      }),
    )
    const first = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: {
        provider: 'apple',
        token: 'fake-apple-token',
        fullName: { givenName: 'Ana', familyName: 'Luz' },
      },
    })
    expect(first.statusCode).toBe(200)

    mockedApple.mockResolvedValueOnce(
      appleProfile({
        email: 'repetido@exemplo.com',
        providerUserId: 'apple_repeat',
        firstName: null,
        lastName: null,
      }),
    )
    const second = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'apple', token: 'fake-apple-token' },
    })

    expect(second.statusCode).toBe(200)
    expect(second.json().user.id).toBe(first.json().user.id)
    expect(second.json().user).toMatchObject({ name: 'Ana', lastname: 'Luz' })
  })
})

describe('POST /auth/social — login de conta existente', () => {
  it('faz login quando SocialAccount já existe', async () => {
    const existing = await makeUser({ email: 'existente@exemplo.com' })
    await makeSocialAccount(existing.id, 'GOOGLE', {
      providerUserId: 'google_existing_789',
    })

    mockedGoogle.mockResolvedValueOnce(
      googleProfile({
        providerUserId: 'google_existing_789',
        email: 'existente@exemplo.com',
      }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'google', token: 'fake-token-long' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().user.id).toBe(existing.id)
  })

  it('linka conta social a usuário existente quando o email bate', async () => {
    const existing = await makeUser({ email: 'autolink@exemplo.com' })

    mockedGoogle.mockResolvedValueOnce(
      googleProfile({
        email: 'autolink@exemplo.com',
        providerUserId: 'google_link_1',
      }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'google', token: 'fake-token-long' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().user.id).toBe(existing.id)

    const social = await testPrisma.socialAccount.findFirst({
      where: { userId: existing.id, provider: 'GOOGLE' },
    })
    expect(social?.providerUserId).toBe('google_link_1')
  })

  it('retorna profileIncomplete=false quando user já tem phone e birthdate', async () => {
    const existing = await makeUser({ email: 'completo@exemplo.com' })
    await makeSocialAccount(existing.id, 'GOOGLE', {
      providerUserId: 'google_completo',
    })

    mockedGoogle.mockResolvedValueOnce(
      googleProfile({
        providerUserId: 'google_completo',
        email: 'completo@exemplo.com',
      }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'google', token: 'fake-token-long' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().profileIncomplete).toBe(false)
  })
})

describe('POST /auth/social — erros', () => {
  it('retorna 401 quando o provider rejeita o token', async () => {
    mockedGoogle.mockRejectedValueOnce({
      statusCode: 401,
      code: 'INVALID_PROVIDER_TOKEN',
    })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'google', token: 'token-invalido' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('retorna 400 quando emailVerified=false', async () => {
    mockedGoogle.mockResolvedValueOnce(
      googleProfile({ email: 'naoverif@exemplo.com', emailVerified: false }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'google', token: 'fake-token-long' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('SOCIAL_EMAIL_UNVERIFIED')
  })

  it('retorna 400 quando a Apple não devolve email', async () => {
    // Não acontece na prática (a Apple sempre emite email, próprio ou private
    // relay), mas o service exige — o caso protege o invariante.
    mockedApple.mockResolvedValueOnce(appleProfile({ email: null }))

    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'apple', token: 'fake-token-long' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('SOCIAL_EMAIL_PERMISSION_REQUIRED')
  })

  it('retorna 400 quando o provider é inválido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'twitter', token: 'fake-token' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('retorna 400 de validação para o provider aposentado facebook', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'facebook', token: 'fake-token-long' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('retorna 400 quando o token é vazio', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'google', token: '' },
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('POST /auth/social — auto-link', () => {
  it('linka conta Apple a usuário existente quando o email bate, normalizando o case', async () => {
    const existing = await makeUser({ email: 'autolinkapple@exemplo.com' })

    mockedApple.mockResolvedValueOnce(
      appleProfile({
        email: 'AutoLinkApple@Exemplo.COM',
        providerUserId: 'apple_link_1',
      }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'apple', token: 'fake-token-long' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().user.id).toBe(existing.id)

    const social = await testPrisma.socialAccount.findFirst({
      where: { userId: existing.id, provider: 'APPLE' },
    })
    expect(social?.providerUserId).toBe('apple_link_1')
  })

  it('normaliza email do provider para lowercase no auto-link via Google', async () => {
    const existing = await makeUser({ email: 'mixedcase@exemplo.com' })

    mockedGoogle.mockResolvedValueOnce(
      googleProfile({
        email: 'MixedCase@Exemplo.COM',
        providerUserId: 'google_normalize',
      }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'google', token: 'fake-token-long' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().user.id).toBe(existing.id)
  })
})

describe('POST /auth/social — username único', () => {
  it('gera username alternativo quando o candidato já existe', async () => {
    await makeUser({ username: 'alice' })

    mockedGoogle.mockResolvedValueOnce(
      googleProfile({
        email: 'alice@exemplo.com',
        providerUserId: 'google_alice',
      }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'google', token: 'fake-token-long' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().user.username).not.toBe('alice')
    expect(res.json().user.username).toMatch(/^alice_/)
  })
})

describe('POST /auth/social — reativação de conta', () => {
  it('reativa conta DEACTIVATED via conta social existente', async () => {
    const user = await makeUser({
      accountStatus: 'DEACTIVATED',
      deactivatedAt: new Date(),
    })
    await makeSocialAccount(user.id, 'GOOGLE', {
      providerUserId: 'google_reativa_1',
    })

    mockedGoogle.mockResolvedValueOnce(
      googleProfile({ providerUserId: 'google_reativa_1' }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'google', token: 'fake-token-long' },
    })

    expect(res.statusCode).toBe(200)
    const reloaded = await testPrisma.user.findUnique({
      where: { id: user.id },
      select: { accountStatus: true, deactivatedAt: true },
    })
    expect(reloaded?.accountStatus).toBe('ACTIVE')
    expect(reloaded?.deactivatedAt).toBeNull()
  })

  it('reativa conta PENDING_DELETION via auto-link do Google', async () => {
    const user = await makeUser({
      email: 'linkpending@exemplo.com',
      accountStatus: 'PENDING_DELETION',
      deactivatedAt: new Date(),
      scheduledDeletionAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })

    mockedGoogle.mockResolvedValueOnce(
      googleProfile({
        email: 'linkpending@exemplo.com',
        providerUserId: 'google_link_pending',
      }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'google', token: 'fake-token-long' },
    })

    expect(res.statusCode).toBe(200)
    const reloaded = await testPrisma.user.findUnique({
      where: { id: user.id },
      select: { accountStatus: true, scheduledDeletionAt: true },
    })
    expect(reloaded?.accountStatus).toBe('ACTIVE')
    expect(reloaded?.scheduledDeletionAt).toBeNull()
  })

  it('cria conta nova quando o email pertencia a uma conta anonimizada', async () => {
    // Conta anonimizada tem email placeholder e sem conta social: o email real
    // foi liberado, então um login social com ele começa do zero.
    const anonimizada = await makeUser({
      email: 'deleted+abc@deleted.invalid',
      accountStatus: 'ANONYMIZED',
      password: null,
      anonymizedAt: new Date(),
    })

    mockedGoogle.mockResolvedValueOnce(
      googleProfile({
        email: 'pessoa-real@exemplo.com',
        providerUserId: 'google_apos_anon',
      }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'google', token: 'fake-token-long' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().user.id).not.toBe(anonimizada.id)
    expect(res.json().user.email).toBe('pessoa-real@exemplo.com')
  })
})

describe('POST /auth/social — moderação (suspensão/banimento)', () => {
  // Mesmo guard do /auth/login, mas no caminho social (loadUserAndDecorate):
  // o login social de conta punida via conta já vinculada tem que ser barrado.
  it('nega login social de conta BANNED com 403', async () => {
    const user = await makeUser({
      email: 'banido@exemplo.com',
      accountStatus: 'BANNED',
    })
    await makeSocialAccount(user.id, 'GOOGLE', {
      providerUserId: 'google_banido',
    })

    mockedGoogle.mockResolvedValueOnce(
      googleProfile({
        providerUserId: 'google_banido',
        email: 'banido@exemplo.com',
      }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'google', token: 'fake-token-long' },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('ACCOUNT_BANNED')
  })

  it('nega login social de conta SUSPENDED dentro da vigência com 403', async () => {
    const user = await makeUser({
      email: 'suspenso@exemplo.com',
      accountStatus: 'SUSPENDED',
      suspendedAt: new Date(),
      suspendedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
      suspensionReason: 'Spam',
    })
    await makeSocialAccount(user.id, 'GOOGLE', {
      providerUserId: 'google_suspenso',
    })

    mockedGoogle.mockResolvedValueOnce(
      googleProfile({
        providerUserId: 'google_suspenso',
        email: 'suspenso@exemplo.com',
      }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'google', token: 'fake-token-long' },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('ACCOUNT_SUSPENDED')

    const reloaded = await testPrisma.user.findUnique({
      where: { id: user.id },
      select: { accountStatus: true },
    })
    expect(reloaded?.accountStatus).toBe('SUSPENDED')
  })

  it('auto-cura suspensão vencida no login social: volta para ACTIVE e emite token', async () => {
    const user = await makeUser({
      email: 'venceu@exemplo.com',
      accountStatus: 'SUSPENDED',
      suspendedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      suspendedUntil: new Date(Date.now() - 60 * 60 * 1000),
      suspensionReason: 'Conduta inadequada',
    })
    await makeSocialAccount(user.id, 'GOOGLE', {
      providerUserId: 'google_venceu',
    })

    mockedGoogle.mockResolvedValueOnce(
      googleProfile({
        providerUserId: 'google_venceu',
        email: 'venceu@exemplo.com',
      }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'google', token: 'fake-token-long' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().user.id).toBe(user.id)
    expect(res.json()).toHaveProperty('token')

    const reloaded = await testPrisma.user.findUnique({
      where: { id: user.id },
      select: {
        accountStatus: true,
        suspendedAt: true,
        suspendedUntil: true,
        suspensionReason: true,
      },
    })
    expect(reloaded?.accountStatus).toBe('ACTIVE')
    expect(reloaded?.suspendedAt).toBeNull()
    expect(reloaded?.suspendedUntil).toBeNull()
    expect(reloaded?.suspensionReason).toBeNull()
  })
})

describe('POST /auth/social — sessão (refresh token)', () => {
  it('retorna refreshToken (persistido como hash) junto do access token', async () => {
    mockedGoogle.mockResolvedValueOnce(
      googleProfile({
        email: 'sessao@exemplo.com',
        providerUserId: 'google_sessao_1',
      }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'google', token: 'fake-token-long' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    // Regressão: o mobile grava o refreshToken no SecureStore — se vier undefined,
    // o app quebra ("Values must be strings"). O contrato tem que casar com o do
    // /auth/login: { token, refreshToken, user, profileIncomplete }.
    expect(typeof body.token).toBe('string')
    expect(typeof body.refreshToken).toBe('string')
    expect(body.refreshToken.length).toBeGreaterThan(0)
    expect(body.refreshToken).not.toBe(body.token)

    // Persistido como hash — um dump do banco não concede sessões.
    const stored = await testPrisma.refreshToken.findFirst({
      where: { userId: body.user.id },
    })
    expect(stored).toBeTruthy()
    expect(stored?.tokenHash).not.toBe(body.refreshToken)
  })

  it('o refreshToken emitido no login social rotaciona em /auth/refresh', async () => {
    mockedGoogle.mockResolvedValueOnce(
      googleProfile({
        email: 'sessao2@exemplo.com',
        providerUserId: 'google_sessao_2',
      }),
    )

    const social = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'google', token: 'fake-token-long' },
    })
    const { refreshToken } = social.json()

    const refreshed = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      body: { refreshToken },
    })

    expect(refreshed.statusCode).toBe(200)
    const next = refreshed.json()
    expect(typeof next.token).toBe('string')
    expect(next.refreshToken).not.toBe(refreshToken)
  })
})
