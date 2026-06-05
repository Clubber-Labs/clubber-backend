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

const defaultBody = {
  locationPrecise: true,
  socialFeed: true,
  socialVisibility: false,
  pushNotifications: true,
  marketing: false,
  analytics: true,
  surveys: false,
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

// ────────────────────────────────────────────────────────────────────────────
describe('POST /consent', () => {
  it('cria consentimento e retorna 201', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
      body: defaultBody,
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      userId: user.id,
      analytics: true,
      surveys: false,
    })
  })

  it('retorna 409 ao tentar criar consentimento duas vezes', async () => {
    const user = await makeUser()

    await app.inject({
      method: 'POST',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
      body: defaultBody,
    })

    const res = await app.inject({
      method: 'POST',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
      body: defaultBody,
    })

    expect(res.statusCode).toBe(409)
  })

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/consent',
      body: defaultBody,
    })

    expect(res.statusCode).toBe(401)
  })

  it('sanitiza X-Forwarded-For e respeita TRUSTED_PROXIES com CIDR', async () => {
    const user = await makeUser()
    const previousTrustedProxies = process.env.TRUSTED_PROXIES

    try {
      delete process.env.TRUSTED_PROXIES
      const res = await app.inject({
        method: 'POST',
        url: '/consent',
        headers: {
          authorization: `Bearer ${token(user.id)}`,
          'x-forwarded-for': '203.0.113.10',
          'user-agent': 'ConsentTest/1.0',
        },
        body: defaultBody,
      })

      expect(res.statusCode).toBe(201)
      expect(res.json()).not.toHaveProperty('ipAddress')
      expect(res.json()).not.toHaveProperty('userAgent')

      const record = await testPrisma.userConsent.findUnique({
        where: { userId: user.id },
      })
      expect(record?.ipAddress).not.toBe('203.0.113.10')
      expect(record?.userAgent).toBe('ConsentTest/1.0')

      process.env.TRUSTED_PROXIES = '127.0.0.0/8'
      const update = await app.inject({
        method: 'PATCH',
        url: '/consent',
        headers: {
          authorization: `Bearer ${token(user.id)}`,
          'x-forwarded-for': '203.0.113.11',
          'user-agent': 'ConsentUpdate/1.0',
        },
        body: { surveys: true },
      })

      expect(update.statusCode).toBe(200)
      const updateLog = await testPrisma.consentAuditLog.findFirst({
        where: { userId: user.id, action: 'UPDATED' },
        orderBy: { createdAt: 'desc' },
      })
      expect(updateLog?.ipAddress).toBe('203.0.113.11')
      expect(updateLog?.userAgent).toBe('ConsentUpdate/1.0')
    } finally {
      if (previousTrustedProxies === undefined) {
        delete process.env.TRUSTED_PROXIES
      } else {
        process.env.TRUSTED_PROXIES = previousTrustedProxies
      }
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('GET /consent', () => {
  it('retorna 200 com o consentimento atual', async () => {
    const user = await makeUser()

    await app.inject({
      method: 'POST',
      url: '/consent',
      headers: {
        authorization: `Bearer ${token(user.id)}`,
        'user-agent': 'ConsentRead/1.0',
      },
      body: defaultBody,
    })

    const res = await app.inject({
      method: 'GET',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      userId: user.id,
      locationPrecise: true,
      analytics: true,
      surveys: false,
    })
    expect(res.json()).not.toHaveProperty('ipAddress')
    expect(res.json()).not.toHaveProperty('userAgent')
  })

  it('retorna 404 quando não há consentimento', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
    })

    expect(res.statusCode).toBe(404)
  })

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/consent',
    })

    expect(res.statusCode).toBe(401)
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('PATCH /consent', () => {
  it('atualiza campo e retorna 200', async () => {
    const user = await makeUser()

    await app.inject({
      method: 'POST',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
      body: defaultBody,
    })

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
    const user = await makeUser()

    await app.inject({
      method: 'POST',
      url: '/consent',
      headers: {
        authorization: `Bearer ${token(user.id)}`,
        'user-agent': 'AgenteCriacao/1.0',
      },
      body: defaultBody,
    })

    await app.inject({
      method: 'PATCH',
      url: '/consent',
      headers: {
        authorization: `Bearer ${token(user.id)}`,
        'user-agent': 'AgenteAtualizacao/2.0',
      },
      body: { surveys: true },
    })

    const record = await testPrisma.userConsent.findUnique({
      where: { userId: user.id },
    })
    // O userAgent do PATCH não deve ter substituído o da criação
    expect(record?.userAgent).toBe('AgenteCriacao/1.0')
  })

  it('atualiza consentVersion do registro e do audit log para a versão atual', async () => {
    const user = await makeUser()

    await app.inject({
      method: 'POST',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
      body: defaultBody,
    })

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

    const record = await testPrisma.userConsent.findUnique({
      where: { userId: user.id },
    })
    expect(record?.consentVersion).toBe(CURRENT_CONSENT_VERSION)

    const auditLog = await testPrisma.consentAuditLog.findFirst({
      where: { userId: user.id, action: 'UPDATED' },
      orderBy: { createdAt: 'desc' },
    })
    expect(auditLog?.consentVersion).toBe(CURRENT_CONSENT_VERSION)
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

// ────────────────────────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────────────────────
describe('DELETE /consent', () => {
  it('revoga todos os consentimentos e retorna 200 com revokedAt preenchido', async () => {
    const user = await makeUser()

    await app.inject({
      method: 'POST',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
      body: defaultBody,
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
    expect(record?.analytics).toBe(false)
    expect(record?.locationPrecise).toBe(false)

    const revokeLogs = await testPrisma.consentAuditLog.count({
      where: { userId: user.id, action: 'REVOKED' },
    })

    const repeatedRevoke = await app.inject({
      method: 'DELETE',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
    })
    expect(repeatedRevoke.statusCode).toBe(200)

    const revokeLogsAfterRepeat = await testPrisma.consentAuditLog.count({
      where: { userId: user.id, action: 'REVOKED' },
    })
    expect(revokeLogsAfterRepeat).toBe(revokeLogs)

    const revokedMe = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { authorization: `Bearer ${token(user.id)}` },
    })
    expect(revokedMe.statusCode).toBe(200)
    expect(revokedMe.json().consent).toMatchObject({ given: false })

    const reactivated = await app.inject({
      method: 'PATCH',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
      body: { marketing: true },
    })
    expect(reactivated.statusCode).toBe(200)

    const reactivatedRecord = await testPrisma.userConsent.findUnique({
      where: { userId: user.id },
    })
    expect(reactivatedRecord?.revokedAt).toBeNull()

    const activeMe = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { authorization: `Bearer ${token(user.id)}` },
    })
    expect(activeMe.statusCode).toBe(200)
    expect(activeMe.json().consent).toMatchObject({ given: true })
  })

  it('retorna 404 quando não há consentimento para revogar', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'DELETE',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
    })

    expect(res.statusCode).toBe(404)
  })

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/consent',
    })

    expect(res.statusCode).toBe(401)
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('GET /consent/export', () => {
  it('retorna 200 e cria log EXPORTED no audit', async () => {
    const user = await makeUser()

    await app.inject({
      method: 'POST',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
      body: defaultBody,
    })

    const res = await app.inject({
      method: 'GET',
      url: '/consent/export',
      headers: { authorization: `Bearer ${token(user.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty('exportedAt')
    expect(body).toHaveProperty('currentConsent')
    expect(body.currentConsent).not.toHaveProperty('ipAddress')
    expect(body.currentConsent).not.toHaveProperty('userAgent')
    expect(body.history[0]).not.toHaveProperty('ipAddress')
    expect(body.history[0]).not.toHaveProperty('userAgent')

    const exportLogs = await testPrisma.consentAuditLog.findMany({
      where: { userId: user.id, action: 'EXPORTED' },
    })
    expect(exportLogs.length).toBeGreaterThan(0)
  })

  it('retorna 404 e nao cria log EXPORTED quando nao ha consentimento', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: '/consent/export',
      headers: { authorization: `Bearer ${token(user.id)}` },
    })

    expect(res.statusCode).toBe(404)

    const exportLogs = await testPrisma.consentAuditLog.findMany({
      where: { userId: user.id, action: 'EXPORTED' },
    })
    expect(exportLogs).toHaveLength(0)
  })

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/consent/export',
    })

    expect(res.statusCode).toBe(401)
  })
})

// ----------------------------------------------------------------------------
describe('GET /consent/audit', () => {
  it('pagina por cursor e nao expoe ipAddress/userAgent', async () => {
    const user = await makeUser()

    await app.inject({
      method: 'POST',
      url: '/consent',
      headers: { authorization: `Bearer ${token(user.id)}` },
      body: defaultBody,
    })

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
      body: { analytics: false },
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
    const res = await app.inject({
      method: 'GET',
      url: '/consent/audit',
    })

    expect(res.statusCode).toBe(401)
  })
})
