import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeAttendance,
  makeBlock,
  makeCheckIn,
  makeEvent,
  makeFollow,
  makeInvite,
  makeUser,
  makeUserPhoto,
} from '../../test/factories'
import { fakeStorage } from '../../test/fake-storage'
import {
  type MultipartPart,
  multipartBody,
  tinyPngBuffer,
} from '../../test/image-fixture'
import { testPrisma } from '../../test/prisma'
import { reconcileAccountDeletions } from '../users/account-deletion.reconciler'
import { MAX_USER_PHOTO_IMAGES } from './user-photos.schema'

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

async function photoParts(
  count: number,
  fields: Record<string, string> = {},
): Promise<MultipartPart[]> {
  const png = await tinyPngBuffer()
  return [
    ...Object.entries(fields).map(([name, value]) => ({ name, value })),
    ...Array.from({ length: count }, (_, i) => ({
      name: 'images',
      filename: `foto-${i}.png`,
      mimetype: 'image/png',
      buffer: png,
    })),
  ]
}

function publish(userId: string, parts: MultipartPart[]) {
  const { body, contentType } = multipartBody(parts)
  return app.inject({
    method: 'POST',
    url: '/users/me/photos',
    headers: {
      authorization: `Bearer ${token(app, userId)}`,
      'content-type': contentType,
    },
    payload: body,
  })
}

function listPhotos(ownerId: string, viewerId?: string, query = '') {
  return app.inject({
    method: 'GET',
    url: `/users/${ownerId}/photos${query}`,
    ...(viewerId && {
      headers: { authorization: `Bearer ${token(app, viewerId)}` },
    }),
  })
}

describe('POST /users/me/photos', () => {
  it('publica no mural com várias imagens, legenda e evento com presença confirmada', async () => {
    const user = await makeUser()
    const host = await makeUser()
    const event = await makeEvent(host.id, { title: 'Baile do Sábado' })
    await makeAttendance(user.id, event.id, 'CONFIRMED')

    const res = await publish(
      user.id,
      await photoParts(3, { caption: 'Noite boa', eventId: event.id }),
    )

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body).toMatchObject({
      caption: 'Noite boa',
      event: { id: event.id, title: 'Baile do Sábado' },
    })
    expect(body.images).toHaveLength(3)
    expect(body.images.map((i: { order: number }) => i.order)).toEqual([
      0, 1, 2,
    ])
    for (const image of body.images) {
      expect(image.url).toMatch(/^https:\/\/fake\.storage\//)
      expect(image.width).toBeGreaterThan(0)
      expect(image.height).toBeGreaterThan(0)
      expect(image).not.toHaveProperty('key')
    }

    expect(fakeStorage.uploads).toHaveLength(3)
    for (const upload of fakeStorage.uploads) {
      expect(upload.key).toContain(`users/${user.id}/photos/${body.id}/`)
    }
    expect(
      await testPrisma.userPhotoImage.count({ where: { photoId: body.id } }),
    ).toBe(3)
  })

  it('publica sem legenda nem evento', async () => {
    const user = await makeUser()

    const res = await publish(user.id, await photoParts(1))

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ caption: null, event: null })
    expect(res.json().images).toHaveLength(1)
  })

  it('trata legenda e evento em branco como ausentes', async () => {
    const user = await makeUser()

    const res = await publish(
      user.id,
      await photoParts(1, { caption: '   ', eventId: '' }),
    )

    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ caption: null, event: null })
  })

  it('aceita os campos de texto depois dos arquivos', async () => {
    const user = await makeUser()
    const png = await tinyPngBuffer()

    const res = await publish(user.id, [
      { name: 'images', filename: 'a.png', mimetype: 'image/png', buffer: png },
      { name: 'caption', value: 'depois do arquivo' },
    ])

    expect(res.statusCode).toBe(201)
    expect(res.json().caption).toBe('depois do arquivo')
  })

  it('retorna 400 IMAGE_REQUIRED sem nenhum arquivo', async () => {
    const user = await makeUser()

    const res = await publish(user.id, [{ name: 'caption', value: 'só texto' }])

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('IMAGE_REQUIRED')
    expect(await testPrisma.userPhoto.count()).toBe(0)
  })

  it('retorna 400 USER_PHOTO_IMAGE_LIMIT acima do teto e não sobe nenhum blob', async () => {
    const user = await makeUser()

    const res = await publish(
      user.id,
      await photoParts(MAX_USER_PHOTO_IMAGES + 1),
    )

    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({
      code: 'USER_PHOTO_IMAGE_LIMIT',
      params: { max: MAX_USER_PHOTO_IMAGES },
    })
    expect(fakeStorage.uploads).toHaveLength(0)
    expect(await testPrisma.userPhoto.count()).toBe(0)
  })

  it('aceita exatamente o teto de imagens', async () => {
    const user = await makeUser()

    const res = await publish(user.id, await photoParts(MAX_USER_PHOTO_IMAGES))

    expect(res.statusCode).toBe(201)
    expect(res.json().images).toHaveLength(MAX_USER_PHOTO_IMAGES)
  })

  it('retorna 400 UNSUPPORTED_IMAGE_FORMAT para gif e não sobe nenhum blob', async () => {
    const user = await makeUser()
    const png = await tinyPngBuffer()

    const res = await publish(user.id, [
      { name: 'images', filename: 'a.png', mimetype: 'image/png', buffer: png },
      { name: 'images', filename: 'b.gif', mimetype: 'image/gif', buffer: png },
    ])

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('UNSUPPORTED_IMAGE_FORMAT')
    expect(fakeStorage.uploads).toHaveLength(0)
  })

  it('retorna 400 INVALID_IMAGE para arquivo que não é imagem', async () => {
    const user = await makeUser()

    const res = await publish(user.id, [
      {
        name: 'images',
        filename: 'a.png',
        mimetype: 'image/png',
        buffer: Buffer.from('isto não é uma imagem'),
      },
    ])

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('INVALID_IMAGE')
    expect(fakeStorage.uploads).toHaveLength(0)
  })

  it('retorna 400 VALIDATION_ERROR com legenda acima do limite e não sobe nenhum blob', async () => {
    const user = await makeUser()

    const res = await publish(
      user.id,
      await photoParts(1, { caption: 'x'.repeat(301) }),
    )

    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      field: 'caption',
    })
    expect(fakeStorage.uploads).toHaveLength(0)
  })

  it('retorna 404 EVENT_NOT_FOUND para evento inexistente e não sobe nenhum blob', async () => {
    const user = await makeUser()

    const res = await publish(
      user.id,
      await photoParts(1, {
        eventId: '00000000-0000-4000-8000-000000000000',
      }),
    )

    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('EVENT_NOT_FOUND')
    expect(fakeStorage.uploads).toHaveLength(0)
  })

  it('retorna 400 EVENT_NOT_ATTENDED sem presença (INTERESTED não basta)', async () => {
    const user = await makeUser()
    const host = await makeUser()
    const event = await makeEvent(host.id)
    await makeAttendance(user.id, event.id, 'INTERESTED')

    const res = await publish(
      user.id,
      await photoParts(1, { eventId: event.id }),
    )

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('EVENT_NOT_ATTENDED')
    expect(fakeStorage.uploads).toHaveLength(0)
    expect(await testPrisma.userPhoto.count()).toBe(0)
  })

  it('aceita vincular evento de que é autor', async () => {
    const user = await makeUser()
    const event = await makeEvent(user.id)

    const res = await publish(
      user.id,
      await photoParts(1, { eventId: event.id }),
    )

    expect(res.statusCode).toBe(201)
    expect(res.json().event).toMatchObject({ id: event.id })
  })

  it('aceita vincular evento em que fez check-in', async () => {
    const user = await makeUser()
    const host = await makeUser()
    const event = await makeEvent(host.id)
    await makeCheckIn(user.id, event.id)

    const res = await publish(
      user.id,
      await photoParts(1, { eventId: event.id }),
    )

    expect(res.statusCode).toBe(201)
    expect(res.json().event).toMatchObject({ id: event.id })
  })

  it('retorna 401 sem autenticação', async () => {
    const { body, contentType } = multipartBody(await photoParts(1))

    const res = await app.inject({
      method: 'POST',
      url: '/users/me/photos',
      headers: { 'content-type': contentType },
      payload: body,
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('GET /users/:id/photos', () => {
  it('lista do mais recente para o mais antigo, paginado por cursor', async () => {
    const owner = await makeUser()
    const viewer = await makeUser()
    const first = await makeUserPhoto(owner.id, {
      createdAt: new Date('2026-01-01T10:00:00Z'),
    })
    const second = await makeUserPhoto(owner.id, {
      createdAt: new Date('2026-01-02T10:00:00Z'),
    })
    const third = await makeUserPhoto(owner.id, {
      createdAt: new Date('2026-01-03T10:00:00Z'),
    })

    const page1 = await listPhotos(owner.id, viewer.id, '?limit=2')
    expect(page1.statusCode).toBe(200)
    expect(page1.json().data.map((p: { id: string }) => p.id)).toEqual([
      third.id,
      second.id,
    ])
    expect(page1.json().nextCursor).toBe(second.id)

    const page2 = await listPhotos(
      owner.id,
      viewer.id,
      `?limit=2&cursor=${second.id}`,
    )
    expect(page2.json().data.map((p: { id: string }) => p.id)).toEqual([
      first.id,
    ])
    expect(page2.json().nextCursor).toBeNull()
  })

  it('devolve as imagens em ordem, com dimensões e sem key', async () => {
    const owner = await makeUser()
    await makeUserPhoto(owner.id, { imagesCount: 3, caption: 'trio' })

    const res = await listPhotos(owner.id, owner.id)

    expect(res.statusCode).toBe(200)
    const [entry] = res.json().data
    expect(entry.caption).toBe('trio')
    expect(entry.images.map((i: { order: number }) => i.order)).toEqual([
      0, 1, 2,
    ])
    expect(entry.images[0]).toMatchObject({
      format: 'webp',
      size: 1024,
      width: 1080,
      height: 1350,
    })
    expect(entry.images[0]).not.toHaveProperty('key')
  })

  it('anônimo vê o mural de perfil público', async () => {
    const owner = await makeUser()
    await makeUserPhoto(owner.id)

    const res = await listPhotos(owner.id)

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  it('mostra o evento vinculado quando é público', async () => {
    const owner = await makeUser()
    const viewer = await makeUser()
    const event = await makeEvent(owner.id, { title: 'Sunset' })
    await makeUserPhoto(owner.id, { eventId: event.id })

    const res = await listPhotos(owner.id, viewer.id)

    expect(res.json().data[0].event).toEqual({ id: event.id, title: 'Sunset' })
  })

  it('oculta evento privado de quem não tem acesso e mostra para convidado e dono', async () => {
    const host = await makeUser()
    const owner = await makeUser()
    const guest = await makeUser()
    const stranger = await makeUser()
    const event = await makeEvent(host.id, {
      isPublic: false,
      title: 'Só chegados',
    })
    await makeInvite(event.id, host.id, owner.id)
    await makeInvite(event.id, host.id, guest.id)
    await makeUserPhoto(owner.id, { eventId: event.id })

    const asStranger = await listPhotos(owner.id, stranger.id)
    expect(asStranger.statusCode).toBe(200)
    expect(asStranger.json().data[0].event).toBeNull()

    const asAnonymous = await listPhotos(owner.id)
    expect(asAnonymous.json().data[0].event).toBeNull()

    const asGuest = await listPhotos(owner.id, guest.id)
    expect(asGuest.json().data[0].event).toEqual({
      id: event.id,
      title: 'Só chegados',
    })

    const asOwner = await listPhotos(owner.id, owner.id)
    expect(asOwner.json().data[0].event).toEqual({
      id: event.id,
      title: 'Só chegados',
    })
  })

  it('mantém a entrada sem evento quando o evento é apagado', async () => {
    const owner = await makeUser()
    const event = await makeEvent(owner.id)
    const photo = await makeUserPhoto(owner.id, { eventId: event.id })

    await testPrisma.event.delete({ where: { id: event.id } })

    const res = await listPhotos(owner.id, owner.id)
    expect(res.json().data).toHaveLength(1)
    expect(res.json().data[0]).toMatchObject({ id: photo.id, event: null })
  })

  // Mesma leitura da vitrine de eventos (GET /users/:id/events): quem não pode
  // ver recebe o mural vazio, não um erro — o app já sabe pelo perfil que é
  // privado e nem dispara a query.
  it('perfil privado: mural vazio para não-seguidor, pendente e anônimo', async () => {
    const owner = await makeUser({ isPrivate: true })
    const stranger = await makeUser()
    const pending = await makeUser()
    await makeFollow(pending.id, owner.id, 'PENDING')
    await makeUserPhoto(owner.id)

    for (const viewerId of [stranger.id, pending.id, undefined]) {
      const res = await listPhotos(owner.id, viewerId)
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ data: [], nextCursor: null })
    }
  })

  it('perfil privado: seguidor aceito e o próprio dono veem o mural', async () => {
    const owner = await makeUser({ isPrivate: true })
    const follower = await makeUser()
    await makeFollow(follower.id, owner.id, 'ACCEPTED')
    await makeUserPhoto(owner.id)

    for (const viewerId of [follower.id, owner.id]) {
      const res = await listPhotos(owner.id, viewerId)
      expect(res.statusCode).toBe(200)
      expect(res.json().data).toHaveLength(1)
    }
  })

  it('bloqueio em qualquer direção devolve mural vazio', async () => {
    const owner = await makeUser()
    const blockedByOwner = await makeUser()
    const blockerOfOwner = await makeUser()
    await makeBlock(owner.id, blockedByOwner.id)
    await makeBlock(blockerOfOwner.id, owner.id)
    await makeUserPhoto(owner.id)

    for (const viewerId of [blockedByOwner.id, blockerOfOwner.id]) {
      const res = await listPhotos(owner.id, viewerId)
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ data: [], nextCursor: null })
    }
  })

  // O 404 de conta é do GET /users/:id; a listagem, como a vitrine de eventos,
  // só esvazia — a conta desativada some junto com o perfil.
  it('mural vazio para usuário inexistente e para conta desativada', async () => {
    const viewer = await makeUser()
    const deactivated = await makeUser({ accountStatus: 'DEACTIVATED' })
    await makeUserPhoto(deactivated.id)

    const missing = await listPhotos(
      '00000000-0000-4000-8000-000000000000',
      viewer.id,
    )
    expect(missing.statusCode).toBe(200)
    expect(missing.json()).toEqual({ data: [], nextCursor: null })

    const gone = await listPhotos(deactivated.id, viewer.id)
    expect(gone.statusCode).toBe(200)
    expect(gone.json()).toEqual({ data: [], nextCursor: null })
  })
})

describe('DELETE /users/me/photos/:photoId', () => {
  it('o dono apaga a entrada: linhas e blobs somem', async () => {
    const owner = await makeUser()
    const photo = await makeUserPhoto(owner.id, { imagesCount: 2 })

    const res = await app.inject({
      method: 'DELETE',
      url: `/users/me/photos/${photo.id}`,
      headers: { authorization: `Bearer ${token(app, owner.id)}` },
    })

    expect(res.statusCode).toBe(204)
    expect(await testPrisma.userPhoto.count({ where: { id: photo.id } })).toBe(
      0,
    )
    expect(
      await testPrisma.userPhotoImage.count({ where: { photoId: photo.id } }),
    ).toBe(0)
    for (const image of photo.images) {
      expect(fakeStorage.deleted).toContain(image.key)
      // Mídia pública do mural: o delete mira o namespace 'upload' (default).
      expect(fakeStorage.deletedResources).toContainEqual({
        key: image.key,
        deliveryType: 'upload',
      })
    }
  })

  it('retorna 403 para entrada de outro usuário, sem apagar nada', async () => {
    const owner = await makeUser()
    const other = await makeUser()
    const photo = await makeUserPhoto(owner.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/users/me/photos/${photo.id}`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('NOT_USER_PHOTO_AUTHOR')
    expect(await testPrisma.userPhoto.count({ where: { id: photo.id } })).toBe(
      1,
    )
    expect(fakeStorage.deleted).toHaveLength(0)
  })

  it('retorna 404 para id inexistente', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'DELETE',
      url: '/users/me/photos/00000000-0000-4000-8000-000000000000',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('USER_PHOTO_NOT_FOUND')
  })

  it('retorna 401 sem autenticação', async () => {
    const owner = await makeUser()
    const photo = await makeUserPhoto(owner.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/users/me/photos/${photo.id}`,
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('contador do mural no perfil', () => {
  it('GET /users/:id e GET /users/me devolvem photosCount', async () => {
    const owner = await makeUser()
    const viewer = await makeUser()
    await makeUserPhoto(owner.id)
    await makeUserPhoto(owner.id, { imagesCount: 3 })

    const asViewer = await app.inject({
      method: 'GET',
      url: `/users/${owner.id}`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })
    expect(asViewer.statusCode).toBe(200)
    expect(asViewer.json().photosCount).toBe(2)

    const me = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { authorization: `Bearer ${token(app, owner.id)}` },
    })
    expect(me.statusCode).toBe(200)
    expect(me.json().photosCount).toBe(2)
  })
})

describe('anonimização da conta', () => {
  it('apaga o mural e os blobs junto com a conta', async () => {
    const user = await makeUser({
      accountStatus: 'PENDING_DELETION',
      deactivatedAt: new Date(Date.now() - 31 * 86_400_000),
      scheduledDeletionAt: new Date(Date.now() - 86_400_000),
    })
    const photo = await makeUserPhoto(user.id, { imagesCount: 2 })

    const result = await reconcileAccountDeletions()

    expect(result.anonymized).toBe(1)
    expect(
      await testPrisma.userPhoto.count({ where: { userId: user.id } }),
    ).toBe(0)
    for (const image of photo.images) {
      expect(fakeStorage.deleted).toContain(image.key)
    }
  })
})
