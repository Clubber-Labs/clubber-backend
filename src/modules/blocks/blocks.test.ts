import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import { makeBlock, makeUser } from '../../test/factories'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance

function auth(userId: string) {
  return { authorization: `Bearer ${app.jwt.sign({ sub: userId })}` }
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('POST /blocks', () => {
  it('bloqueia um usuário (201)', async () => {
    const viewer = await makeUser()
    const target = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/blocks',
      headers: auth(viewer.id),
      body: { userId: target.id },
    })
    expect(res.statusCode).toBe(201)
  })

  it('409 ao bloquear quem já está bloqueado', async () => {
    const viewer = await makeUser()
    const target = await makeUser()
    await makeBlock(viewer.id, target.id)

    const res = await app.inject({
      method: 'POST',
      url: '/blocks',
      headers: auth(viewer.id),
      body: { userId: target.id },
    })
    expect(res.statusCode).toBe(409)
  })

  it('400 ao bloquear a si mesmo', async () => {
    const viewer = await makeUser()
    const res = await app.inject({
      method: 'POST',
      url: '/blocks',
      headers: auth(viewer.id),
      body: { userId: viewer.id },
    })
    expect(res.statusCode).toBe(400)
  })

  it('404 ao bloquear usuário inexistente', async () => {
    const viewer = await makeUser()
    const res = await app.inject({
      method: 'POST',
      url: '/blocks',
      headers: auth(viewer.id),
      body: { userId: crypto.randomUUID() },
    })
    expect(res.statusCode).toBe(404)
  })

  it('401 sem autenticação', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/blocks',
      body: { userId: crypto.randomUUID() },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('DELETE /blocks/:userId', () => {
  it('desbloqueia (204)', async () => {
    const viewer = await makeUser()
    const target = await makeUser()
    await makeBlock(viewer.id, target.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/blocks/${target.id}`,
      headers: auth(viewer.id),
    })
    expect(res.statusCode).toBe(204)
  })

  it('404 ao desbloquear quem não estava bloqueado', async () => {
    const viewer = await makeUser()
    const target = await makeUser()

    const res = await app.inject({
      method: 'DELETE',
      url: `/blocks/${target.id}`,
      headers: auth(viewer.id),
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /blocks', () => {
  it('lista usuários bloqueados', async () => {
    const viewer = await makeUser()
    const target = await makeUser()
    await makeBlock(viewer.id, target.id)

    const res = await app.inject({
      method: 'GET',
      url: '/blocks',
      headers: auth(viewer.id),
    })
    expect(res.statusCode).toBe(200)
    expect(
      res
        .json()
        .data.some(
          (b: { blocked: { id: string } }) => b.blocked.id === target.id,
        ),
    ).toBe(true)
  })
})

describe('visibilidade de contas inativas em blocks', () => {
  it('GET /blocks oculta bloqueado desativado mas mantém anonimizado', async () => {
    const blocker = await makeUser()
    const active = await makeUser()
    const deactivated = await makeUser({ accountStatus: 'DEACTIVATED' })
    const anonymized = await makeUser({
      name: 'Usuário',
      lastname: 'Excluído',
      accountStatus: 'ANONYMIZED',
      anonymizedAt: new Date(),
    })
    await makeBlock(blocker.id, active.id)
    await makeBlock(blocker.id, deactivated.id)
    await makeBlock(blocker.id, anonymized.id)

    const res = await app.inject({
      method: 'GET',
      url: '/blocks',
      headers: auth(blocker.id),
    })

    expect(res.statusCode).toBe(200)
    const ids = res
      .json()
      .data.map((b: { blocked: { id: string } }) => b.blocked.id)
    expect(ids).toContain(active.id)
    expect(ids).toContain(anonymized.id)
    expect(ids).not.toContain(deactivated.id)
  })
})

describe('não bloquear contas inativas', () => {
  it('POST /blocks contra conta desativada retorna 404', async () => {
    const blocker = await makeUser()
    const target = await makeUser({ accountStatus: 'DEACTIVATED' })

    const res = await app.inject({
      method: 'POST',
      url: '/blocks',
      headers: auth(blocker.id),
      body: { userId: target.id },
    })

    expect(res.statusCode).toBe(404)
  })
})
