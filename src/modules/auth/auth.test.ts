import type { FastifyInstance } from 'fastify'
import * as OTPAuth from 'otpauth'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import { makeUser } from '../../test/factories'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance

function authHeader(userId: string) {
  return { authorization: `Bearer ${app.jwt.sign({ sub: userId })}` }
}

// Token de matrícula de MFA (escopo restrito ao cadastro do segundo fator).
function enrollmentHeader(userId: string) {
  const token = app.jwt.sign({ sub: userId, mfaEnrollment: true })
  return { authorization: `Bearer ${token}` }
}

function totpCode(secret: string): string {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate()
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('POST /auth/login', () => {
  it('retorna token com credenciais válidas', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'senha123' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveProperty('token')
  })

  it('retorna 401 com senha incorreta', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'errada' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('retorna 401 com email inexistente', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: 'naoexiste@test.com', password: 'senha123' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('retorna 401 quando o usuário só tem conta social (password=null)', async () => {
    const user = await makeUser({ password: null })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'senha123' },
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('POST /auth/login — reativação de conta', () => {
  it('reativa conta DEACTIVATED ao logar', async () => {
    const user = await makeUser({
      accountStatus: 'DEACTIVATED',
      deactivatedAt: new Date(),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'senha123' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveProperty('token')

    const reloaded = await testPrisma.user.findUnique({
      where: { id: user.id },
      select: { accountStatus: true, deactivatedAt: true },
    })
    expect(reloaded?.accountStatus).toBe('ACTIVE')
    expect(reloaded?.deactivatedAt).toBeNull()
  })

  it('reativa conta PENDING_DELETION e cancela exclusão agendada', async () => {
    const user = await makeUser({
      accountStatus: 'PENDING_DELETION',
      deactivatedAt: new Date(),
      scheduledDeletionAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'senha123' },
    })

    expect(res.statusCode).toBe(200)
    const reloaded = await testPrisma.user.findUnique({
      where: { id: user.id },
      select: { accountStatus: true, scheduledDeletionAt: true },
    })
    expect(reloaded?.accountStatus).toBe('ACTIVE')
    expect(reloaded?.scheduledDeletionAt).toBeNull()
  })

  it('nega login de conta ANONYMIZED', async () => {
    const user = await makeUser({
      accountStatus: 'ANONYMIZED',
      password: null,
      anonymizedAt: new Date(),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'senha123' },
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('POST /auth/login — moderação (suspensão/banimento)', () => {
  // O guard é checado DEPOIS da senha (só o dono sabe o motivo): os testes usam
  // a senha correta de propósito, pra exercitar o branch de moderação — não o 401
  // genérico de credencial inválida.
  it('nega login de conta BANNED com 403', async () => {
    const user = await makeUser({ accountStatus: 'BANNED' })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'senha123' },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().message).toMatch(/banida/i)
  })

  it('nega login de conta SUSPENDED dentro da vigência com 403', async () => {
    const user = await makeUser({
      accountStatus: 'SUSPENDED',
      suspendedAt: new Date(),
      suspendedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
      suspensionReason: 'Spam',
    })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'senha123' },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().message).toMatch(/suspensa/i)

    // Suspensão vigente NÃO é curada: o estado no banco continua SUSPENDED.
    const reloaded = await testPrisma.user.findUnique({
      where: { id: user.id },
      select: { accountStatus: true },
    })
    expect(reloaded?.accountStatus).toBe('SUSPENDED')
  })

  it('auto-cura suspensão vencida ao logar: volta para ACTIVE e emite token', async () => {
    const user = await makeUser({
      accountStatus: 'SUSPENDED',
      suspendedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      // Venceu há 1h: o login passa e dispara o auto-unblock.
      suspendedUntil: new Date(Date.now() - 60 * 60 * 1000),
      suspensionReason: 'Conduta inadequada',
    })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'senha123' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveProperty('token')

    // Mutação de estado no caminho de login: a suspensão vencida é zerada.
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

describe('rate limit em POST /auth/login', () => {
  it('retorna 429 após 10 tentativas no mesmo minuto', async () => {
    const body = { email: 'naoexiste@test.com', password: 'qualquer' }

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        body,
      })
      expect(res.statusCode).toBe(401)
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body,
    })
    expect(blocked.statusCode).toBe(429)
  })
})

describe('GET /auth/me (removido)', () => {
  it('retorna 404 — rota substituída por GET /users/me', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me' })
    expect(res.statusCode).toBe(404)
  })
})

describe('MFA (TOTP)', () => {
  // MFA é recurso do backoffice: só contas ADMIN cadastram/gerenciam.
  function makeAdmin() {
    return makeUser({ role: 'ADMIN' })
  }

  async function enrollMfa(userId: string) {
    const setup = await app.inject({
      method: 'POST',
      url: '/auth/mfa/setup',
      headers: authHeader(userId),
    })
    const { secret } = setup.json()
    const enable = await app.inject({
      method: 'POST',
      url: '/auth/mfa/enable',
      headers: authHeader(userId),
      body: { code: totpCode(secret) },
    })
    return { secret, recoveryCodes: enable.json().recoveryCodes as string[] }
  }

  it('setup retorna otpauthUrl + qrCode + secret', async () => {
    const user = await makeAdmin()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/setup',
      headers: authHeader(user.id),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//)
    expect(body.qrCode).toMatch(/^data:image\/png;base64,/)
    expect(typeof body.secret).toBe('string')
  })

  it('setup exige autenticação (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/mfa/setup' })
    expect(res.statusCode).toBe(401)
  })

  it('setup negado para usuário comum → 403', async () => {
    const user = await makeUser()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/setup',
      headers: authHeader(user.id),
    })
    expect(res.statusCode).toBe(403)
  })

  it('enable negado para usuário comum → 403', async () => {
    const user = await makeUser()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/enable',
      headers: authHeader(user.id),
      body: { code: '000000' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('disable negado para usuário comum → 403', async () => {
    const user = await makeUser()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/disable',
      headers: authHeader(user.id),
      body: { code: '000000' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('enable com código válido ativa o MFA e devolve recovery codes', async () => {
    const user = await makeAdmin()
    const { recoveryCodes } = await enrollMfa(user.id)
    expect(recoveryCodes).toHaveLength(10)
    const reloaded = await testPrisma.user.findUnique({
      where: { id: user.id },
      select: { mfaEnabled: true, mfaSecret: true },
    })
    expect(reloaded?.mfaEnabled).toBe(true)
    // segredo guardado CIFRADO (não é o base32 cru)
    expect(reloaded?.mfaSecret).toBeTruthy()
  })

  it('enable com código inválido → 401', async () => {
    const user = await makeAdmin()
    await app.inject({
      method: 'POST',
      url: '/auth/mfa/setup',
      headers: authHeader(user.id),
    })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/enable',
      headers: authHeader(user.id),
      body: { code: '000000' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('login sem código quando MFA ativo → mfaRequired, sem token', async () => {
    const user = await makeAdmin()
    await enrollMfa(user.id)
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'senha123' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ mfaRequired: true })
  })

  it('login com TOTP válido → token', async () => {
    const user = await makeAdmin()
    const { secret } = await enrollMfa(user.id)
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: {
        email: user.email,
        password: 'senha123',
        mfaCode: totpCode(secret),
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveProperty('token')
  })

  it('login com código MFA inválido → 401', async () => {
    const user = await makeAdmin()
    await enrollMfa(user.id)
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'senha123', mfaCode: '000000' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('código de recuperação funciona e é consumido (uso único)', async () => {
    const user = await makeAdmin()
    const { recoveryCodes } = await enrollMfa(user.id)
    const code = recoveryCodes[0]

    const first = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'senha123', mfaCode: code },
    })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toHaveProperty('token')

    const reuse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'senha123', mfaCode: code },
    })
    expect(reuse.statusCode).toBe(401)
  })

  it('código de recuperação é à prova de corrida (2 logins paralelos → 1 token)', async () => {
    const user = await makeAdmin()
    const { recoveryCodes } = await enrollMfa(user.id)
    const code = recoveryCodes[0]

    // Dois logins simultâneos com o MESMO código: o consumo atômico no banco
    // garante que só um seja aceito (o outro vê o código já removido).
    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/auth/login',
        body: { email: user.email, password: 'senha123', mfaCode: code },
      }),
      app.inject({
        method: 'POST',
        url: '/auth/login',
        body: { email: user.email, password: 'senha123', mfaCode: code },
      }),
    ])

    const statuses = [a.statusCode, b.statusCode].sort()
    expect(statuses).toEqual([200, 401])
  })

  it('disable com código válido desativa o MFA (admin volta a exigir matrícula)', async () => {
    const user = await makeAdmin()
    const { secret } = await enrollMfa(user.id)

    const off = await app.inject({
      method: 'POST',
      url: '/auth/mfa/disable',
      headers: authHeader(user.id),
      body: { code: totpCode(secret) },
    })
    expect(off.statusCode).toBe(200)

    const reloaded = await testPrisma.user.findUnique({
      where: { id: user.id },
      select: { mfaEnabled: true, mfaSecret: true },
    })
    expect(reloaded?.mfaEnabled).toBe(false)
    expect(reloaded?.mfaSecret).toBeNull()

    // MFA é obrigatório para ADMIN: ao desativar, o próximo login do admin
    // volta a exigir matrícula (não emite sessão direto).
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'senha123' },
    })
    expect(login.json().mfaSetupRequired).toBe(true)
  })

  // ── MFA obrigatório para ADMIN (matrícula forçada) ─────────────────────────

  it('admin sem MFA → login exige matrícula (mfaSetupRequired + enrollmentToken, sem token)', async () => {
    const user = await makeAdmin()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'senha123' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.mfaSetupRequired).toBe(true)
    expect(typeof body.enrollmentToken).toBe('string')
    expect(body.token).toBeUndefined()
  })

  it('token de matrícula cadastra o MFA e o login com código emite a sessão', async () => {
    const user = await makeAdmin()
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'senha123' },
    })
    const enrollHeader = {
      authorization: `Bearer ${login.json().enrollmentToken}`,
    }

    const setup = await app.inject({
      method: 'POST',
      url: '/auth/mfa/setup',
      headers: enrollHeader,
    })
    expect(setup.statusCode).toBe(200)
    const { secret } = setup.json()

    const enable = await app.inject({
      method: 'POST',
      url: '/auth/mfa/enable',
      headers: enrollHeader,
      body: { code: totpCode(secret) },
    })
    expect(enable.statusCode).toBe(200)
    expect(enable.json().recoveryCodes).toHaveLength(10)

    const session = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: {
        email: user.email,
        password: 'senha123',
        mfaCode: totpCode(secret),
      },
    })
    expect(session.statusCode).toBe(200)
    expect(session.json()).toHaveProperty('token')
  })

  it('token de matrícula não autoriza rota normal (GET /users/me → 401)', async () => {
    const user = await makeAdmin()
    const res = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: enrollmentHeader(user.id),
    })
    expect(res.statusCode).toBe(401)
  })

  it('token de matrícula não desativa o MFA (disable exige sessão plena → 401)', async () => {
    const user = await makeAdmin()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/disable',
      headers: enrollmentHeader(user.id),
      body: { code: '000000' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('usuário comum sem MFA loga normalmente (não força matrícula)', async () => {
    const user = await makeUser()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'senha123' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveProperty('token')
  })

  it('endpoints de MFA têm rate limit (429 após 5 no mesmo minuto)', async () => {
    const user = await makeAdmin()
    const headers = authHeader(user.id)
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/mfa/setup',
        headers,
      })
      expect(res.statusCode).toBe(200)
    }
    const blocked = await app.inject({
      method: 'POST',
      url: '/auth/mfa/setup',
      headers,
    })
    expect(blocked.statusCode).toBe(429)
  })
})
