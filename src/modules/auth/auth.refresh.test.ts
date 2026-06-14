import type { FastifyInstance } from 'fastify'
import * as OTPAuth from 'otpauth'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import { makeRefreshToken, makeUser } from '../../test/factories'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance

function authHeader(userId: string) {
  return { authorization: `Bearer ${app.jwt.sign({ sub: userId })}` }
}

function totpCode(secret: string): string {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate()
}

async function loginTokens(email: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    body: { email, password: 'senha123' },
  })
  return res.json() as { token: string; refreshToken: string }
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('emissão de sessão com refresh token', () => {
  it('login retorna token e refreshToken', async () => {
    const user = await makeUser()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'senha123' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(typeof body.token).toBe('string')
    expect(typeof body.refreshToken).toBe('string')
    // O bruto NÃO é o que está no banco (guardamos só o hash).
    const stored = await testPrisma.refreshToken.findFirst({
      where: { userId: user.id },
    })
    expect(stored).toBeTruthy()
    expect(stored?.tokenHash).not.toBe(body.refreshToken)
  })

  it('registro retorna token e refreshToken', async () => {
    const suffix = Date.now().toString().slice(-6)
    const res = await app.inject({
      method: 'POST',
      url: '/users',
      body: {
        name: 'Nova',
        lastname: 'Conta',
        username: `novo${suffix}`,
        email: `novo_${suffix}@test.com`,
        password: 'senha123',
        phone: `1199${suffix}0`,
        birthdate: '2000-01-01',
      },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(typeof body.token).toBe('string')
    expect(typeof body.refreshToken).toBe('string')
  })
})

describe('POST /auth/refresh', () => {
  it('rotaciona: emite par novo e o refresh antigo deixa de valer', async () => {
    const user = await makeUser()
    const { refreshToken } = await loginTokens(user.email)

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      body: { refreshToken },
    })
    expect(res.statusCode).toBe(200)
    const next = res.json()
    expect(typeof next.token).toBe('string')
    expect(typeof next.refreshToken).toBe('string')
    expect(next.refreshToken).not.toBe(refreshToken)

    // O refresh novo funciona...
    const again = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      body: { refreshToken: next.refreshToken },
    })
    expect(again.statusCode).toBe(200)
  })

  it('detecção de reuso: reapresentar refresh rotacionado derruba a família', async () => {
    const user = await makeUser()
    const { refreshToken: first } = await loginTokens(user.email)

    const rotated = (
      await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        body: { refreshToken: first },
      })
    ).json() as { refreshToken: string }

    // Reusar o ANTIGO (já rotacionado/revogado) → 401 + revoga tudo.
    const reuse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      body: { refreshToken: first },
    })
    expect(reuse.statusCode).toBe(401)

    // O refresh "bom" (rotated) também foi revogado pela defesa.
    const poisoned = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      body: { refreshToken: rotated.refreshToken },
    })
    expect(poisoned.statusCode).toBe(401)

    const active = await testPrisma.refreshToken.count({
      where: { userId: user.id, revokedAt: null },
    })
    expect(active).toBe(0)
  })

  it('refresh expirado → 401', async () => {
    const user = await makeUser()
    const { raw } = await makeRefreshToken(user.id, {
      expiresAt: new Date(Date.now() - 1000),
    })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      body: { refreshToken: raw },
    })
    expect(res.statusCode).toBe(401)
  })

  it('refresh inexistente (mas com formato válido) → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      // 43 chars (passa o schema) mas não corresponde a nenhum hash.
      body: { refreshToken: 'x'.repeat(43) },
    })
    expect(res.statusCode).toBe(401)
  })

  it('refresh com formato inválido (curto) → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      body: { refreshToken: 'curto' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('logout / logout-all', () => {
  it('logout revoga o refresh apresentado', async () => {
    const user = await makeUser()
    const { refreshToken } = await loginTokens(user.email)

    const out = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: authHeader(user.id),
      body: { refreshToken },
    })
    expect(out.statusCode).toBe(200)

    const after = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      body: { refreshToken },
    })
    expect(after.statusCode).toBe(401)
  })

  it('logout exige sessão (401 sem auth)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      body: { refreshToken: 'qualquer' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('logout-all revoga todas as sessões do usuário', async () => {
    const user = await makeUser()
    const a = await loginTokens(user.email)
    const b = await loginTokens(user.email)

    const out = await app.inject({
      method: 'POST',
      url: '/auth/logout-all',
      headers: authHeader(user.id),
    })
    expect(out.statusCode).toBe(200)

    for (const t of [a.refreshToken, b.refreshToken]) {
      const r = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        body: { refreshToken: t },
      })
      expect(r.statusCode).toBe(401)
    }
  })
})

describe('revogação cruzada', () => {
  it('reset de senha revoga as sessões existentes', async () => {
    const user = await makeUser()
    const { refreshToken } = await loginTokens(user.email)

    await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      body: { email: user.email },
    })
    // Extrai o código do e-mail fake (mesmo padrão do teste de reset).
    const { fakeMailer } = await import('../../test/fake-mailer')
    const code = fakeMailer.last?.text.match(/\b(\d{6})\b/)?.[1]
    expect(code).toBeTruthy()

    const reset = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      body: { email: user.email, code, newPassword: 'novaSenha1' },
    })
    expect(reset.statusCode).toBe(200)

    const after = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      body: { refreshToken },
    })
    expect(after.statusCode).toBe(401)
  })

  it('disable de MFA revoga as sessões do admin', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    // Matricula o MFA.
    const setup = await app.inject({
      method: 'POST',
      url: '/auth/mfa/setup',
      headers: authHeader(admin.id),
    })
    const { secret } = setup.json()
    await app.inject({
      method: 'POST',
      url: '/auth/mfa/enable',
      headers: authHeader(admin.id),
      body: { code: totpCode(secret) },
    })
    // Login com TOTP → sessão com refresh token.
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: {
        email: admin.email,
        password: 'senha123',
        mfaCode: totpCode(secret),
      },
    })
    const { refreshToken } = login.json() as { refreshToken: string }

    // Desativa o MFA → deve revogar as sessões.
    const off = await app.inject({
      method: 'POST',
      url: '/auth/mfa/disable',
      headers: authHeader(admin.id),
      body: { code: totpCode(secret) },
    })
    expect(off.statusCode).toBe(200)

    const after = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      body: { refreshToken },
    })
    expect(after.statusCode).toBe(401)
  })
})
