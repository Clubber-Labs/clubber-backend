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

describe('PUT /users/:id — conflitos de unique constraint', () => {
  it('retorna 409 com mensagem amigável quando phone já está em uso', async () => {
    const owner = await makeUser({ phone: '11999999999' })
    const other = await makeUser({ phone: '22888888888' })

    const res = await app.inject({
      method: 'PUT',
      url: `/users/${other.id}`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
      payload: { phone: '11999999999' },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().message).toBe(
      'Este telefone já está cadastrado em outra conta.',
    )
    // Garante que NÃO vaza path/SQL/stack
    expect(res.json().message).not.toMatch(/\/Users\/|prisma\.|invocation/i)
    expect(owner.id).toBeDefined()
  })

  it('retorna 409 com mensagem amigável quando username já está em uso', async () => {
    await makeUser({ username: 'ocupado' })
    const editor = await makeUser({ username: 'livre' })

    const res = await app.inject({
      method: 'PUT',
      url: `/users/${editor.id}`,
      headers: { authorization: `Bearer ${token(app, editor.id)}` },
      payload: { username: 'ocupado' },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().message).toBe('Este nome de usuário já está em uso.')
  })
})

describe('POST /users — conflitos de unique constraint', () => {
  it('retorna 409 com mensagem nova quando email já está em uso', async () => {
    await makeUser({ email: 'duplicado@exemplo.com' })

    const res = await app.inject({
      method: 'POST',
      url: '/users',
      payload: {
        name: 'Novo',
        lastname: 'Usuario',
        username: 'novousuario',
        phone: '99999999999',
        email: 'duplicado@exemplo.com',
        password: 'senha12345',
        birthdate: '2000-01-01T00:00:00.000Z',
      },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().message).toBe(
      'Este e-mail já está cadastrado em outra conta.',
    )
  })
})

describe('rate limit em POST /users', () => {
  it('retorna 429 após 10 tentativas no mesmo minuto', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/users',
        body: {},
      })
      expect(res.statusCode).toBe(400)
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/users',
      body: {},
    })
    expect(blocked.statusCode).toBe(429)
  })
})
