import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeAttendance,
  makeComment,
  makeEvent,
  makeUser,
} from '../../test/factories'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance

function token(app: FastifyInstance, userId: string) {
  return app.jwt.sign({ sub: userId })
}

async function makePost(app: FastifyInstance, userId: string, eventId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/events/${eventId}/posts`,
    headers: { authorization: `Bearer ${token(app, userId)}` },
    body: { content: 'Post base' },
  })
  return res.json()
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('POST /events/:eventId/comments', () => {
  it('comenta em evento', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/comments`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { content: 'Que evento!' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      content: 'Que evento!',
      eventId: event.id,
    })
  })

  it('retorna 403 em evento privado sem acesso', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/comments`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
      body: { content: 'Comentário proibido' },
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('GET /events/:eventId/comments', () => {
  it('lista comentários com paginação', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)

    await app.inject({
      method: 'POST',
      url: `/events/${event.id}/comments`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { content: 'Comentário 1' },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/comments`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      data: expect.any(Array),
      nextCursor: null,
    })
  })

  it('reflete a reação do viewer em userLiked após reagir (read-after-write)', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)

    const created = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/comments`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { content: 'Comentário curtível' },
    })
    const commentId = created.json().id

    // antes de reagir: não curtido
    const before = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/comments`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })
    const commentBefore = before
      .json()
      .data.find((c: { id: string }) => c.id === commentId)
    expect(commentBefore.userLiked).toBe(false)
    expect(commentBefore.reactionsCount).toBe(0)

    const reacted = await app.inject({
      method: 'POST',
      url: `/comments/${commentId}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })
    expect(reacted.statusCode).toBe(201)

    // depois de reagir: o GET reflete userLiked=true e reactionsCount=1
    const after = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/comments`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })
    const commentAfter = after
      .json()
      .data.find((c: { id: string }) => c.id === commentId)
    expect(commentAfter.userLiked).toBe(true)
    expect(commentAfter.reactionsCount).toBe(1)
  })

  it('userLiked é por viewer: outro usuário não vê a reação como sua', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id)

    const created = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/comments`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { content: 'Comentário' },
    })
    const commentId = created.json().id

    await app.inject({
      method: 'POST',
      url: `/comments/${commentId}/reactions`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    // other vê reactionsCount=1, mas userLiked=false (não reagiu)
    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/comments`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
    })
    const comment = res
      .json()
      .data.find((c: { id: string }) => c.id === commentId)
    expect(comment.reactionsCount).toBe(1)
    expect(comment.userLiked).toBe(false)
  })
})

describe('DELETE /events/:eventId/comments/:commentId', () => {
  it('autor deleta o próprio comentário', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)

    const created = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/comments`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { content: 'Para deletar' },
    })
    const comment = created.json()

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/comments/${comment.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(204)
  })

  it('retorna 403 se não for o autor', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id)

    const created = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/comments`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { content: 'Comentário do autor' },
    })
    const comment = created.json()

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/comments/${comment.id}`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
    })

    expect(res.statusCode).toBe(403)
  })

  it('retorna 404 com eventId errado', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)
    const otherEvent = await makeEvent(user.id)

    const created = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/comments`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { content: 'Comentário' },
    })
    const comment = created.json()

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${otherEvent.id}/comments/${comment.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('POST /posts/:postId/comments', () => {
  it('comenta em post', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)
    await makeAttendance(user.id, event.id, 'CONFIRMED')
    const post = await makePost(app, user.id, event.id)

    const res = await app.inject({
      method: 'POST',
      url: `/posts/${post.id}/comments`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { content: 'Comentário no post' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      content: 'Comentário no post',
      postId: post.id,
    })
  })
})

describe('DELETE /posts/:postId/comments/:commentId', () => {
  it('autor deleta comentário no post', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)
    await makeAttendance(user.id, event.id, 'CONFIRMED')
    const post = await makePost(app, user.id, event.id)

    const created = await app.inject({
      method: 'POST',
      url: `/posts/${post.id}/comments`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { content: 'Para deletar' },
    })
    const comment = created.json()

    const res = await app.inject({
      method: 'DELETE',
      url: `/posts/${post.id}/comments/${comment.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(204)
  })
})

describe('GET /posts/:postId/comments', () => {
  it('reflete a reação do viewer em userLiked após reagir (read-after-write)', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)
    await makeAttendance(user.id, event.id, 'CONFIRMED')
    const post = await makePost(app, user.id, event.id)

    const created = await app.inject({
      method: 'POST',
      url: `/posts/${post.id}/comments`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { content: 'Comentário curtível' },
    })
    const commentId = created.json().id

    await app.inject({
      method: 'POST',
      url: `/comments/${commentId}/reactions`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/posts/${post.id}/comments`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })
    const comment = res
      .json()
      .data.find((c: { id: string }) => c.id === commentId)
    expect(comment.userLiked).toBe(true)
    expect(comment.reactionsCount).toBe(1)
  })
})

describe('visibilidade de comentários por status do autor', () => {
  it('esconde comentário de autor desativado e mantém o de anonimizado como "Usuário Excluído"', async () => {
    const owner = await makeUser()
    const event = await makeEvent(owner.id)
    const activeAuthor = await makeUser()
    const deactivatedAuthor = await makeUser({ accountStatus: 'DEACTIVATED' })
    const anonymizedAuthor = await makeUser({
      name: 'Usuário',
      lastname: 'Excluído',
      accountStatus: 'ANONYMIZED',
      anonymizedAt: new Date(),
    })
    await makeComment(activeAuthor.id, event.id, 'comentário ativo')
    await makeComment(deactivatedAuthor.id, event.id, 'comentário oculto')
    await makeComment(anonymizedAuthor.id, event.id, 'comentário anonimizado')

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/comments`,
      headers: { authorization: `Bearer ${token(app, owner.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const authorIds = res
      .json()
      .data.map((c: { authorId: string }) => c.authorId)
    expect(authorIds).toContain(activeAuthor.id)
    expect(authorIds).toContain(anonymizedAuthor.id)
    expect(authorIds).not.toContain(deactivatedAuthor.id)

    const anon = res
      .json()
      .data.find(
        (c: { authorId: string }) => c.authorId === anonymizedAuthor.id,
      )
    expect(anon.author).toMatchObject({ name: 'Usuário', lastname: 'Excluído' })
  })
})
