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
  verifyFacebookToken: vi.fn(),
}))

import { buildApp } from '../../test/app'
import { makeSocialAccount, makeUser } from '../../test/factories'
import { testPrisma } from '../../test/prisma'
import { verifyFacebookToken, verifyGoogleToken } from './social-auth.providers'

const mockedGoogle = vi.mocked(verifyGoogleToken)
const mockedFacebook = vi.mocked(verifyFacebookToken)

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
  mockedFacebook.mockReset()
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

const facebookProfile = (
  overrides: Partial<{
    providerUserId: string
    email: string | null
  }> = {},
) => ({
  provider: 'FACEBOOK' as const,
  providerUserId: overrides.providerUserId ?? 'fb_user_456',
  email: overrides.email === undefined ? 'fb@exemplo.com' : overrides.email,
  emailVerified: overrides.email !== null,
  firstName: 'Maria',
  lastName: 'Souza',
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

  it('cria usuário novo via Facebook', async () => {
    mockedFacebook.mockResolvedValueOnce(
      facebookProfile({ email: 'novofb@exemplo.com' }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'facebook', token: 'fake-facebook-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.user.email).toBe('novofb@exemplo.com')
    expect(body.profileIncomplete).toBe(true)

    const social = await testPrisma.socialAccount.findFirst({
      where: { providerUserId: 'fb_user_456' },
    })
    expect(social).toMatchObject({ provider: 'FACEBOOK', userId: body.user.id })
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
      message: 'Token Google inválido',
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
    expect(res.json().message).toMatch(/Email não verificado/)
  })

  it('retorna 400 quando o Facebook não devolve email', async () => {
    mockedFacebook.mockResolvedValueOnce(facebookProfile({ email: null }))

    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'facebook', token: 'fake-token-long' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/Permissão de email/)
  })

  it('retorna 400 quando o provider é inválido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'twitter', token: 'fake-token' },
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

describe('POST /auth/social — segurança auto-link', () => {
  it('bloqueia auto-link via Facebook quando email já existe localmente', async () => {
    await makeUser({ email: 'existente@exemplo.com' })

    mockedFacebook.mockResolvedValueOnce(
      facebookProfile({
        email: 'existente@exemplo.com',
        providerUserId: 'fb_no_link',
      }),
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/social',
      body: { provider: 'facebook', token: 'fake-token-long' },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().message).toMatch(/já tem uma conta/i)
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
