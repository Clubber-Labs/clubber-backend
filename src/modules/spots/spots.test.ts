import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import { makeBlock, makeFollow, makeSpot, makeUser } from '../../test/factories'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance

function token(userId: string) {
  return app.jwt.sign({ sub: userId })
}

function auth(userId: string) {
  return { authorization: `Bearer ${token(userId)}` }
}

// bbox em torno de Curitiba (-25.4, -49.3); makeSpot cai aqui por padrão.
const BBOX =
  '/spots?bboxNorth=-25.3&bboxSouth=-25.5&bboxEast=-49.2&bboxWest=-49.4'

function spotBody(overrides: Record<string, unknown> = {}) {
  const now = Date.now()
  return {
    title: 'Happy hour no bar',
    categories: ['PARTY'],
    placeId: 'place_abc',
    latitude: -25.4,
    longitude: -49.3,
    startsAt: new Date(now + 3600_000).toISOString(),
    endsAt: new Date(now + 4 * 3600_000).toISOString(),
    ...overrides,
  }
}

/** Torna A e B amigos (follow mútuo aceito). */
async function makeFriends(aId: string, bId: string) {
  await makeFollow(aId, bId, 'ACCEPTED')
  await makeFollow(bId, aId, 'ACCEPTED')
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('POST /spots', () => {
  it('publica o spot e cria o grupo com o criador (201)', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/spots',
      headers: auth(user.id),
      body: spotBody({ categories: ['PARTY', 'MUSIC'] }),
    })

    expect(res.statusCode).toBe(201)
    const spot = res.json()
    expect(spot).toMatchObject({
      title: 'Happy hour no bar',
      visibility: 'PUBLIC',
      memberCount: 1,
    })
    expect(spot.categories).toEqual(expect.arrayContaining(['PARTY', 'MUSIC']))
    expect(spot.conversationId).toBeTruthy()
    expect(spot.creator.id).toBe(user.id)

    // O grupo nasceu com o criador como ADMIN.
    const participants = await testPrisma.conversationParticipant.findMany({
      where: { conversationId: spot.conversationId },
    })
    expect(participants).toHaveLength(1)
    expect(participants[0]).toMatchObject({ userId: user.id, role: 'ADMIN' })
  })

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/spots',
      body: spotBody(),
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejeita spot com a janela inteira no passado (400)', async () => {
    const user = await makeUser()
    const past = Date.now() - 10 * 3600_000
    const res = await app.inject({
      method: 'POST',
      url: '/spots',
      headers: auth(user.id),
      body: spotBody({
        startsAt: new Date(past).toISOString(),
        endsAt: new Date(past + 3600_000).toISOString(),
      }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejeita endsAt antes de startsAt (400)', async () => {
    const user = await makeUser()
    const now = Date.now()
    const res = await app.inject({
      method: 'POST',
      url: '/spots',
      headers: auth(user.id),
      body: spotBody({
        startsAt: new Date(now + 4 * 3600_000).toISOString(),
        endsAt: new Date(now + 3600_000).toISOString(),
      }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejeita mais de 5 categorias (400)', async () => {
    const user = await makeUser()
    const res = await app.inject({
      method: 'POST',
      url: '/spots',
      headers: auth(user.id),
      body: spotBody({
        categories: ['PARTY', 'MUSIC', 'SPORTS', 'TECH', 'ART', 'GAMING'],
      }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejeita o 6º spot ativo (409, teto de 5)', async () => {
    const user = await makeUser()
    for (let i = 0; i < 5; i++) await makeSpot(user.id)

    const res = await app.inject({
      method: 'POST',
      url: '/spots',
      headers: auth(user.id),
      body: spotBody(),
    })
    expect(res.statusCode).toBe(409)
  })

  it('spot encerrado não conta no teto', async () => {
    const user = await makeUser()
    const past = Date.now() - 10 * 3600_000
    for (let i = 0; i < 5; i++) {
      await makeSpot(user.id, {
        startsAt: new Date(past),
        endsAt: new Date(past + 3600_000),
      })
    }

    const res = await app.inject({
      method: 'POST',
      url: '/spots',
      headers: auth(user.id),
      body: spotBody(),
    })
    expect(res.statusCode).toBe(201)
  })
})

describe('GET /spots/:id', () => {
  it('retorna spot público com memberCount (200)', async () => {
    const creator = await makeUser()
    const spot = await makeSpot(creator.id)

    const res = await app.inject({ method: 'GET', url: `/spots/${spot.id}` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: spot.id, memberCount: 1 })
  })

  it('retorna 404 para spot inexistente', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/spots/00000000-0000-0000-0000-000000000000',
    })
    expect(res.statusCode).toBe(404)
  })

  it('spot privado: amigo mútuo vê, estranho não (404)', async () => {
    const creator = await makeUser()
    const friend = await makeUser()
    const stranger = await makeUser()
    await makeFriends(creator.id, friend.id)
    const spot = await makeSpot(creator.id, { visibility: 'FRIENDS' })

    const seen = await app.inject({
      method: 'GET',
      url: `/spots/${spot.id}`,
      headers: auth(friend.id),
    })
    expect(seen.statusCode).toBe(200)

    const hidden = await app.inject({
      method: 'GET',
      url: `/spots/${spot.id}`,
      headers: auth(stranger.id),
    })
    expect(hidden.statusCode).toBe(404)
  })

  it('spot privado: follow de um lado só não basta (404)', async () => {
    const creator = await makeUser()
    const oneWay = await makeUser()
    await makeFollow(oneWay.id, creator.id, 'ACCEPTED') // só oneWay -> creator
    const spot = await makeSpot(creator.id, { visibility: 'FRIENDS' })

    const res = await app.inject({
      method: 'GET',
      url: `/spots/${spot.id}`,
      headers: auth(oneWay.id),
    })
    expect(res.statusCode).toBe(404)
  })

  it('bloqueio esconde o spot (404)', async () => {
    const creator = await makeUser()
    const blocked = await makeUser()
    await makeBlock(creator.id, blocked.id)
    const spot = await makeSpot(creator.id)

    const res = await app.inject({
      method: 'GET',
      url: `/spots/${spot.id}`,
      headers: auth(blocked.id),
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('PATCH /spots/:id (editar)', () => {
  it('criador edita título e descrição (200)', async () => {
    const creator = await makeUser()
    const spot = await makeSpot(creator.id)

    const res = await app.inject({
      method: 'PATCH',
      url: `/spots/${spot.id}`,
      headers: auth(creator.id),
      body: { title: 'Novo título', description: 'Nova descrição' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      title: 'Novo título',
      description: 'Nova descrição',
    })
  })

  it('renomear o spot renomeia o chat junto', async () => {
    const creator = await makeUser()
    const spot = await makeSpot(creator.id)

    await app.inject({
      method: 'PATCH',
      url: `/spots/${spot.id}`,
      headers: auth(creator.id),
      body: { title: 'Título sincronizado' },
    })

    const conversation = await testPrisma.conversation.findUnique({
      where: { id: spot.conversationId },
    })
    expect(conversation?.title).toBe('Título sincronizado')
  })

  it('não edita spot cancelado (409)', async () => {
    const creator = await makeUser()
    const spot = await makeSpot(creator.id, { canceledAt: new Date() })

    const res = await app.inject({
      method: 'PATCH',
      url: `/spots/${spot.id}`,
      headers: auth(creator.id),
      body: { title: 'Tentativa' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('retorna 401 sem autenticação', async () => {
    const creator = await makeUser()
    const spot = await makeSpot(creator.id)
    const res = await app.inject({
      method: 'PATCH',
      url: `/spots/${spot.id}`,
      body: { title: 'X title' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('não-criador não edita (403)', async () => {
    const creator = await makeUser()
    const other = await makeUser()
    const spot = await makeSpot(creator.id)

    const res = await app.inject({
      method: 'PATCH',
      url: `/spots/${spot.id}`,
      headers: auth(other.id),
      body: { title: 'Hackeado' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('rejeita body vazio (400)', async () => {
    const creator = await makeUser()
    const spot = await makeSpot(creator.id)

    const res = await app.inject({
      method: 'PATCH',
      url: `/spots/${spot.id}`,
      headers: auth(creator.id),
      body: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('404 para spot inexistente', async () => {
    const creator = await makeUser()
    const res = await app.inject({
      method: 'PATCH',
      url: '/spots/00000000-0000-0000-0000-000000000000',
      headers: auth(creator.id),
      body: { title: 'X title' },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /spots/:id (cancelar)', () => {
  it('criador cancela e o spot sai do mapa (204)', async () => {
    const creator = await makeUser()
    const spot = await makeSpot(creator.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/spots/${spot.id}`,
      headers: auth(creator.id),
    })
    expect(res.statusCode).toBe(204)

    const list = await app.inject({ method: 'GET', url: BBOX })
    expect(list.json().map((s: { id: string }) => s.id)).not.toContain(spot.id)
  })

  it('cancelado bloqueia entrada (409)', async () => {
    const creator = await makeUser()
    const joiner = await makeUser()
    const spot = await makeSpot(creator.id)
    await app.inject({
      method: 'DELETE',
      url: `/spots/${spot.id}`,
      headers: auth(creator.id),
    })

    const join = await app.inject({
      method: 'POST',
      url: `/spots/${spot.id}/members`,
      headers: auth(joiner.id),
    })
    expect(join.statusCode).toBe(409)
  })

  it('retorna 401 sem autenticação', async () => {
    const creator = await makeUser()
    const spot = await makeSpot(creator.id)
    const res = await app.inject({
      method: 'DELETE',
      url: `/spots/${spot.id}`,
    })
    expect(res.statusCode).toBe(401)
  })

  it('não-criador não cancela (403)', async () => {
    const creator = await makeUser()
    const other = await makeUser()
    const spot = await makeSpot(creator.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/spots/${spot.id}`,
      headers: auth(other.id),
    })
    expect(res.statusCode).toBe(403)
  })

  it('cancelar é idempotente (204 duas vezes)', async () => {
    const creator = await makeUser()
    const spot = await makeSpot(creator.id)
    const first = await app.inject({
      method: 'DELETE',
      url: `/spots/${spot.id}`,
      headers: auth(creator.id),
    })
    const again = await app.inject({
      method: 'DELETE',
      url: `/spots/${spot.id}`,
      headers: auth(creator.id),
    })
    expect(first.statusCode).toBe(204)
    expect(again.statusCode).toBe(204)
  })
})

describe('GET /spots (mapa)', () => {
  it('lista spots ativos dentro da bbox', async () => {
    const creator = await makeUser()
    const spot = await makeSpot(creator.id)

    const res = await app.inject({ method: 'GET', url: BBOX })
    expect(res.statusCode).toBe(200)
    const ids = res.json().map((s: { id: string }) => s.id)
    expect(ids).toContain(spot.id)
  })

  it('mostra spot que ainda não começou (upcoming) e permite entrar', async () => {
    const creator = await makeUser()
    const joiner = await makeUser()
    const now = Date.now()
    const upcoming = await makeSpot(creator.id, {
      startsAt: new Date(now + 2 * 3600_000), // começa em 2h
      endsAt: new Date(now + 5 * 3600_000),
    })

    const list = await app.inject({ method: 'GET', url: BBOX })
    const ids = list.json().map((s: { id: string }) => s.id)
    expect(ids).toContain(upcoming.id)

    const join = await app.inject({
      method: 'POST',
      url: `/spots/${upcoming.id}/members`,
      headers: auth(joiner.id),
    })
    expect(join.statusCode).toBe(201)
  })

  it('exclui encerrado, cancelado e fora da bbox', async () => {
    const creator = await makeUser()
    const past = Date.now() - 10 * 3600_000
    const ended = await makeSpot(creator.id, {
      startsAt: new Date(past),
      endsAt: new Date(past + 3600_000),
    })
    const canceled = await makeSpot(creator.id, { canceledAt: new Date() })
    const farAway = await makeSpot(creator.id, {
      latitude: -23.55,
      longitude: -46.63, // São Paulo
    })

    const res = await app.inject({ method: 'GET', url: BBOX })
    const ids = res.json().map((s: { id: string }) => s.id)
    expect(ids).not.toContain(ended.id)
    expect(ids).not.toContain(canceled.id)
    expect(ids).not.toContain(farAway.id)
  })

  it('privado aparece só para amigo mútuo; anônimo vê só público', async () => {
    const creator = await makeUser()
    const friend = await makeUser()
    const stranger = await makeUser()
    await makeFriends(creator.id, friend.id)
    const priv = await makeSpot(creator.id, { visibility: 'FRIENDS' })

    const asFriend = await app.inject({
      method: 'GET',
      url: BBOX,
      headers: auth(friend.id),
    })
    expect(asFriend.json().map((s: { id: string }) => s.id)).toContain(priv.id)

    const asStranger = await app.inject({
      method: 'GET',
      url: BBOX,
      headers: auth(stranger.id),
    })
    expect(asStranger.json().map((s: { id: string }) => s.id)).not.toContain(
      priv.id,
    )

    const anon = await app.inject({ method: 'GET', url: BBOX })
    expect(anon.json().map((s: { id: string }) => s.id)).not.toContain(priv.id)
  })

  it('filtra por interseção de categorias', async () => {
    const creator = await makeUser()
    const music = await makeSpot(creator.id, { categories: ['MUSIC', 'ART'] })
    const sports = await makeSpot(creator.id, { categories: ['SPORTS'] })

    const res = await app.inject({ method: 'GET', url: `${BBOX}&category=ART` })
    const ids = res.json().map((s: { id: string }) => s.id)
    expect(ids).toContain(music.id)
    expect(ids).not.toContain(sports.id)
  })

  it('friendsOnly sem autenticação retorna 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${BBOX}&friendsOnly=true`,
    })
    expect(res.statusCode).toBe(400)
  })

  it('bloqueio esconde o spot do mapa', async () => {
    const creator = await makeUser()
    const blocked = await makeUser()
    await makeBlock(blocked.id, creator.id)
    const spot = await makeSpot(creator.id)

    const res = await app.inject({
      method: 'GET',
      url: BBOX,
      headers: auth(blocked.id),
    })
    expect(res.json().map((s: { id: string }) => s.id)).not.toContain(spot.id)
  })
})

describe('POST /spots/:id/members (entrar)', () => {
  it('entra no chat de spot público e vira participante (201)', async () => {
    const creator = await makeUser()
    const joiner = await makeUser()
    const spot = await makeSpot(creator.id)

    const res = await app.inject({
      method: 'POST',
      url: `/spots/${spot.id}/members`,
      headers: auth(joiner.id),
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().conversationId).toBe(spot.conversationId)

    const participant = await testPrisma.conversationParticipant.findFirst({
      where: {
        conversationId: spot.conversationId,
        userId: joiner.id,
        leftAt: null,
      },
    })
    expect(participant).not.toBeNull()
  })

  it('criador entrar no próprio spot não rebaixa o role (ADMIN preservado)', async () => {
    const creator = await makeUser()
    const spot = await makeSpot(creator.id)

    const res = await app.inject({
      method: 'POST',
      url: `/spots/${spot.id}/members`,
      headers: auth(creator.id),
    })
    expect(res.statusCode).toBe(200)

    const participant = await testPrisma.conversationParticipant.findFirst({
      where: { conversationId: spot.conversationId, userId: creator.id },
    })
    expect(participant?.role).toBe('ADMIN')
  })

  it('é idempotente (entrar duas vezes)', async () => {
    const creator = await makeUser()
    const joiner = await makeUser()
    const spot = await makeSpot(creator.id)

    const first = await app.inject({
      method: 'POST',
      url: `/spots/${spot.id}/members`,
      headers: auth(joiner.id),
    })
    expect(first.statusCode).toBe(201)
    const again = await app.inject({
      method: 'POST',
      url: `/spots/${spot.id}/members`,
      headers: auth(joiner.id),
    })
    expect(again.statusCode).toBe(200) // repetido: já é membro

    const count = await testPrisma.conversationParticipant.count({
      where: { conversationId: spot.conversationId, userId: joiner.id },
    })
    expect(count).toBe(1)
  })

  it('retorna 401 sem autenticação', async () => {
    const creator = await makeUser()
    const spot = await makeSpot(creator.id)
    const res = await app.inject({
      method: 'POST',
      url: `/spots/${spot.id}/members`,
    })
    expect(res.statusCode).toBe(401)
  })

  it('spot privado: amigo mútuo entra, não-amigo é barrado (403)', async () => {
    const creator = await makeUser()
    const friend = await makeUser()
    const stranger = await makeUser()
    await makeFriends(creator.id, friend.id)
    const spot = await makeSpot(creator.id, { visibility: 'FRIENDS' })

    const ok = await app.inject({
      method: 'POST',
      url: `/spots/${spot.id}/members`,
      headers: auth(friend.id),
    })
    expect(ok.statusCode).toBe(201)

    const forbidden = await app.inject({
      method: 'POST',
      url: `/spots/${spot.id}/members`,
      headers: auth(stranger.id),
    })
    expect(forbidden.statusCode).toBe(403)
  })

  it('bloqueio impede entrar (404)', async () => {
    const creator = await makeUser()
    const blocked = await makeUser()
    await makeBlock(creator.id, blocked.id)
    const spot = await makeSpot(creator.id)

    const res = await app.inject({
      method: 'POST',
      url: `/spots/${spot.id}/members`,
      headers: auth(blocked.id),
    })
    expect(res.statusCode).toBe(404)
  })

  it('spot encerrado não aceita entrada (409)', async () => {
    const creator = await makeUser()
    const joiner = await makeUser()
    const past = Date.now() - 10 * 3600_000
    const spot = await makeSpot(creator.id, {
      startsAt: new Date(past),
      endsAt: new Date(past + 3600_000),
    })

    const res = await app.inject({
      method: 'POST',
      url: `/spots/${spot.id}/members`,
      headers: auth(joiner.id),
    })
    expect(res.statusCode).toBe(409)
  })
})
