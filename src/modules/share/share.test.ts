import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeEvent,
  makeEventImage,
  makeInviteLink,
  makeUser,
} from '../../test/factories'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('GET /e/:token', () => {
  it('serve a landing com OG tags do evento', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, {
      isPublic: false,
      title: 'Festa na Cobertura',
    })
    await makeEventImage(event.id, { url: 'https://cdn.test/capa.webp' })
    const link = await makeInviteLink(event.id, author.id)

    const res = await app.inject({ method: 'GET', url: `/e/${link.token}` })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    // Token revogável: nenhum cache intermediário pode servir a landing depois
    // da revogação.
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).toContain('og:title')
    expect(res.body).toContain('Festa na Cobertura')
    expect(res.body).toContain('https://cdn.test/capa.webp')
    expect(res.body).toContain(`/e/${link.token}`)
  })

  it('escapa HTML vindo do título do evento', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, {
      isPublic: false,
      title: '<script>alert(1)</script>',
    })
    const link = await makeInviteLink(event.id, author.id)

    const res = await app.inject({ method: 'GET', url: `/e/${link.token}` })

    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain('<script>alert(1)</script>')
    expect(res.body).toContain('&lt;script&gt;')
  })

  it('retorna 404 com landing genérica para token inexistente', async () => {
    const res = await app.inject({ method: 'GET', url: '/e/nao-existe' })

    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toContain('text/html')
  })

  it('retorna 410 para link revogado', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })
    const link = await makeInviteLink(event.id, author.id, {
      revokedAt: new Date(),
    })

    const res = await app.inject({ method: 'GET', url: `/e/${link.token}` })

    expect(res.statusCode).toBe(410)
    expect(res.headers['content-type']).toContain('text/html')
  })

  it('retorna 410 para link expirado', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })
    const link = await makeInviteLink(event.id, author.id, {
      expiresAt: new Date(Date.now() - 1000),
    })

    const res = await app.inject({ method: 'GET', url: `/e/${link.token}` })

    expect(res.statusCode).toBe(410)
  })

  it('retorna 410 para evento cancelado', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, {
      isPublic: false,
      canceledAt: new Date(),
    })
    const link = await makeInviteLink(event.id, author.id)

    const res = await app.inject({ method: 'GET', url: `/e/${link.token}` })

    expect(res.statusCode).toBe(410)
  })

  it('retorna 404 quando o autor está banido', async () => {
    const author = await makeUser({ accountStatus: 'BANNED' })
    const event = await makeEvent(author.id, { isPublic: false })
    const link = await makeInviteLink(event.id, author.id)

    const res = await app.inject({ method: 'GET', url: `/e/${link.token}` })

    expect(res.statusCode).toBe(404)
  })
})

describe('GET /.well-known/apple-app-site-association', () => {
  it('serve o AASA com o appID do app e o path dos convites', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/apple-app-site-association',
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/json')
    expect(res.headers['cache-control']).toBe('public, max-age=3600')
    const body = res.json()
    expect(body.applinks.details[0].appIDs).toEqual([
      'K238P4B9K4.com.netobonato.clubber',
    ])
    expect(body.applinks.details[0].components).toEqual([{ '/': '/e/*' }])
  })
})

describe('GET /.well-known/assetlinks.json', () => {
  it('serve o assetlinks com package e fingerprint de assinatura', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/assetlinks.json',
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/json')
    const body = res.json()
    expect(body[0].relation).toContain(
      'delegate_permission/common.handle_all_urls',
    )
    expect(body[0].target.package_name).toBe('com.netobonato.clubber')
    expect(body[0].target.sha256_cert_fingerprints[0]).toMatch(
      /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/,
    )
  })
})
