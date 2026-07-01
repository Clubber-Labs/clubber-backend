import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import {
  makeEvent,
  makeFollow,
  makeUser,
  makeUserCategoryPreference,
  makeUserSubcategoryPreference,
} from '../../test/factories'
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
      role: 'USER',
    })
  })

  it('expõe isPremium no perfil próprio (gate de UI premium no mobile)', async () => {
    const user = await makeUser()

    const before = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })
    expect(before.json()).toMatchObject({ isPremium: false })

    await testPrisma.user.update({
      where: { id: user.id },
      data: { isPremium: true },
    })

    const after = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })
    expect(after.json()).toMatchObject({ isPremium: true })
  })

  it('expõe o raio salvo e o teto de spots (slider do mobile)', async () => {
    const user = await makeUser({ spotRadiusKm: 25 })

    const res = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    // spotRadiusKm = default do slider; spotMaxRadiusKm = max (sem hardcode).
    expect(res.json()).toMatchObject({ spotRadiusKm: 25, spotMaxRadiusKm: 50 })
  })

  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/users/me' })
    expect(res.statusCode).toBe(401)
  })

  it('retorna 401 quando o token é válido mas o usuário não existe mais', async () => {
    // Token assinado para um id inexistente (ex.: conta deletada após o login).
    const ghostToken = app.jwt.sign({ sub: crypto.randomUUID() })

    const res = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { authorization: `Bearer ${ghostToken}` },
    })

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
    expect(res.json().kind).toBe('full')
    expect(res.json().eventsCount).toBe(0)
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

  it('não expõe dados privados nem role no perfil público', async () => {
    const target = await makeUser({ role: 'ADMIN' })

    const res = await app.inject({ method: 'GET', url: `/users/${target.id}` })

    expect(res.statusCode).toBe(200)
    expect(res.json()).not.toHaveProperty('role')
    expect(res.json()).not.toHaveProperty('email')
    expect(res.json()).not.toHaveProperty('phone')
    expect(res.json()).not.toHaveProperty('birthdate')
  })
})

describe('GET /users/:id — conta privada mostra metadados (estilo Instagram)', () => {
  it('não-seguidor vê bio, contadores e preferências (só conteúdo/listas ficam gated)', async () => {
    const target = await makeUser({ isPrivate: true })
    await makeUserSubcategoryPreference(target.id, 'GASTRONOMY_PIZZA')
    const viewer = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${target.id}`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.kind).toBe('full')
    expect(body.isPrivate).toBe(true)
    expect(body.followStatus).toBeNull()
    expect(body).toHaveProperty('bio')
    expect(body.eventsCount).toBe(0)
    expect(body.followersCount).toBe(0)
    expect(body.followingCount).toBe(0)
    expect(body.preferredSubcategories).toContain('GASTRONOMY_PIZZA')
  })

  it('viewer anônimo também vê o perfil completo da conta privada', async () => {
    const target = await makeUser({ isPrivate: true })

    const res = await app.inject({ method: 'GET', url: `/users/${target.id}` })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.kind).toBe('full')
    expect(body.eventsCount).toBe(0)
    expect(body.followersCount).toBe(0)
  })

  it('follower ACCEPTED vê o perfil completo', async () => {
    const target = await makeUser({ isPrivate: true })
    await makeUserSubcategoryPreference(target.id, 'GASTRONOMY_PIZZA')
    const viewer = await makeUser()
    await makeFollow(viewer.id, target.id, 'ACCEPTED')

    const res = await app.inject({
      method: 'GET',
      url: `/users/${target.id}`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.kind).toBe('full')
    expect(body.eventsCount).toBe(0)
    expect(body.followStatus).toBe('ACCEPTED')
    expect(body.preferredSubcategories).toContain('GASTRONOMY_PIZZA')
  })

  it('o próprio dono vê o perfil completo', async () => {
    const target = await makeUser({ isPrivate: true })

    const res = await app.inject({
      method: 'GET',
      url: `/users/${target.id}`,
      headers: { authorization: `Bearer ${token(app, target.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().kind).toBe('full')
    expect(res.json().eventsCount).toBe(0)
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
    // Avatar é mídia PÚBLICA: o delete deve mirar o namespace 'upload' (default).
    // Trava contra uma regressão que hardcode 'authenticated' no primitivo
    // compartilhado e orfanasse avatar/evento.
    expect(fakeStorage.deletedResources).toContainEqual({
      key: firstKey,
      resourceType: 'image',
      deliveryType: 'upload',
    })
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

  it('retorna 429 após 20 requisições no mesmo minuto', async () => {
    const user = await makeUser()
    // remoteAddress exclusivo isola o contador de rate-limit (keyGenerator
    // default = req.ip) de outros testes/hooks que usam o IP default.
    const headers = {
      authorization: `Bearer ${token(app, user.id)}`,
    }

    for (let i = 0; i < 20; i++) {
      const res = await app.inject({
        method: 'PATCH',
        url: '/users/me/avatar',
        headers,
        remoteAddress: '203.0.113.25',
      })
      // Sem multipart o handler falha (4xx), mas o rate-limit roda no
      // onRequest antes do handler — o que importa é não ser 429 ainda.
      expect(res.statusCode).not.toBe(429)
    }

    const blocked = await app.inject({
      method: 'PATCH',
      url: '/users/me/avatar',
      headers,
      remoteAddress: '203.0.113.25',
    })
    expect(blocked.statusCode).toBe(429)
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
        preferredCategories: ['MUSIC', 'ART'],
      },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().message).toBe(
      'Este e-mail já está cadastrado em outra conta.',
    )
  })
})

describe('preferredCategories no perfil', () => {
  it('POST /users persiste preferredCategories e reflete em GET /users/me', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users',
      payload: {
        name: 'Maria',
        lastname: 'Silva',
        username: 'mariasilva',
        phone: '11999998888',
        email: 'maria@exemplo.com',
        password: 'senha12345',
        birthdate: '2000-01-01T00:00:00.000Z',
        preferredCategories: ['MUSIC', 'TECH'],
      },
    })

    expect(res.statusCode).toBe(201)
    const { user, token: jwt } = res.json()
    expect(user.preferredCategories).toEqual(
      expect.arrayContaining(['MUSIC', 'TECH']),
    )

    const rows = await testPrisma.userCategoryPreference.findMany({
      where: { userId: user.id },
    })
    expect(rows.map((r) => r.category).sort()).toEqual(['MUSIC', 'TECH'])

    const me = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { authorization: `Bearer ${jwt}` },
    })
    expect(me.json().preferredCategories).toEqual(
      expect.arrayContaining(['MUSIC', 'TECH']),
    )
  })

  it('POST /users com categoria inválida retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users',
      payload: {
        name: 'Joao',
        lastname: 'Souza',
        username: 'joaosouza',
        phone: '11988887777',
        email: 'joao@exemplo.com',
        password: 'senha12345',
        birthdate: '2000-01-01T00:00:00.000Z',
        preferredCategories: ['FOO'],
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('POST /users com menos de 2 categorias retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users',
      payload: {
        name: 'Pedro',
        lastname: 'Lima',
        username: 'pedrolima',
        phone: '11933332222',
        email: 'pedro@exemplo.com',
        password: 'senha12345',
        birthdate: '2000-01-01T00:00:00.000Z',
        preferredCategories: ['MUSIC'],
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('POST /users dedup: categorias repetidas não burlam o mínimo de 2', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users',
      payload: {
        name: 'Lara',
        lastname: 'Reis',
        username: 'larareis',
        phone: '11922221111',
        email: 'lara@exemplo.com',
        password: 'senha12345',
        birthdate: '2000-01-01T00:00:00.000Z',
        // 2 itens, mas 1 categoria distinta → rejeitado.
        preferredCategories: ['MUSIC', 'MUSIC'],
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('PUT /users/:id substitui as preferências (semântica PUT)', async () => {
    const user = await makeUser()
    await testPrisma.userCategoryPreference.createMany({
      data: [
        { userId: user.id, category: 'SPORTS' },
        { userId: user.id, category: 'PARTY' },
      ],
    })

    const res = await app.inject({
      method: 'PUT',
      url: `/users/${user.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      payload: { preferredCategories: ['ART', 'TECH'] },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().preferredCategories).toEqual(
      expect.arrayContaining(['ART', 'TECH']),
    )

    const rows = await testPrisma.userCategoryPreference.findMany({
      where: { userId: user.id },
    })
    expect(rows.map((r) => r.category).sort()).toEqual(['ART', 'TECH'])
  })

  it('PUT /users/:id rejeita menos de 2 categorias (perfil nunca vazio)', async () => {
    const user = await makeUser()
    await testPrisma.userCategoryPreference.createMany({
      data: [
        { userId: user.id, category: 'MUSIC' },
        { userId: user.id, category: 'ART' },
      ],
    })

    const res = await app.inject({
      method: 'PUT',
      url: `/users/${user.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      payload: { preferredCategories: [] },
    })

    // Não dá pra limpar/reduzir abaixo de 2 — a validação barra antes do service.
    expect(res.statusCode).toBe(400)
    const count = await testPrisma.userCategoryPreference.count({
      where: { userId: user.id },
    })
    expect(count).toBe(2)
  })

  it('PUT /users/:id sem preferredCategories não altera as existentes', async () => {
    const user = await makeUser()
    await testPrisma.userCategoryPreference.create({
      data: { userId: user.id, category: 'MUSIC' },
    })

    const res = await app.inject({
      method: 'PUT',
      url: `/users/${user.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      payload: { bio: 'nova bio' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().preferredCategories).toEqual(['MUSIC'])
  })
})

describe('preferredSubcategories no perfil', () => {
  it('POST /users persiste subcategorias e gêneros, reflete em GET /users/me', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users',
      payload: {
        name: 'Bianca',
        lastname: 'Costa',
        username: 'biancacosta',
        phone: '11955554444',
        email: 'bianca@exemplo.com',
        password: 'senha12345',
        birthdate: '2000-01-01T00:00:00.000Z',
        preferredCategories: ['GASTRONOMY', 'MUSIC'],
        preferredSubcategories: ['GASTRONOMY_JAPONESA', 'GENRE_FUNK'],
      },
    })

    expect(res.statusCode).toBe(201)
    const { user, token: jwt } = res.json()
    expect(user.preferredSubcategories).toEqual(
      expect.arrayContaining(['GASTRONOMY_JAPONESA', 'GENRE_FUNK']),
    )

    const me = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { authorization: `Bearer ${jwt}` },
    })
    expect(me.json().preferredSubcategories).toEqual(
      expect.arrayContaining(['GASTRONOMY_JAPONESA', 'GENRE_FUNK']),
    )
  })

  it('POST /users com chave de interesse inválida retorna 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users',
      payload: {
        name: 'Carlos',
        lastname: 'Dias',
        username: 'carlosdias',
        phone: '11944443333',
        email: 'carlos@exemplo.com',
        password: 'senha12345',
        birthdate: '2000-01-01T00:00:00.000Z',
        // categorias válidas: o 400 vem só da subcategoria inválida.
        preferredCategories: ['MUSIC', 'ART'],
        preferredSubcategories: ['NAO_EXISTE'],
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('PUT substitui subcategorias sem mexer nas categorias (independência)', async () => {
    const user = await makeUser()
    await makeUserCategoryPreference(user.id, 'GASTRONOMY')
    await makeUserSubcategoryPreference(user.id, 'GASTRONOMY_PIZZA')

    const res = await app.inject({
      method: 'PUT',
      url: `/users/${user.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      payload: { preferredSubcategories: ['GASTRONOMY_JAPONESA'] },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().preferredSubcategories).toEqual(['GASTRONOMY_JAPONESA'])
    // Categorias preservadas (PUT só tocou o nível enviado).
    expect(res.json().preferredCategories).toEqual(['GASTRONOMY'])
  })

  it('GET /users/:id expõe as subcategorias de terceiros', async () => {
    const owner = await makeUser()
    await makeUserSubcategoryPreference(owner.id, 'GASTRONOMY_PIZZA')
    const viewer = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: `/users/${owner.id}`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().preferredSubcategories).toContain('GASTRONOMY_PIZZA')
  })

  it('PUT com array vazio limpa as subcategorias', async () => {
    const user = await makeUser()
    await makeUserSubcategoryPreference(user.id, 'GENRE_ROCK')

    const res = await app.inject({
      method: 'PUT',
      url: `/users/${user.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      payload: { preferredSubcategories: [] },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().preferredSubcategories).toEqual([])
    const count = await testPrisma.userSubcategoryPreference.count({
      where: { userId: user.id },
    })
    expect(count).toBe(0)
  })
})

describe('GET /users/search', () => {
  it('retorna 401 sem autenticação', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/users/search?q=jo',
    })
    expect(res.statusCode).toBe(401)
  })

  it('retorna 400 quando q está ausente', async () => {
    const user = await makeUser()
    const res = await app.inject({
      method: 'GET',
      url: '/users/search',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })
    expect(res.statusCode).toBe(400)
  })

  it('retorna 400 quando q tem menos de 2 caracteres', async () => {
    const user = await makeUser()
    const res = await app.inject({
      method: 'GET',
      url: '/users/search?q=a',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })
    expect(res.statusCode).toBe(400)
  })

  it('retorna 400 quando q é só whitespace', async () => {
    const user = await makeUser()
    const res = await app.inject({
      method: 'GET',
      url: '/users/search?q=%20%20',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })
    expect(res.statusCode).toBe(400)
  })

  it('retorna 400 quando q tem mais de 100 caracteres', async () => {
    const user = await makeUser()
    const longQ = 'a'.repeat(101)
    const res = await app.inject({
      method: 'GET',
      url: `/users/search?q=${longQ}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })
    expect(res.statusCode).toBe(400)
  })

  it('busca por username case-insensitive', async () => {
    const viewer = await makeUser()
    const target = await makeUser({ username: 'alice_dev' })

    const res = await app.inject({
      method: 'GET',
      url: '/users/search?q=ALICE',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.some((u: { id: string }) => u.id === target.id)).toBe(true)
  })

  it('busca por name case-insensitive', async () => {
    const viewer = await makeUser()
    const target = await testPrisma.user.create({
      data: {
        name: 'Bruno',
        lastname: 'Costa',
        username: `bruno_${Date.now()}`,
        email: `bruno_${Date.now()}@test.com`,
        password: 'x',
        phone: `1199${Date.now().toString().slice(-7)}`,
        birthdate: new Date('2000-01-01'),
      },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/users/search?q=bruno',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(
      res.json().data.some((u: { id: string }) => u.id === target.id),
    ).toBe(true)
  })

  it('busca por lastname case-insensitive', async () => {
    const viewer = await makeUser()
    const target = await testPrisma.user.create({
      data: {
        name: 'Carla',
        lastname: 'Silveira',
        username: `carla_${Date.now()}`,
        email: `carla_${Date.now()}@test.com`,
        password: 'x',
        phone: `1198${Date.now().toString().slice(-7)}`,
        birthdate: new Date('2000-01-01'),
      },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/users/search?q=silveira',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(
      res.json().data.some((u: { id: string }) => u.id === target.id),
    ).toBe(true)
  })

  it('retorna data vazio quando não há matches', async () => {
    const viewer = await makeUser()
    const res = await app.inject({
      method: 'GET',
      url: '/users/search?q=zzzzzzzzz_nada',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [], nextCursor: null })
  })

  it('pagina via cursor ordenando por username asc', async () => {
    const viewer = await makeUser()
    await makeUser({ username: 'zeta_01' })
    await makeUser({ username: 'zeta_02' })
    await makeUser({ username: 'zeta_03' })

    const page1 = await app.inject({
      method: 'GET',
      url: '/users/search?q=zeta_&limit=2',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })
    expect(page1.statusCode).toBe(200)
    const body1 = page1.json()
    expect(body1.data).toHaveLength(2)
    expect(body1.data[0].username).toBe('zeta_01')
    expect(body1.data[1].username).toBe('zeta_02')
    expect(body1.nextCursor).toBe(body1.data[1].id)

    const page2 = await app.inject({
      method: 'GET',
      url: `/users/search?q=zeta_&limit=2&cursor=${body1.nextCursor}`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })
    expect(page2.statusCode).toBe(200)
    const body2 = page2.json()
    expect(body2.data).toHaveLength(1)
    expect(body2.data[0].username).toBe('zeta_03')
    expect(body2.nextCursor).toBe(null)
  })

  it('retorna shape completo (kind=full) para usuário público', async () => {
    const viewer = await makeUser()
    await makeUser({ username: 'public_user', isPrivate: false })

    const res = await app.inject({
      method: 'GET',
      url: '/users/search?q=public_user',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })
    const found = res
      .json()
      .data.find((u: { username: string }) => u.username === 'public_user')
    expect(found).toBeDefined()
    expect(found.kind).toBe('full')
    expect(found).toHaveProperty('bio')
    expect(found).toHaveProperty('followersCount')
    expect(found).toHaveProperty('followingCount')
    expect(found.followStatus).toBe(null)
    expect(found.isPrivate).toBe(false)
  })

  it('retorna shape reduzido (kind=reduced) para privado sem follow', async () => {
    const viewer = await makeUser()
    await makeUser({ username: 'private_user', isPrivate: true })

    const res = await app.inject({
      method: 'GET',
      url: '/users/search?q=private_user',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })
    const found = res
      .json()
      .data.find((u: { username: string }) => u.username === 'private_user')
    expect(found).toBeDefined()
    expect(found.kind).toBe('reduced')
    expect(found.isPrivate).toBe(true)
    expect(found.followStatus).toBe(null)
    expect(found).not.toHaveProperty('bio')
    expect(found).not.toHaveProperty('followersCount')
    expect(found).not.toHaveProperty('followingCount')
    expect(found).not.toHaveProperty('createdAt')
  })

  it('retorna shape reduzido (kind=reduced) para privado com follow PENDING', async () => {
    const viewer = await makeUser()
    const target = await makeUser({
      username: 'pending_priv',
      isPrivate: true,
    })
    await makeFollow(viewer.id, target.id, 'PENDING')

    const res = await app.inject({
      method: 'GET',
      url: '/users/search?q=pending_priv',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })
    const found = res
      .json()
      .data.find((u: { username: string }) => u.username === 'pending_priv')
    expect(found.kind).toBe('reduced')
    expect(found.followStatus).toBe('PENDING')
    expect(found).not.toHaveProperty('bio')
    expect(found).not.toHaveProperty('followersCount')
  })

  it('retorna shape completo (kind=full) para privado com follow ACCEPTED', async () => {
    const viewer = await makeUser()
    const target = await makeUser({
      username: 'accepted_priv',
      isPrivate: true,
    })
    await makeFollow(viewer.id, target.id, 'ACCEPTED')

    const res = await app.inject({
      method: 'GET',
      url: '/users/search?q=accepted_priv',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })
    const found = res
      .json()
      .data.find((u: { username: string }) => u.username === 'accepted_priv')
    expect(found.kind).toBe('full')
    expect(found.followStatus).toBe('ACCEPTED')
    expect(found.isPrivate).toBe(true)
    expect(found).toHaveProperty('bio')
    expect(found).toHaveProperty('followersCount')
  })

  it('o próprio viewer aparece com followStatus null e kind=full', async () => {
    const viewer = await makeUser({ username: 'self_finder' })

    const res = await app.inject({
      method: 'GET',
      url: '/users/search?q=self_finder',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })
    const found = res
      .json()
      .data.find((u: { id: string }) => u.id === viewer.id)
    expect(found).toBeDefined()
    expect(found.kind).toBe('full')
    expect(found.followStatus).toBe(null)
  })

  it('o próprio viewer privado também aparece com kind=full', async () => {
    const viewer = await makeUser({
      username: 'self_priv',
      isPrivate: true,
    })

    const res = await app.inject({
      method: 'GET',
      url: '/users/search?q=self_priv',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })
    const found = res
      .json()
      .data.find((u: { id: string }) => u.id === viewer.id)
    expect(found).toBeDefined()
    expect(found.kind).toBe('full')
    expect(found).toHaveProperty('bio')
  })

  it('todo item de data tem kind como discriminante', async () => {
    const viewer = await makeUser()
    await makeUser({ username: 'mix_pub', isPrivate: false })
    await makeUser({ username: 'mix_priv', isPrivate: true })

    const res = await app.inject({
      method: 'GET',
      url: '/users/search?q=mix_',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })
    expect(res.statusCode).toBe(200)
    const items = res.json().data as Array<{ kind: string }>
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(['full', 'reduced']).toContain(item.kind)
    }
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

describe('ciclo de vida da conta', () => {
  it('POST /users/me/deactivate desativa a conta', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/users/me/deactivate',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ accountStatus: 'DEACTIVATED' })

    const reloaded = await testPrisma.user.findUnique({
      where: { id: user.id },
      select: { accountStatus: true, deactivatedAt: true },
    })
    expect(reloaded?.accountStatus).toBe('DEACTIVATED')
    expect(reloaded?.deactivatedAt).not.toBeNull()
  })

  it('POST /users/me/deactivate é idempotente', async () => {
    const user = await makeUser()
    const headers = { authorization: `Bearer ${token(app, user.id)}` }

    await app.inject({ method: 'POST', url: '/users/me/deactivate', headers })
    const res = await app.inject({
      method: 'POST',
      url: '/users/me/deactivate',
      headers,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ accountStatus: 'DEACTIVATED' })
  })

  it('DELETE /users/:id agenda exclusão com senha correta', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'DELETE',
      url: `/users/${user.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { password: 'senha123' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.accountStatus).toBe('PENDING_DELETION')
    expect(new Date(body.scheduledDeletionAt).getTime()).toBeGreaterThan(
      Date.now(),
    )

    const reloaded = await testPrisma.user.findUnique({
      where: { id: user.id },
      select: { accountStatus: true },
    })
    expect(reloaded?.accountStatus).toBe('PENDING_DELETION')
  })

  it('DELETE /users/:id retorna 400 sem senha quando a conta tem senha', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'DELETE',
      url: `/users/${user.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: {},
    })

    expect(res.statusCode).toBe(400)
  })

  it('DELETE /users/:id retorna 401 com senha incorreta', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'DELETE',
      url: `/users/${user.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { password: 'errada' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('DELETE /users/:id dispensa senha para conta social-only', async () => {
    const user = await makeUser({ password: null })

    const res = await app.inject({
      method: 'DELETE',
      url: `/users/${user.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: {},
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().accountStatus).toBe('PENDING_DELETION')
  })

  it('DELETE /users/:id de outro usuário retorna 403', async () => {
    const owner = await makeUser()
    const other = await makeUser()

    const res = await app.inject({
      method: 'DELETE',
      url: `/users/${owner.id}`,
      headers: { authorization: `Bearer ${token(app, other.id)}` },
      body: { password: 'senha123' },
    })

    expect(res.statusCode).toBe(403)
  })

  it('DELETE /users/:id é idempotente mantendo o scheduledDeletionAt', async () => {
    const user = await makeUser()
    const headers = { authorization: `Bearer ${token(app, user.id)}` }

    const first = await app.inject({
      method: 'DELETE',
      url: `/users/${user.id}`,
      headers,
      body: { password: 'senha123' },
    })
    const second = await app.inject({
      method: 'DELETE',
      url: `/users/${user.id}`,
      headers,
      body: { password: 'senha123' },
    })

    expect(second.statusCode).toBe(200)
    expect(second.json().scheduledDeletionAt).toBe(
      first.json().scheduledDeletionAt,
    )
  })

  it('POST /users/me/reactivate reativa conta DEACTIVATED', async () => {
    const user = await makeUser({
      accountStatus: 'DEACTIVATED',
      deactivatedAt: new Date(),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/users/me/reactivate',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().accountStatus).toBe('ACTIVE')
  })

  it('POST /users/me/reactivate é idempotente para conta ACTIVE', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'POST',
      url: '/users/me/reactivate',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().accountStatus).toBe('ACTIVE')
  })

  it('POST /users/me/reactivate retorna 409 para conta ANONYMIZED', async () => {
    const user = await makeUser({
      accountStatus: 'ANONYMIZED',
      anonymizedAt: new Date(),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/users/me/reactivate',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(409)
  })

  it('GET /users/me expõe accountStatus e scheduledDeletionAt', async () => {
    const user = await makeUser()
    const headers = { authorization: `Bearer ${token(app, user.id)}` }

    await app.inject({
      method: 'DELETE',
      url: `/users/${user.id}`,
      headers,
      body: { password: 'senha123' },
    })

    const res = await app.inject({ method: 'GET', url: '/users/me', headers })
    expect(res.statusCode).toBe(200)
    expect(res.json().accountStatus).toBe('PENDING_DELETION')
    expect(res.json().scheduledDeletionAt).not.toBeNull()
  })
})

describe('visibilidade de contas inativas', () => {
  it('GET /users/:id de conta DEACTIVATED retorna 404', async () => {
    const viewer = await makeUser()
    const target = await makeUser({ accountStatus: 'DEACTIVATED' })

    const res = await app.inject({
      method: 'GET',
      url: `/users/${target.id}`,
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(404)
  })

  it('GET /users não lista contas inativas', async () => {
    const active = await makeUser()
    await makeUser({ accountStatus: 'DEACTIVATED' })
    await makeUser({ accountStatus: 'PENDING_DELETION' })
    await makeUser({ accountStatus: 'ANONYMIZED' })

    const res = await app.inject({ method: 'GET', url: '/users' })

    expect(res.statusCode).toBe(200)
    const ids = res.json().data.map((u: { id: string }) => u.id)
    expect(ids).toContain(active.id)
    expect(ids).toHaveLength(1)
  })

  it('GET /users/search não retorna contas inativas', async () => {
    const viewer = await makeUser()
    const active = await makeUser({ username: 'visivel_busca' })
    await makeUser({ username: 'oculto_busca', accountStatus: 'DEACTIVATED' })

    const res = await app.inject({
      method: 'GET',
      url: '/users/search?q=_busca',
      headers: { authorization: `Bearer ${token(app, viewer.id)}` },
    })

    expect(res.statusCode).toBe(200)
    const ids = res.json().data.map((u: { id: string }) => u.id)
    expect(ids).toContain(active.id)
    expect(ids).toHaveLength(1)
  })
})

describe('GET /users/me — hasPassword', () => {
  it('expõe hasPassword=true e nunca o hash da senha', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().hasPassword).toBe(true)
    expect(res.json()).not.toHaveProperty('password')
  })

  it('hasPassword=false para conta social-only', async () => {
    const user = await makeUser({ password: null })

    const res = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().hasPassword).toBe(false)
  })
})

describe('motivo de saída (só no fluxo de exclusão)', () => {
  it('DELETE /users/:id registra o motivo em AccountLifecycleLog', async () => {
    const user = await makeUser()

    const res = await app.inject({
      method: 'DELETE',
      url: `/users/${user.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { password: 'senha123', reason: 'gasto muito tempo no app' },
    })

    expect(res.statusCode).toBe(200)
    const logs = await testPrisma.accountLifecycleLog.findMany({
      where: { userId: user.id },
    })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      action: 'DELETION_SCHEDULED',
      reason: 'gasto muito tempo no app',
    })
  })

  it('DELETE /users/:id sem motivo grava log com reason null', async () => {
    const user = await makeUser()

    await app.inject({
      method: 'DELETE',
      url: `/users/${user.id}`,
      headers: { authorization: `Bearer ${token(app, user.id)}` },
      body: { password: 'senha123' },
    })

    const logs = await testPrisma.accountLifecycleLog.findMany({
      where: { userId: user.id },
    })
    expect(logs).toHaveLength(1)
    expect(logs[0].reason).toBeNull()
  })

  it('desativar NÃO registra motivo (sem log)', async () => {
    const user = await makeUser()

    await app.inject({
      method: 'POST',
      url: '/users/me/deactivate',
      headers: { authorization: `Bearer ${token(app, user.id)}` },
    })

    const logs = await testPrisma.accountLifecycleLog.findMany({
      where: { userId: user.id },
    })
    expect(logs).toHaveLength(0)
  })
})
