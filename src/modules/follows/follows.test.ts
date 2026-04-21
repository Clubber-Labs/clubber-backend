import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import { makeFollow, makeUser } from '../../test/factories'
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

describe('POST /users/:userId/follow', () => {
  it('segue usuário público — status ACCEPTED', async () => {
    const follower = await makeUser()
    const target = await makeUser({ isPrivate: false })

    const res = await app.inject({
      method: 'POST',
      url: `/users/${target.id}/follow`,
      headers: { authorization: `Bearer ${token(app, follower.id)}` },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ status: 'ACCEPTED' })
  })

  it('segue usuário privado — status PENDING', async () => {
    const follower = await makeUser()
    const target = await makeUser({ isPrivate: true })

    const res = await app.inject({
      method: 'POST',
      url: `/users/${target.id}/follow`,
      headers: { authorization: `Bearer ${token(app, follower.id)}` },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ status: 'PENDING' })
  })

  it('retorna 409 ao seguir novamente', async () => {
    const follower = await makeUser()
    const target = await makeUser()
    await makeFollow(follower.id, target.id)

    const res = await app.inject({
      method: 'POST',
      url: `/users/${target.id}/follow`,
      headers: { authorization: `Bearer ${token(app, follower.id)}` },
    })

    expect(res.statusCode).toBe(409)
  })

  it('retorna 400 ao tentar seguir a si mesmo', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: `/users/${user.id}/follow`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /users/:userId/follow', () => {
  it('deixa de seguir um usuário', async () => {
    const follower = await makeUser()
    const target = await makeUser()
    await makeFollow(follower.id, target.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/users/${target.id}/follow`,
      headers: { authorization: `Bearer ${token(app, follower.id)}` },
    })

    expect(res.statusCode).toBe(204)
  })

  it('retorna 404 se não estava seguindo', async () => {
    const follower = await makeUser()
    const target = await makeUser()

    const res = await app.inject({
      method: 'DELETE',
      url: `/users/${target.id}/follow`,
      headers: { authorization: `Bearer ${token(app, follower.id)}` },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('GET /users/:userId/followers', () => {
  it('lista seguidores do próprio perfil', async () => {
    const user = await makeUser()
    const follower = await makeUser()
    await makeFollow(follower.id, user.id)

    const res = await app.inject({
      method: 'GET',
      url: `/users/${user.id}/followers`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  it('retorna 403 para perfil privado de outro usuário', async () => {
    const privateUser = await makeUser({ isPrivate: true })
    const other = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${privateUser.id}/followers`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('GET /users/me/follow-requests', () => {
  it('lista solicitações pendentes', async () => {
    const user = await makeUser({ isPrivate: true })
    const requester = await makeUser()
    await makeFollow(requester.id, user.id, 'PENDING')

    const res = await app.inject({
      method: 'GET',
      url: '/users/me/follow-requests',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(200)
    // listPendingRequests retorna array direto (não paginado)
    expect(res.json()).toHaveLength(1)
  })
})

describe('POST /users/me/follow-requests/:followerId/accept', () => {
  it('aceita solicitação de follow', async () => {
    const user = await makeUser({ isPrivate: true })
    const requester = await makeUser()
    await makeFollow(requester.id, user.id, 'PENDING')

    const res = await app.inject({
      method: 'POST',
      url: `/users/me/follow-requests/${requester.id}/accept`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    // controller retorna 204 sem body
    expect(res.statusCode).toBe(204)
  })
})
