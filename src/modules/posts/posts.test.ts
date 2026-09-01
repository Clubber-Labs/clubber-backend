import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAX_GALLERY_IMAGES } from '../../lib/uploads'
import { buildApp } from '../../test/app'
import {
  makeEvent,
  makePost,
  makePostReaction,
  makeUser,
} from '../../test/factories'
import { fakeStorage } from '../../test/fake-storage'
import { multipartFormData, tinyPngBuffer } from '../../test/image-fixture'
import { testPrisma } from '../../test/prisma'
import { reorderPostImages } from './posts.repository'

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

describe('POST /events/:eventId/posts', () => {
  it('usuário autenticado cria post em evento público', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id, { isPublic: true })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/posts`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { content: 'Que evento incrível!' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      content: 'Que evento incrível!',
      authorId: user.id,
    })
  })

  it('retorna 403 em evento privado sem convite', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id, { isPublic: false })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/posts`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
      body: { content: 'Tentando postar' },
    })

    expect(res.statusCode).toBe(403)
  })

  it('retorna 401 sem autenticação', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, { isPublic: true })

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/posts`,
      body: { content: 'Sem token' },
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('GET /events/:eventId/posts', () => {
  it('lista posts do evento', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)

    await app.inject({
      method: 'POST',
      url: `/events/${event.id}/posts`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { content: 'Post 1' },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/posts`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      data: expect.any(Array),
      nextCursor: null,
    })
    expect(res.json().data.length).toBeGreaterThan(0)
  })

  it('userLiked reflete a curtida do viewer, não a dos outros', async () => {
    const author = await makeUser()
    const viewer = await makeUser()
    const event = await makeEvent(author.id)
    const curtido = await makePost(author.id, event.id)
    const naoCurtido = await makePost(author.id, event.id)
    await makePostReaction(viewer.id, curtido.id)
    // Curtida de terceiro não vaza pro userLiked do viewer.
    await makePostReaction(author.id, naoCurtido.id)

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/posts`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const byId = new Map(
      res.json().data.map((p: { id: string; userLiked: boolean }) => [p.id, p]),
    )
    expect(byId.get(curtido.id)).toMatchObject({ userLiked: true })
    expect(byId.get(naoCurtido.id)).toMatchObject({ userLiked: false })
  })
})

describe('DELETE /events/:eventId/posts/:postId', () => {
  it('autor deleta o próprio post', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)

    const created = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/posts`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { content: 'Para deletar' },
    })
    const post = created.json()

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/posts/${post.id}`,
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
      url: `/events/${event.id}/posts`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { content: 'Post do autor' },
    })
    const post = created.json()

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/posts/${post.id}`,
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
      url: `/events/${event.id}/posts`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { content: 'Post' },
    })
    const post = created.json()

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${otherEvent.id}/posts/${post.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('visibilidade de posts por status do autor', () => {
  it('esconde posts de autor desativado em GET /events/:eventId/posts', async () => {
    const owner = await makeUser()
    const event = await makeEvent(owner.id)
    const activeAuthor = await makeUser()
    const deactivatedAuthor = await makeUser({ accountStatus: 'DEACTIVATED' })
    await testPrisma.post.create({
      data: {
        authorId: activeAuthor.id,
        eventId: event.id,
        content: 'visível',
      },
    })
    await testPrisma.post.create({
      data: {
        authorId: deactivatedAuthor.id,
        eventId: event.id,
        content: 'oculto',
      },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/posts`,
      headers: { authorization: `Bearer ${token(app, owner.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const authorIds = res
      .json()
      .data.map((p: { authorId: string }) => p.authorId)
    expect(authorIds).toContain(activeAuthor.id)
    expect(authorIds).not.toContain(deactivatedAuthor.id)
  })
})

describe('POST /events/:eventId/posts/:postId/images', () => {
  it('autor sobe imagem e ela aparece na listagem do post', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)
    const png = await tinyPngBuffer()
    const { body, contentType } = multipartFormData(
      png,
      'file',
      'foto.png',
      'image/png',
    )

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/posts/${post.id}/images`,
      headers: {
        authorization: `Bearer ${token(app, author.id)}`,
        'content-type': contentType,
      },
      payload: body,
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ format: 'webp', order: 0 })
    expect(res.json()).not.toHaveProperty('key')
    expect(fakeStorage.uploads[fakeStorage.uploads.length - 1]?.key).toContain(
      `posts/${post.id}/`,
    )

    const list = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/posts`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })
    const created = list
      .json()
      .data.find((p: { id: string }) => p.id === post.id)
    expect(created.images).toHaveLength(1)
    expect(created.images[0]).toMatchObject({ format: 'webp', order: 0 })
  })

  it('retorna 403 quando não é o autor do post', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id, { isPublic: true })
    const post = await makePost(author.id, event.id)
    const png = await tinyPngBuffer()
    const { body, contentType } = multipartFormData(
      png,
      'file',
      'foto.png',
      'image/png',
    )

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/posts/${post.id}/images`,
      headers: {
        authorization: `Bearer ${token(app, other.id)}`,
        'content-type': contentType,
      },
      payload: body,
    })

    expect(res.statusCode).toBe(403)
  })

  it('retorna 400 sem arquivo', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/posts/${post.id}/images`,
      headers: {
        authorization: `Bearer ${token(app, author.id)}`,
        'content-type': 'multipart/form-data; boundary=----X',
      },
      payload: '------X--\r\n',
    })

    expect(res.statusCode).toBe(400)
  })

  it('retorna 404 para post inexistente', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const png = await tinyPngBuffer()
    const { body, contentType } = multipartFormData(
      png,
      'file',
      'foto.png',
      'image/png',
    )

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/posts/00000000-0000-0000-0000-000000000000/images`,
      headers: {
        authorization: `Bearer ${token(app, author.id)}`,
        'content-type': contentType,
      },
      payload: body,
    })

    expect(res.statusCode).toBe(404)
  })

  it('retorna 409 ao exceder o limite de imagens por post', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)
    // Pré-popula o teto direto no banco para não subir N imagens pela rota.
    await testPrisma.postImage.createMany({
      data: Array.from({ length: MAX_GALLERY_IMAGES }, (_, i) => ({
        url: `https://fake.storage/posts/${post.id}/${i}.webp`,
        key: `posts/${post.id}/${i}.webp`,
        format: 'webp',
        size: 100,
        order: i,
        postId: post.id,
      })),
    })
    const png = await tinyPngBuffer()
    const { body, contentType } = multipartFormData(
      png,
      'file',
      'foto.png',
      'image/png',
    )

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/posts/${post.id}/images`,
      headers: {
        authorization: `Bearer ${token(app, author.id)}`,
        'content-type': contentType,
      },
      payload: body,
    })

    expect(res.statusCode).toBe(409)
  })

  it('retorna 401 sem autenticação', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)

    const res = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/posts/${post.id}/images`,
      headers: { 'content-type': 'multipart/form-data; boundary=----X' },
      payload: '------X--\r\n',
    })

    expect(res.statusCode).toBe(401)
  })

  it('retorna 429 ao exceder o rate limit de upload de imagens', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)
    // remoteAddress exclusivo isola o contador de rate-limit (keyGenerator = req.ip)
    // de qualquer outra chamada que use o IP default no setup.
    const remoteAddress = '203.0.113.24'
    const authorization = `Bearer ${token(app, author.id)}`

    for (let i = 0; i < 20; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/events/${event.id}/posts/${post.id}/images`,
        headers: {
          authorization,
          'content-type': 'multipart/form-data; boundary=----X',
        },
        payload: '------X--\r\n',
        remoteAddress,
      })

      expect(res.statusCode).not.toBe(429)
    }

    const blocked = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/posts/${post.id}/images`,
      headers: {
        authorization,
        'content-type': 'multipart/form-data; boundary=----X',
      },
      payload: '------X--\r\n',
      remoteAddress,
    })

    expect(blocked.statusCode).toBe(429)
  })
})

// O #228 deu ao evento remover e reordenar; a galeria de post ficou só com
// upload — foto errada no post virava post apagado e refeito.
describe('DELETE /events/:eventId/posts/:postId/images/:imageId', () => {
  async function seedImage(postId: string, order = 0) {
    return testPrisma.postImage.create({
      data: {
        postId,
        url: `https://cdn.test/${postId}-${order}.webp`,
        key: `posts/${postId}/${order}`,
        format: 'webp',
        size: 1024,
        order,
      },
    })
  }

  it('o autor remove uma imagem e o blob sai do storage', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)
    const image = await seedImage(post.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/posts/${post.id}/images/${image.id}`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(204)
    expect(
      await testPrisma.postImage.count({ where: { postId: post.id } }),
    ).toBe(0)
    expect(fakeStorage.deleted).toContain(image.key)
  })

  it('retorna 403 para quem não é o autor do post', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)
    const image = await seedImage(post.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/posts/${post.id}/images/${image.id}`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
    })

    expect(res.statusCode).toBe(403)
    expect(
      await testPrisma.postImage.count({ where: { postId: post.id } }),
    ).toBe(1)
  })

  // Imagem de outro post não pode ser removida pela rota deste — o par
  // (post, imagem) é o que autoriza, não a imagem sozinha.
  it('retorna 404 para imagem de outro post', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)
    const outro = await makePost(author.id, event.id)
    const image = await seedImage(outro.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/posts/${post.id}/images/${image.id}`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('POST_IMAGE_NOT_FOUND')
  })

  it('retorna 401 sem autenticação', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)
    const image = await seedImage(post.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/posts/${post.id}/images/${image.id}`,
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('PATCH /events/:eventId/posts/:postId/images', () => {
  async function seedImages(postId: string, count: number) {
    const images = []
    for (let i = 0; i < count; i++) {
      images.push(
        await testPrisma.postImage.create({
          data: {
            postId,
            url: `https://cdn.test/${postId}-${i}.webp`,
            key: `posts/${postId}/${i}`,
            format: 'webp',
            size: 1024,
            order: i,
          },
        }),
      )
    }
    return images
  }

  it('reordena a galeria e devolve na ordem nova', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)
    const [a, b, c] = await seedImages(post.id, 3)

    const res = await app.inject({
      method: 'PATCH',
      url: `/events/${event.id}/posts/${post.id}/images`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { order: [c.id, a.id, b.id] },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().map((i: { id: string }) => i.id)).toEqual([
      c.id,
      a.id,
      b.id,
    ])
  })

  it('a nova ordem persiste na listagem de posts', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)
    const [a, b] = await seedImages(post.id, 2)

    await app.inject({
      method: 'PATCH',
      url: `/events/${event.id}/posts/${post.id}/images`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { order: [b.id, a.id] },
    })

    const list = await app.inject({
      method: 'GET',
      url: `/events/${event.id}/posts`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
    })

    const found = list.json().data.find((p: { id: string }) => p.id === post.id)
    expect(found.images.map((i: { id: string }) => i.id)).toEqual([b.id, a.id])
  })

  // Lista que não é rearranjo EXATO deixaria imagem sem posição definida, ou
  // reposicionaria a de outro post.
  it('rejeita ordem incompleta', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)
    const [a] = await seedImages(post.id, 3)

    const res = await app.inject({
      method: 'PATCH',
      url: `/events/${event.id}/posts/${post.id}/images`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { order: [a.id] },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('IMAGE_ORDER_MISMATCH')
  })

  it('rejeita ordem com id repetido', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)
    const [a, b] = await seedImages(post.id, 2)

    const res = await app.inject({
      method: 'PATCH',
      url: `/events/${event.id}/posts/${post.id}/images`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { order: [a.id, a.id] },
    })

    expect(res.statusCode).toBe(400)
    expect(b.id).toBeTruthy()
  })

  it('rejeita ordem com imagem de outro post', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)
    const outro = await makePost(author.id, event.id)
    const [mine] = await seedImages(post.id, 1)
    const [alheia] = await seedImages(outro.id, 1)

    const res = await app.inject({
      method: 'PATCH',
      url: `/events/${event.id}/posts/${post.id}/images`,
      headers: { authorization: `Bearer ${token(app, author.id)}` },
      body: { order: [mine.id, alheia.id] },
    })

    expect(res.statusCode).toBe(400)
    // A imagem alheia não pode ter sido reposicionada.
    const after = await testPrisma.postImage.findUnique({
      where: { id: alheia.id },
    })
    expect(after?.order).toBe(0)
  })

  it('retorna 403 para quem não é o autor do post', async () => {
    const author = await makeUser()
    const other = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)
    const [a, b] = await seedImages(post.id, 2)

    const res = await app.inject({
      method: 'PATCH',
      url: `/events/${event.id}/posts/${post.id}/images`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
      body: { order: [b.id, a.id] },
    })

    expect(res.statusCode).toBe(403)
  })
})

// A validação do service é a primeira linha de defesa; esta é a segunda, no
// próprio SQL. Testada direto no repositório porque é justamente a garantia que
// vale QUANDO a checagem de cima não pegou.
describe('reorderPostImages (repositório)', () => {
  it('não reposiciona imagem de outro post nem estoura com id sumido', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id)
    const post = await makePost(author.id, event.id)
    const outro = await makePost(author.id, event.id)

    const mine = await testPrisma.postImage.create({
      data: {
        postId: post.id,
        url: 'https://cdn.test/a.webp',
        key: `posts/${post.id}/a`,
        format: 'webp',
        size: 1024,
        order: 0,
      },
    })
    const alheia = await testPrisma.postImage.create({
      data: {
        postId: outro.id,
        url: 'https://cdn.test/b.webp',
        key: `posts/${outro.id}/b`,
        format: 'webp',
        size: 1024,
        order: 0,
      },
    })
    const sumida = '00000000-0000-4000-8000-000000000000'

    await expect(
      reorderPostImages(post.id, [alheia.id, sumida, mine.id]),
    ).resolves.toBeDefined()

    // A alheia continua no lugar dela, apesar de ter vindo na posição 0.
    const after = await testPrisma.postImage.findUnique({
      where: { id: alheia.id },
    })
    expect(after?.order).toBe(0)
  })
})
