import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import { makeEvent, makeFollow, makeUser } from '../../test/factories'
import { fakeStorage } from '../../test/fake-storage'
import { multipartFormData, tinyPngBuffer } from '../../test/image-fixture'
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

describe('GET /users/me', () => {
  it('retorna perfil do usuário autenticado com eventsCount', async () => {
    const user = await makeUser()
    await makeEvent(user.id)
    await makeEvent(user.id)

    const res = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      id: user.id,
      email: user.email,
      eventsCount: 2,
    })
  })

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/users/me' })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /users/:id', () => {
  it('retorna followStatus null quando não autenticado', async () => {
    const user = await makeUser()

    const res = await app.inject({ method: 'GET', url: `/users/${user.id}` })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      id: user.id,
      followStatus: null,
      eventsCount: 0,
    })
  })

  it('retorna followStatus ACCEPTED quando viewer já segue', async () => {
    const viewer = await makeUser()
    const target = await makeUser()
    await makeFollow(viewer.id, target.id, 'ACCEPTED')

    const res = await app.inject({
      method: 'GET',
      url: `/users/${target.id}`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().followStatus).toBe('ACCEPTED')
  })

  it('retorna followStatus PENDING quando solicitação está pendente', async () => {
    const viewer = await makeUser()
    const target = await makeUser({ isPrivate: true })
    await makeFollow(viewer.id, target.id, 'PENDING')

    const res = await app.inject({
      method: 'GET',
      url: `/users/${target.id}`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().followStatus).toBe('PENDING')
  })

  it('retorna followStatus null quando viewer não segue', async () => {
    const viewer = await makeUser()
    const target = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${target.id}`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().followStatus).toBeNull()
  })

  it('retorna eventsCount correto', async () => {
    const user = await makeUser()
    await makeEvent(user.id)
    await makeEvent(user.id)
    await makeEvent(user.id)

    const res = await app.inject({ method: 'GET', url: `/users/${user.id}` })

    expect(res.statusCode).toBe(200)
    expect(res.json().eventsCount).toBe(3)
  })
})

describe('PATCH /users/me/avatar', () => {
  it('atualiza avatar do usuário autenticado', async () => {
    const user = await makeUser()
    const png = await tinyPngBuffer()
    const { body, contentType } = multipartFormData(
      png,
      'file',
      'avatar.png',
      'image/png',
    )

    const res = await app.inject({
      method: 'PATCH',
      url: '/users/me/avatar',
      headers: {
        authorization: `Bearer ${token(app, user.id)}`,
        'content-type': contentType,
      },
      payload: body,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().avatarUrl).toMatch(/^https:\/\/fake\.storage\//)
    expect(fakeStorage.uploads).toHaveLength(1)
    expect(fakeStorage.uploads[0].key).toContain(`users/${user.id}/`)
  })

  it('deleta avatar antigo ao subir um novo', async () => {
    const user = await makeUser()
    const png = await tinyPngBuffer()

    const first = multipartFormData(png, 'file', 'a.png', 'image/png')
    await app.inject({
      method: 'PATCH',
      url: '/users/me/avatar',
      headers: {
        authorization: `Bearer ${token(app, user.id)}`,
        'content-type': first.contentType,
      },
      payload: first.body,
    })
    const firstKey = fakeStorage.uploads[0].key

    const second = multipartFormData(png, 'file', 'b.png', 'image/png')
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/me/avatar',
      headers: {
        authorization: `Bearer ${token(app, user.id)}`,
        'content-type': second.contentType,
      },
      payload: second.body,
    })

    expect(res.statusCode).toBe(200)
    expect(fakeStorage.deleted).toContain(firstKey)
  })

  it('retorna 400 com mimetype inválido', async () => {
    const user = await makeUser()
    const { body, contentType } = multipartFormData(
      Buffer.from('fake'),
      'file',
      'doc.pdf',
      'application/pdf',
    )

    const res = await app.inject({
      method: 'PATCH',
      url: '/users/me/avatar',
      headers: {
        authorization: `Bearer ${token(app, user.id)}`,
        'content-type': contentType,
      },
      payload: body,
    })

    expect(res.statusCode).toBe(400)
  })

  it('retorna 401 sem autenticação', async () => {
    const png = await tinyPngBuffer()
    const { body, contentType } = multipartFormData(
      png,
      'file',
      'a.png',
      'image/png',
    )

    const res = await app.inject({
      method: 'PATCH',
      url: '/users/me/avatar',
      headers: { 'content-type': contentType },
      payload: body,
    })

    expect(res.statusCode).toBe(401)
  })
})
