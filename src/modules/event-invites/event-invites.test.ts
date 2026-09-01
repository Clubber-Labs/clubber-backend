import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeEvent,
  makeFollow,
  makeInvite,
  makeUser,
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

describe('POST /events/:eventId/invites', () => {
  it('autor convida usuários específicos', async () => {
    const author = await makeUser()
    const guest1 = await makeUser()
    const guest2 = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { userIds: [guest1.id, guest2.id] },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ invited: 2 })
  })

  it('convida todos os seguidores quando body é omitido', async () => {
    const author = await makeUser()
    const follower1 = await makeUser()
    const follower2 = await makeUser()
    await makeFollow(follower1.id, author.id)
    await makeFollow(follower2.id, author.id)
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: {},
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ invited: 2 })
  })

  it('convida só os selecionados quando o app manda invitedIds', async () => {
    const author = await makeUser()
    const follower1 = await makeUser()
    const follower2 = await makeUser()
    const guest = await makeUser()
    await makeFollow(follower1.id, author.id)
    await makeFollow(follower2.id, author.id)
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { invitedIds: [guest.id] },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ invited: 1 })
    const invited = await testPrisma.eventInvite.findMany({
      where: { eventId: event.id },
      select: { invitedId: true },
    })
    expect(invited.map((i) => i.invitedId)).toEqual([guest.id])
  })

  it('convida todos os seguidores com all: true', async () => {
    const author = await makeUser()
    const follower1 = await makeUser()
    const follower2 = await makeUser()
    await makeFollow(follower1.id, author.id)
    await makeFollow(follower2.id, author.id)
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { all: true },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ invited: 2 })
  })

  it('rejeita chave desconhecida em vez de cair no fan-out de seguidores', async () => {
    const author = await makeUser()
    const follower = await makeUser()
    const guest = await makeUser()
    await makeFollow(follower.id, author.id)
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { invitedUserIds: [guest.id] },
    })

    expect(res.statusCode).toBe(400)
    expect(
      await testPrisma.eventInvite.count({ where: { eventId: event.id } }),
    ).toBe(0)
  })

  it('rejeita all: true junto com ids selecionados', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { all: true, userIds: [guest.id] },
    })

    expect(res.statusCode).toBe(400)
  })

  it('rejeita userIds e invitedIds no mesmo corpo', async () => {
    const author = await makeUser()
    const guest1 = await makeUser()
    const guest2 = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { userIds: [guest1.id], invitedIds: [guest2.id] },
    })

    expect(res.statusCode).toBe(400)
  })

  it('retorna 403 se não for o autor', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
      body: { userIds: [other.id] },
    })

    expect(res.statusCode).toBe(403)
  })

  // Em evento público o convite é divulgação: não concede nada (acesso todo
  // mundo já tem), mas notifica e lista o convidado como nos privados.
  it('convida em evento público (divulgação)', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, { isPublic: true })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { userIds: [guest.id] },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ invited: 1 })

    const notification = await testPrisma.notification.findFirst({
      where: { userId: guest.id, type: 'EVENT_INVITE' },
    })
    expect(notification).not.toBeNull()
  })

  it('não-autor convida em evento público', async () => {
    const author = await makeUser()
    const promoter = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, { isPublic: true })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, promoter.id)}` },
      body: { userIds: [guest.id] },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ invited: 1 })

    const invite = await testPrisma.eventInvite.findUnique({
      where: { eventId_invitedId: { eventId: event.id, invitedId: guest.id } },
    })
    expect(invite?.inviterId).toBe(promoter.id)
  })

  it('não-autor segue proibido em evento privado', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
      body: { userIds: [guest.id] },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('NOT_EVENT_AUTHOR')
  })

  it('público: perfil privado sem follow mútuo é filtrado em silêncio', async () => {
    const author = await makeUser()
    const promoter = await makeUser()
    const openGuest = await makeUser()
    const privateGuest = await makeUser({ isPrivate: true })
    // só uma direção: promoter segue o privado, sem reciprocidade
    await makeFollow(promoter.id, privateGuest.id, 'ACCEPTED')
    const event = await makeEvent(author.id, { isPublic: true })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, promoter.id)}` },
      body: { userIds: [openGuest.id, privateGuest.id] },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ invited: 1 })

    const invites = await testPrisma.eventInvite.findMany({
      where: { eventId: event.id },
    })
    expect(invites.map((i) => i.invitedId)).toEqual([openGuest.id])

    const notif = await testPrisma.notification.findFirst({
      where: { userId: privateGuest.id, type: 'EVENT_INVITE' },
    })
    expect(notif).toBeNull()
  })

  it('público: perfil privado com follow mútuo pode ser convidado', async () => {
    const author = await makeUser()
    const promoter = await makeUser()
    const mutualGuest = await makeUser({ isPrivate: true })
    await makeFollow(promoter.id, mutualGuest.id, 'ACCEPTED')
    await makeFollow(mutualGuest.id, promoter.id, 'ACCEPTED')
    const event = await makeEvent(author.id, { isPublic: true })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, promoter.id)}` },
      body: { userIds: [mutualGuest.id] },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ invited: 1 })
  })

  it('público: nenhum alvo elegível → 400 NO_USERS_TO_INVITE', async () => {
    const author = await makeUser()
    const promoter = await makeUser()
    const privateGuest = await makeUser({ isPrivate: true })
    const event = await makeEvent(author.id, { isPublic: true })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, promoter.id)}` },
      // privado sem mútuo + o próprio convidador: ambos caem no filtro
      body: { userIds: [privateGuest.id, promoter.id] },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('NO_USERS_TO_INVITE')
  })

  it('retorna 400 para evento cancelado', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, {
      isPublic: true,
      canceledAt: new Date(),
    })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { userIds: [guest.id] },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('EVENT_CANCELED')
  })

  it('retorna 400 para evento já encerrado', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, {
      isPublic: false,
      date: new Date(Date.now() - 2 * 86400000),
      endDate: new Date(Date.now() - 86400000),
    })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { userIds: [guest.id] },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('EVENT_ENDED')
  })

  it('segundo convidador não re-notifica quem já foi convidado', async () => {
    const author = await makeUser()
    const promoterA = await makeUser()
    const promoterB = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, { isPublic: true })

    const first = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, promoterA.id)}` },
      body: { userIds: [guest.id] },
    })
    const second = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, promoterB.id)}` },
      body: { userIds: [guest.id] },
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    expect(second.json()).toMatchObject({ invited: 0 })

    // sem o filtro de já-convidados, o push do convidador B duplicaria a
    // notificação (actor diferente fura o dedupe)
    const notifications = await testPrisma.notification.count({
      where: { userId: guest.id, type: 'EVENT_INVITE' },
    })
    expect(notifications).toBe(1)
  })

  it('ignora duplicatas (skipDuplicates)', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { userIds: [guest.id] },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { userIds: [guest.id] },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ invited: 0 })
  })
})

describe('GET /events/:eventId/invites', () => {
  it('autor lista os convidados', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    await app.inject({
      method: 'POST',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { userIds: [guest.id] },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveLength(1)
    // Contrato consumido pelo app (usuário ANINHADO em `invited` — o mobile
    // achata na fronteira dele; mudar este shape quebra clients via OTA).
    expect(body[0]).toMatchObject({
      eventId: event.id,
      inviterId: author.id,
      invitedId: guest.id,
      invited: {
        id: guest.id,
        name: guest.name,
        lastname: guest.lastname,
        username: guest.username,
      },
    })
    expect(typeof body[0].createdAt).toBe('string')
  })

  it('retorna 403 para não-autor', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('visibilidade de contas inativas em convites', () => {
  it('GET /events/:eventId/invites não inclui convidados inativos', async () => {
    const author = await makeUser()
    const activeGuest = await makeUser()
    const inactiveGuest = await makeUser({ accountStatus: 'DEACTIVATED' })
    const event = await makeEvent(author.id, { isPublic: false })
    await makeInvite(event.id, author.id, activeGuest.id)
    await makeInvite(event.id, author.id, inactiveGuest.id)

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/invites`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const ids = res.json().map((i: { invitedId: string }) => i.invitedId)
    expect(ids).toEqual([activeGuest.id])
  })
})

// O card "Fulano te convidou" existe inteiro no app desde sempre, com copy nos
// três idiomas, mas o backend nunca devolvia o campo que o liga.
describe('viewerInvite em GET /events/:id', () => {
  it('devolve quem convidou o viewer e quando', async () => {
    const author = await makeUser()
    const guest = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })
    await makeInvite(event.id, author.id, guest.id)

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}`,
      headers: { authorization: `Bearer ${token(app, guest.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().viewerInvite).toMatchObject({
      inviter: { id: author.id, username: author.username },
      othersCount: 0,
    })
    expect(res.json().viewerInvite.createdAt).toBeTruthy()
  })

  it('omite o campo para quem não foi convidado', async () => {
    const author = await makeUser()
    const passerby = await makeUser()
    const event = await makeEvent(author.id, { isPublic: true })

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}`,
      headers: { authorization: `Bearer ${token(app, passerby.id)}` },
    })

    expect(res.json()).not.toHaveProperty('viewerInvite')
  })

  it('omite o campo para anônimo', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, { isPublic: true })

    const res = await app.inject({ method: 'GET', url: `/events/${event.id}` })

    expect(res.json()).not.toHaveProperty('viewerInvite')
  })

  // `others` nomeia só quem o viewer já segue; `othersCount` conta todos os
  // outros convidados. É a prova social "junto com Lia e mais 2" sem revelar
  // quem são os estranhos da lista.
  it('nomeia só os amigos entre os co-convidados, mas conta todos', async () => {
    const author = await makeUser()
    const viewer = await makeUser()
    const friend = await makeUser()
    const stranger1 = await makeUser()
    const stranger2 = await makeUser()
    await makeFollow(viewer.id, friend.id)
    const event = await makeEvent(author.id, { isPublic: false })
    for (const u of [viewer, friend, stranger1, stranger2]) {
      await makeInvite(event.id, author.id, u.id)
    }

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    const invite = res.json().viewerInvite
    expect(invite.othersCount).toBe(3)
    expect(invite.others).toHaveLength(1)
    expect(invite.others[0].id).toBe(friend.id)
  })

  it('sem amigos entre os convidados, others vem vazio e a contagem fica', async () => {
    const author = await makeUser()
    const viewer = await makeUser()
    const stranger = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })
    await makeInvite(event.id, author.id, viewer.id)
    await makeInvite(event.id, author.id, stranger.id)

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.json().viewerInvite).toMatchObject({
      others: [],
      othersCount: 1,
    })
  })

  it('o próprio viewer não entra na contagem de outros', async () => {
    const author = await makeUser()
    const viewer = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })
    await makeInvite(event.id, author.id, viewer.id)

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.json().viewerInvite.othersCount).toBe(0)
  })

  // Mesma régua do GET /events/:eventId/invites, que já filtra invited inativo.
  it('não conta co-convidado com conta desativada', async () => {
    const author = await makeUser()
    const viewer = await makeUser()
    const gone = await makeUser({ accountStatus: 'DEACTIVATED' })
    const event = await makeEvent(author.id, { isPublic: false })
    await makeInvite(event.id, author.id, viewer.id)
    await makeInvite(event.id, author.id, gone.id)

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.json().viewerInvite.othersCount).toBe(0)
  })

  // Card com fantasma é pior que card ausente: sem convidador exibível, o app
  // cai no RSVP solto.
  it('omite o campo quando quem convidou desativou a conta', async () => {
    const author = await makeUser()
    const promoter = await makeUser({ accountStatus: 'DEACTIVATED' })
    const viewer = await makeUser()
    const event = await makeEvent(author.id, { isPublic: true })
    await makeInvite(event.id, promoter.id, viewer.id)

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.json()).not.toHaveProperty('viewerInvite')
  })
})
