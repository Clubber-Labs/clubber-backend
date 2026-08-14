import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import { makeUser } from '../../test/factories'
import { testPrisma } from '../../test/prisma'
import { CURRENT_CONSENT_VERSION } from './consent.schema'

let app: FastifyInstance

function token(userId: string) {
  return app.jwt.sign({ sub: userId })
}

let signupSeq = 0
function signupPayload() {
  const n = ++signupSeq
  return {
    name: 'Novo',
    lastname: 'Usuario',
    username: `consentuser${n}`,
    phone: `1199999${String(n).padStart(4, '0')}`,
    email: `consent${n}@exemplo.com`,
    password: 'senha12345',
    birthdate: '2000-01-01T00:00:00.000Z',
    preferredCategories: ['MUSIC', 'ART'],
  }
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('cadastro registra consentimento e aceite', () => {
  it('cria user_consents e os aceites na mesma transação do POST /users', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users',
      headers: { 'user-agent': 'CadastroApp/1.0' },
      payload: signupPayload(),
    })

    expect(res.statusCode).toBe(201)
    const userId = res.json().user.id

    const consent = await testPrisma.userConsent.findUnique({
      where: { userId },
    })
    expect(consent).toMatchObject({
      essentialAccepted: true,
      consentVersion: CURRENT_CONSENT_VERSION,
      userAgent: 'CadastroApp/1.0',
      revokedAt: null,
      // Consentimento nasce desligado: o cadastro registra, não coleta.
      locationPrecise: false,
      pushNotifications: false,
      marketing: false,
      surveys: false,
    })

    const acceptances = await testPrisma.termsAcceptance.findMany({
      where: { userId },
    })
    expect(acceptances.map((a) => a.document).sort()).toEqual([
      'PRIVACY_POLICY',
      'TERMS_OF_USE',
    ])
    expect(acceptances.every((a) => a.version === '1.0')).toBe(true)

    const granted = await testPrisma.consentAuditLog.findMany({
      where: { userId, action: 'GRANTED' },
    })
    expect(granted).toHaveLength(1)
  })

  it('nasce com as preferências de produto ligadas', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users',
      payload: signupPayload(),
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().user).toMatchObject({
      socialFeed: true,
      socialVisibility: true,
      analytics: true,
    })
  })

  it('falha no cadastro não deixa aceite órfão', async () => {
    const payload = signupPayload()
    await app.inject({ method: 'POST', url: '/users', payload })

    const duplicated = await app.inject({
      method: 'POST',
      url: '/users',
      payload: { ...payload, username: `${payload.username}b` },
    })

    expect(duplicated.statusCode).toBe(409)
    const acceptances = await testPrisma.termsAcceptance.count()
    const users = await testPrisma.user.count()
    expect(acceptances).toBe(users * 2)
  })
})

describe('GET /consent', () => {
  it('retorna 200 com o registro criado no cadastro', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      userId: user.id,
      consentVersion: CURRENT_CONSENT_VERSION,
      revokedAt: null,
    })
    expect(res.json()).not.toHaveProperty('ipAddress')
    expect(res.json()).not.toHaveProperty('userAgent')
  })

  it('não expõe as preferências de produto — elas vivem no /users/me', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
    })

    expect(res.json()).not.toHaveProperty('socialFeed')
    expect(res.json()).not.toHaveProperty('analytics')
  })

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/consent' })

    expect(res.statusCode).toBe(401)
  })
})

describe('PATCH /consent', () => {
  it('atualiza campo e retorna 200', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'PATCH',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
      body: { marketing: true },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ marketing: true })
  })

  it('não sobrescreve ipAddress/userAgent originais', async () => {
    const signup = await app.inject({
      method: 'POST',
      url: '/users',
      headers: { 'user-agent': 'AgenteCadastro/1.0' },
      payload: signupPayload(),
    })
    const userId = signup.json().user.id

    await app.inject({
      method: 'PATCH',
      url: '/consent',
      headers: {
        authorization: `Bearer ${token(userId)}`,
        'user-agent': 'AgenteAtualizacao/2.0',
      },
      body: { surveys: true },
    })

    const record = await testPrisma.userConsent.findUnique({
      where: { userId },
    })
    expect(record?.userAgent).toBe('AgenteCadastro/1.0')
  })

  it('atualiza consentVersion do registro e do audit log para a versão atual', async () => {
    const user = await makeUser()

    await testPrisma.userConsent.update({
      where: { userId: user.id },
      data: { consentVersion: '0.9' },
    })

    const res = await app.inject({
      method: 'PATCH',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
      body: { marketing: true },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      marketing: true,
      consentVersion: CURRENT_CONSENT_VERSION,
    })

    const auditLog = await testPrisma.consentAuditLog.findFirst({
      where: { userId: user.id, action: 'UPDATED' },
      orderBy: { createdAt: 'desc' },
    })
    expect(auditLog?.consentVersion).toBe(CURRENT_CONSENT_VERSION)
  })

  it('sanitiza X-Forwarded-For e respeita TRUSTED_PROXIES com CIDR', async () => {
    const user = await makeUser()
    const previousTrustedProxies = process.env.TRUSTED_PROXIES

    try {
      delete process.env.TRUSTED_PROXIES
      const untrusted = await app.inject({
        method: 'PATCH',
        url: '/consent',
        headers: {
          authorization: `Bearer ${token(user.id)}`,
          'x-forwarded-for': '203.0.113.10',
          'user-agent': 'ConsentTest/1.0',
        },
        body: { marketing: true },
      })

      expect(untrusted.statusCode).toBe(200)
      expect(untrusted.json()).not.toHaveProperty('ipAddress')

      const untrustedLog = await testPrisma.consentAuditLog.findFirst({
        where: { userId: user.id, action: 'UPDATED' },
        orderBy: { createdAt: 'desc' },
      })
      expect(untrustedLog?.ipAddress).not.toBe('203.0.113.10')
      expect(untrustedLog?.userAgent).toBe('ConsentTest/1.0')

      process.env.TRUSTED_PROXIES = '127.0.0.0/8'
      const trusted = await app.inject({
        method: 'PATCH',
        url: '/consent',
        headers: {
          authorization: `Bearer ${token(user.id)}`,
          'x-forwarded-for': '203.0.113.11',
          'user-agent': 'ConsentUpdate/1.0',
        },
        body: { surveys: true },
      })

      expect(trusted.statusCode).toBe(200)
      const trustedLog = await testPrisma.consentAuditLog.findFirst({
        where: { userId: user.id, action: 'UPDATED' },
        orderBy: { createdAt: 'desc' },
      })
      expect(trustedLog?.ipAddress).toBe('203.0.113.11')
      expect(trustedLog?.userAgent).toBe('ConsentUpdate/1.0')
    } finally {
      if (previousTrustedProxies === undefined) {
        delete process.env.TRUSTED_PROXIES
      } else {
        process.env.TRUSTED_PROXIES = previousTrustedProxies
      }
    }
  })

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/consent',
      body: { marketing: true },
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('espelho da permissão do SO', () => {
  it('ligar pushNotifications depois da revogação não reativa o consentimento', async () => {
    const user = await makeUser()

    await app.inject({
      method: 'DELETE',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
    })

    // O app replica a permissão concedida no SO — não é ação do titular.
    const mirrored = await app.inject({
      method: 'PATCH',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
      body: { pushNotifications: true, locationPrecise: true },
    })

    expect(mirrored.statusCode).toBe(200)
    const record = await testPrisma.userConsent.findUnique({
      where: { userId: user.id },
    })
    expect(record?.pushNotifications).toBe(true)
    expect(record?.revokedAt).not.toBeNull()

    const me = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { authorization: `Bearer ${token(user.id)}` },
    })
    expect(me.json().consent).toMatchObject({ given: false })
  })

  it('ligar um consentimento estrito reativa', async () => {
    const user = await makeUser()

    await app.inject({
      method: 'DELETE',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
    })

    const res = await app.inject({
      method: 'PATCH',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
      body: { marketing: true },
    })

    expect(res.statusCode).toBe(200)
    const record = await testPrisma.userConsent.findUnique({
      where: { userId: user.id },
    })
    expect(record?.revokedAt).toBeNull()
  })
})

describe('consent_audit_logs constraints', () => {
  it('bloqueia action inválida no banco', async () => {
    const user = await makeUser()

    await expect(
      testPrisma.$executeRaw`
        INSERT INTO "consent_audit_logs" (
          "userId",
          "action",
          "changedFields",
          "consentVersion"
        )
        VALUES (
          ${user.id},
          'INVALID',
          '[]'::jsonb,
          ${CURRENT_CONSENT_VERSION}
        )
      `,
    ).rejects.toThrow()
  })
})

describe('DELETE /consent', () => {
  it('revoga consentimentos e também as preferências de produto', async () => {
    const user = await makeUser()

    await app.inject({
      method: 'PATCH',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
      body: { marketing: true, surveys: true, pushNotifications: true },
    })

    const res = await app.inject({
      method: 'DELETE',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
    })

    expect(res.statusCode).toBe(200)

    const record = await testPrisma.userConsent.findUnique({
      where: { userId: user.id },
    })
    expect(record?.revokedAt).not.toBeNull()
    expect(record).toMatchObject({
      marketing: false,
      surveys: false,
      pushNotifications: false,
      locationPrecise: false,
    })

    // Revogação parcial seria deixar estas ligadas por viverem noutra tabela.
    const preferences = await testPrisma.user.findUnique({
      where: { id: user.id },
      select: { socialFeed: true, socialVisibility: true, analytics: true },
    })
    expect(preferences).toMatchObject({
      socialFeed: false,
      socialVisibility: false,
      analytics: false,
    })
  })

  it('registra as preferências desligadas no audit log', async () => {
    const user = await makeUser()

    await app.inject({
      method: 'DELETE',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
    })

    const log = await testPrisma.consentAuditLog.findFirst({
      where: { userId: user.id, action: 'REVOKED' },
      orderBy: { createdAt: 'desc' },
    })
    const fields = (log?.changedFields as { field: string }[]).map(
      (entry) => entry.field,
    )
    expect(fields).toEqual(
      expect.arrayContaining(['socialFeed', 'socialVisibility', 'analytics']),
    )
  })

  it('é idempotente — revogar duas vezes não duplica o log', async () => {
    const user = await makeUser()

    await app.inject({
      method: 'DELETE',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
    })
    const afterFirst = await testPrisma.consentAuditLog.count({
      where: { userId: user.id, action: 'REVOKED' },
    })

    const repeated = await app.inject({
      method: 'DELETE',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
    })
    expect(repeated.statusCode).toBe(200)

    const afterSecond = await testPrisma.consentAuditLog.count({
      where: { userId: user.id, action: 'REVOKED' },
    })
    expect(afterSecond).toBe(afterFirst)
  })

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/consent' })

    expect(res.statusCode).toBe(401)
  })
})

describe('GET /consent/export', () => {
  it('retorna 200 e cria log EXPORTED no audit', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: '/consent/export',
      headers: { authorization: `Bearer ${token(user.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty('exportedAt')
    expect(body.currentConsent).not.toHaveProperty('ipAddress')
    expect(body.currentConsent).not.toHaveProperty('userAgent')
    expect(body.history[0]).not.toHaveProperty('ipAddress')
    expect(body.history[0]).not.toHaveProperty('userAgent')

    const exportLogs = await testPrisma.consentAuditLog.findMany({
      where: { userId: user.id, action: 'EXPORTED' },
    })
    expect(exportLogs.length).toBeGreaterThan(0)
  })

  it('inclui as preferências e os aceites que vivem fora de user_consents', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: '/consent/export',
      headers: { authorization: `Bearer ${token(user.id)}` },
    })

    const body = res.json()
    expect(body.preferences).toMatchObject({
      socialFeed: true,
      socialVisibility: true,
      analytics: true,
    })
    expect(body.termsAcceptances).toHaveLength(2)
    expect(body.termsAcceptances[0]).toMatchObject({ version: '1.0' })
  })

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/consent/export' })

    expect(res.statusCode).toBe(401)
  })
})

describe('GET /consent/audit', () => {
  it('pagina por cursor e nao expoe ipAddress/userAgent', async () => {
    const user = await makeUser()

    await app.inject({
      method: 'PATCH',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
      body: { marketing: true },
    })
    await app.inject({
      method: 'PATCH',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
      body: { surveys: true },
    })
    await app.inject({
      method: 'PATCH',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
      body: { pushNotifications: true },
    })

    const firstPage = await app.inject({
      method: 'GET',
      url: '/consent/audit?limit=2',
      headers: { authorization: `Bearer ${token(user.id)}` },
    })

    expect(firstPage.statusCode).toBe(200)
    const firstBody = firstPage.json()
    expect(firstBody.logs).toHaveLength(2)
    expect(firstBody.nextCursor).toEqual(expect.any(String))
    expect(firstBody.logs[0]).not.toHaveProperty('ipAddress')
    expect(firstBody.logs[0]).not.toHaveProperty('userAgent')

    const secondPage = await app.inject({
      method: 'GET',
      url: `/consent/audit?limit=2&cursor=${firstBody.nextCursor}`,
      headers: { authorization: `Bearer ${token(user.id)}` },
    })

    expect(secondPage.statusCode).toBe(200)
    const secondBody = secondPage.json()
    const firstIds = firstBody.logs.map((log: { id: string }) => log.id)
    const secondIds = secondBody.logs.map((log: { id: string }) => log.id)
    expect(secondIds.some((id: string) => firstIds.includes(id))).toBe(false)
  })

  it('retorna 400 para cursor invalido', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: '/consent/audit?cursor=invalido',
      headers: { authorization: `Bearer ${token(user.id)}` },
    })

    expect(res.statusCode).toBe(400)
  })

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/consent/audit' })

    expect(res.statusCode).toBe(401)
  })
})
