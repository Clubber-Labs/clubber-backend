import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeBlock,
  makeEvent,
  makeFollow,
  makeUser,
} from '../../test/factories'
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

describe('bloqueio corta follow (F-08 #143)', () => {
  async function follow(followerId: string, targetId: string) {
    const res = await app.inject({
      method: 'POST',
      url: `/users/${targetId}/follow`,
      headers: auth(followerId),
    })
    expect(res.statusCode).toBe(201)
  }

  it('bloquear remove os follows recíprocos e ajusta os contadores', async () => {
    const blocker = await makeUser()
    const other = await makeUser()
    // follow mútuo aceito via API → contadores viram 1/1 dos dois lados
    await follow(blocker.id, other.id)
    await follow(other.id, blocker.id)

    const res = await app.inject({
      method: 'POST',
      url: '/blocks',
      headers: auth(blocker.id),
      body: { userId: other.id },
    })
    expect(res.statusCode).toBe(201)

    const remaining = await testPrisma.follow.count({
      where: {
        OR: [
          { followerId: blocker.id, followingId: other.id },
          { followerId: other.id, followingId: blocker.id },
        ],
      },
    })
    expect(remaining).toBe(0)

    const [b, o] = await Promise.all([
      testPrisma.user.findUniqueOrThrow({ where: { id: blocker.id } }),
      testPrisma.user.findUniqueOrThrow({ where: { id: other.id } }),
    ])
    expect(b.followersCount).toBe(0)
    expect(b.followingCount).toBe(0)
    expect(o.followersCount).toBe(0)
    expect(o.followingCount).toBe(0)
  })

  it('bloquear remove follow PENDING sem alterar contadores', async () => {
    const blocker = await makeUser({ isPrivate: true })
    const requester = await makeUser()
    await follow(requester.id, blocker.id) // privado → PENDING, sem contador

    const res = await app.inject({
      method: 'POST',
      url: '/blocks',
      headers: auth(blocker.id),
      body: { userId: requester.id },
    })
    expect(res.statusCode).toBe(201)

    const follow0 = await testPrisma.follow.findFirst({
      where: { followerId: requester.id, followingId: blocker.id },
    })
    expect(follow0).toBeNull()
    const b = await testPrisma.user.findUniqueOrThrow({
      where: { id: blocker.id },
    })
    expect(b.followersCount).toBe(0)
  })
})

describe('bloqueio esconde conteúdo de perfil privado (F-08 #143)', () => {
  it('ex-seguidor bloqueado não enxerga mais os eventos da conta privada', async () => {
    const owner = await makeUser({ isPrivate: true })
    const viewer = await makeUser()
    await makeEvent(owner.id) // evento público de conta privada
    await makeFollow(viewer.id, owner.id, 'ACCEPTED')

    // antes do bloqueio: seguidor aceito vê os eventos
    const before = await app.inject({
      method: 'GET',
      url: `/users/${owner.id}/events`,
      headers: auth(viewer.id),
    })
    expect(before.statusCode).toBe(200)
    expect(before.json().data).toHaveLength(1)

    await app.inject({
      method: 'POST',
      url: '/blocks',
      headers: auth(owner.id),
      body: { userId: viewer.id },
    })

    const after = await app.inject({
      method: 'GET',
      url: `/users/${owner.id}/events`,
      headers: auth(viewer.id),
    })
    expect(after.statusCode).toBe(200)
    expect(after.json().data).toHaveLength(0)
  })

  it('predicado esconde conteúdo mesmo com follow aceito remanescente (defesa em profundidade)', async () => {
    const owner = await makeUser({ isPrivate: true })
    const viewer = await makeUser()
    await makeEvent(owner.id)
    // simula estado inconsistente: follow aceito + bloqueio coexistindo
    await makeFollow(viewer.id, owner.id, 'ACCEPTED')
    await makeBlock(owner.id, viewer.id)

    const res = await app.inject({
      method: 'GET',
      url: `/users/${owner.id}/events`,
      headers: auth(viewer.id),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(0)
  })
})
