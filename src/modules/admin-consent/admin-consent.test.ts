import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeConsentAuditLog,
  makeUser,
  makeUserConsent,
} from '../../test/factories'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance

function token(app: FastifyInstance, userId: string) {
  return app.jwt.sign({ sub: userId })
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
describe('GET /admin/consent/audit', () => {
  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/consent/audit' })
    expect(res.statusCode).toBe(401)
  })

  it('retorna 403 para usuário não-admin', async () => {
    const user = await makeUser()
    const res = await app.inject({
      method: 'GET',
      url: '/admin/consent/audit',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('lista audit logs para admin', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const user = await makeUser()
    await makeConsentAuditLog(user.id, 'GRANTED')
    await makeConsentAuditLog(user.id, 'UPDATED')

    const res = await app.inject({
      method: 'GET',
      url: '/admin/consent/audit',
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(2)
    expect(body.data[0]).toMatchObject({
      userId: user.id,
      userName: expect.stringContaining(user.name),
      action: 'UPDATED',
      ipAddress: '192.168.1.1',
    })
    expect(body.nextCursor).toBeNull()
  })

  it('filtra por userId', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const userA = await makeUser()
    const userB = await makeUser()
    await makeConsentAuditLog(userA.id, 'GRANTED')
    await makeConsentAuditLog(userB.id, 'GRANTED')

    const res = await app.inject({
      method: 'GET',
      url: `/admin/consent/audit?userId=${userA.id}`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].userId).toBe(userA.id)
  })

  it('filtra por action', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const user = await makeUser()
    await makeConsentAuditLog(user.id, 'GRANTED')
    await makeConsentAuditLog(user.id, 'REVOKED')

    const res = await app.inject({
      method: 'GET',
      url: '/admin/consent/audit?action=REVOKED',
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(
      body.data.every((e: { action: string }) => e.action === 'REVOKED'),
    ).toBe(true)
  })

  it('pagina com cursor', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const user = await makeUser()
    await makeConsentAuditLog(user.id, 'GRANTED')
    await makeConsentAuditLog(user.id, 'UPDATED')
    await makeConsentAuditLog(user.id, 'EXPORTED')

    const page1 = await app.inject({
      method: 'GET',
      url: '/admin/consent/audit?limit=2',
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(page1.statusCode).toBe(200)
    const body1 = page1.json()
    expect(body1.data).toHaveLength(2)
    expect(body1.nextCursor).not.toBeNull()

    const page2 = await app.inject({
      method: 'GET',
      url: `/admin/consent/audit?limit=2&cursor=${body1.nextCursor}`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(page2.statusCode).toBe(200)
    const body2 = page2.json()
    expect(body2.data).toHaveLength(1)
    expect(body2.nextCursor).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('GET /admin/consent/audit/:userId', () => {
  it('retorna 401 sem autenticação', async () => {
    const user = await makeUser()
    const res = await app.inject({
      method: 'GET',
      url: `/admin/consent/audit/${user.id}`,
    })
    expect(res.statusCode).toBe(401)
  })

  it('retorna 403 para não-admin', async () => {
    const caller = await makeUser()
    const target = await makeUser()
    const res = await app.inject({
      method: 'GET',
      url: `/admin/consent/audit/${target.id}`,
      headers: { authorization: `Bearer ${token(app, caller.id)}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('retorna 404 para userId inexistente', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const res = await app.inject({
      method: 'GET',
      url: '/admin/consent/audit/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('retorna audit trail de usuário específico', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const user = await makeUser()
    await makeConsentAuditLog(user.id, 'GRANTED')
    await makeConsentAuditLog(user.id, 'REVOKED')

    const res = await app.inject({
      method: 'GET',
      url: `/admin/consent/audit/${user.id}`,
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(2)
    expect(
      body.data.every((e: { userId: string }) => e.userId === user.id),
    ).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────
describe('GET /admin/consent/stats', () => {
  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/consent/stats' })
    expect(res.statusCode).toBe(401)
  })

  it('retorna 403 para não-admin', async () => {
    const user = await makeUser()
    const res = await app.inject({
      method: 'GET',
      url: '/admin/consent/stats',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('retorna estatísticas de consentimento', async () => {
    const admin = await makeUser({ role: 'ADMIN' })
    const user = await makeUser()

    await makeUserConsent(user.id)
    await makeConsentAuditLog(user.id, 'GRANTED')
    await makeConsentAuditLog(user.id, 'REVOKED')
    await makeConsentAuditLog(user.id, 'EXPORTED')

    const res = await app.inject({
      method: 'GET',
      url: '/admin/consent/stats',
      headers: { authorization: `Bearer ${token(app, admin.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({
      totalUsersWithActiveConsent: 1,
      totalRevocations: 1,
      totalExports: 1,
      actionDistribution: {
        GRANTED: 1,
        REVOKED: 1,
        EXPORTED: 1,
        UPDATED: 0,
      },
    })
  })
})
