import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import { makeEvent, makeUser } from '../../test/factories'
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

describe('privacy consents', () => {
  it('GET /privacy/consents/config retorna finalidades públicas', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/privacy/consents/config',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      policyVersion: '2026-06-02',
      termsVersion: '2026-06-02',
    })
    expect(
      res
        .json()
        .purposes.some(
          (purpose: { key: string; required: boolean }) =>
            purpose.key === 'terms_privacy_required' && purpose.required,
        ),
    ).toBe(true)
  })

  it('PUT /privacy/consents/me salva consentimentos e gera auditoria', async () => {
    const user = await makeUser({ locationConsent: false })

    const res = await app.inject({
      method: 'PUT',
      url: '/privacy/consents/me',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      payload: {
        consents: [
          { purposeKey: 'location_precise_nearby', granted: true },
          { purposeKey: 'feed_social_personalization', granted: true },
        ],
      },
    })

    expect(res.statusCode).toBe(200)
    const location = res
      .json()
      .consents.find(
        (consent: { key: string }) =>
          consent.key === 'location_precise_nearby',
      )
    expect(location.granted).toBe(true)

    const auditCount = await testPrisma.privacyConsentAuditLog.count({
      where: { userId: user.id, purposeKey: 'location_precise_nearby' },
    })
    expect(auditCount).toBe(1)
  })

  it('não permite revogar o aceite obrigatório por settings', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'PUT',
      url: '/privacy/consents/me',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      payload: {
        consents: [{ purposeKey: 'terms_privacy_required', granted: false }],
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('cria solicitações de exportação e exclusão/anonimização', async () => {
    const user = await makeUser()
    const auth = { authorization: `Bearer ${token(app, user.id)}` }

    const exportRes = await app.inject({
      method: 'POST',
      url: '/privacy/requests/export',
      headers: auth,
      payload: { notes: 'Quero meus dados.' },
    })
    const deleteRes = await app.inject({
      method: 'POST',
      url: '/privacy/requests/delete',
      headers: auth,
      payload: { notes: 'Quero anonimizar.' },
    })

    expect(exportRes.statusCode).toBe(201)
    expect(exportRes.json()).toMatchObject({ type: 'EXPORT', status: 'PENDING' })
    expect(deleteRes.statusCode).toBe(201)
    expect(deleteRes.json()).toMatchObject({
      type: 'DELETE_ANONYMIZE',
      status: 'PENDING',
    })
  })

  it('GET /feed ignora nearLat/nearLng sem consentimento de localização', async () => {
    const viewer = await makeUser({ locationConsent: false })
    const author = await makeUser()
    const event = await makeEvent(author.id, {
      isPublic: true,
      latitude: -25.4,
      longitude: -49.3,
    })

    const withoutConsent = await app.inject({
      method: 'GET',
      url: '/feed?nearLat=-25.4&nearLng=-49.3&radiusKm=20',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })
    expect(withoutConsent.statusCode).toBe(200)
    expect(
      withoutConsent
        .json()
        .data.some((item: { id: string }) => item.id === event.id),
    ).toBe(false)

    await app.inject({
      method: 'PUT',
      url: '/privacy/consents/me',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
      payload: {
        consents: [{ purposeKey: 'location_precise_nearby', granted: true }],
      },
    })

    const withConsent = await app.inject({
      method: 'GET',
      url: '/feed?nearLat=-25.4&nearLng=-49.3&radiusKm=20',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })
    expect(
      withConsent.json().data.some((item: { id: string }) => item.id === event.id),
    ).toBe(true)
  })
})
