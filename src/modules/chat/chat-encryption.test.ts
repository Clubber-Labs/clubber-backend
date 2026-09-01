import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  getKeyProvider,
  type IKeyProvider,
  setKeyProvider,
} from '../../lib/crypto'
import { __resetDekCache, invalidateDek } from '../../lib/crypto/dek-cache'
import { buildApp } from '../../test/app'
import {
  makeDirectConversation,
  makeGroupConversation,
  makeMessage,
  makeUser,
} from '../../test/factories'
import { testPrisma } from '../../test/prisma'

let app: FastifyInstance
// Capturado ANTES de qualquer teste trocar o provider — o singleton é global do
// processo e um vazamento contaminaria os arquivos seguintes.
let providerReal: IKeyProvider

function auth(userId: string) {
  return { authorization: `Bearer ${app.jwt.sign({ sub: userId })}` }
}

/** Texto único por caso: permite varrer o banco atrás dele sem falso positivo. */
function sentinela() {
  return `SENTINELA-${randomUUID()}`
}

/**
 * Varre TODA coluna textual do banco procurando a sentinela. É o teste que uma
 * auditoria vai procurar: não basta `content` estar nulo, o texto não pode
 * aparecer em lugar nenhum. Parametrizado via Prisma.sql (sql-safety.test.ts).
 */
async function ocorrenciasNoBanco(termo: string): Promise<number> {
  const linhas = await testPrisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
    SELECT count(*)::bigint AS total
    FROM "messages"
    WHERE COALESCE("content", '') LIKE ${`%${termo}%`}
       OR COALESCE("contentCipher", '') LIKE ${`%${termo}%`}
  `)
  return Number(linhas[0]?.total ?? 0)
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
  providerReal = getKeyProvider()
})

afterEach(() => {
  setKeyProvider(providerReal)
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('nada de plaintext no banco', () => {
  it('não grava o texto da mensagem em nenhuma coluna', async () => {
    const [a, b] = [await makeUser(), await makeUser()]
    const conversation = await makeDirectConversation(a.id, b.id)
    const texto = sentinela()

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(a.id),
      body: { content: texto },
    })

    expect(res.statusCode).toBe(201)
    expect(await ocorrenciasNoBanco(texto)).toBe(0)

    const rows = await testPrisma.message.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0].content).toBeNull()
    expect(rows[0].contentCipher).not.toBeNull()
    expect(rows[0].contentKeyVersion).toBe(1)
  })

  it('cifra também a mensagem de sistema (que carrega nome de usuário)', async () => {
    const dono = await makeUser({ name: 'Zoraide', lastname: 'Kubitschek' })
    const novo = await makeUser({ name: 'Belarmino', lastname: 'Quaresma' })
    const grupo = await makeGroupConversation(dono.id, [])

    const res = await app.inject({
      method: 'POST',
      url: `/conversations/${grupo.id}/participants`,
      headers: auth(dono.id),
      body: { userId: novo.id },
    })
    expect(res.statusCode).toBe(201)

    const sistema = await testPrisma.message.findFirst({
      where: { type: 'SYSTEM' },
    })
    expect(sistema?.content).toBeNull()
    expect(sistema?.contentCipher).not.toBeNull()
    // O nome do usuário vai dentro do texto da mensagem de sistema.
    expect(await ocorrenciasNoBanco('Belarmino')).toBe(0)
  })
})

describe('roundtrip pela API', () => {
  it('devolve o texto idêntico, com acentuação e emoji', async () => {
    const [a, b] = [await makeUser(), await makeUser()]
    const conversation = await makeDirectConversation(a.id, b.id)
    const texto = 'Ação às 9h no coração da cidade — combinado? 🎉🔐 ñ'

    await app.inject({
      method: 'POST',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(a.id),
      body: { content: texto },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(b.id),
    })

    expect(res.json().data[0].content).toBe(texto)
  })
})

describe('leitura dual', () => {
  it('lê linha legada em claro junto com cifradas na mesma página', async () => {
    const [a, b] = [await makeUser(), await makeUser()]
    const conversation = await makeDirectConversation(a.id, b.id)

    await makeMessage(conversation.id, a.id, {
      content: 'mensagem antiga',
      legacyPlaintext: true,
    })
    await makeMessage(conversation.id, b.id, { content: 'mensagem nova' })

    const legada = await testPrisma.message.findFirst({
      where: { content: { not: null } },
    })
    expect(legada?.contentCipher).toBeNull()

    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(a.id),
    })

    const conteudos = res.json().data.map((m: { content: string }) => m.content)
    expect(conteudos).toContain('mensagem antiga')
    expect(conteudos).toContain('mensagem nova')
  })
})

describe('preview de resposta (replyTo)', () => {
  it('decifra o preview de uma mensagem cifrada', async () => {
    const [a, b] = [await makeUser(), await makeUser()]
    const conversation = await makeDirectConversation(a.id, b.id)
    const original = await makeMessage(conversation.id, a.id, {
      content: 'pergunta original',
    })

    await app.inject({
      method: 'POST',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(b.id),
      body: { content: 'resposta', replyToId: original.id },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(a.id),
    })

    expect(res.json().data[0].replyTo.content).toBe('pergunta original')
  })

  it('decifra o preview de uma mensagem legada', async () => {
    const [a, b] = [await makeUser(), await makeUser()]
    const conversation = await makeDirectConversation(a.id, b.id)
    const original = await makeMessage(conversation.id, a.id, {
      content: 'pergunta legada',
      legacyPlaintext: true,
    })

    await app.inject({
      method: 'POST',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(b.id),
      body: { content: 'resposta', replyToId: original.id },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(a.id),
    })

    expect(res.json().data[0].replyTo.content).toBe('pergunta legada')
  })

  it('preview de mensagem apagada continua nulo', async () => {
    const [a, b] = [await makeUser(), await makeUser()]
    const conversation = await makeDirectConversation(a.id, b.id)
    const original = await makeMessage(conversation.id, a.id, {
      content: 'vai sumir',
    })
    await app.inject({
      method: 'POST',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(b.id),
      body: { content: 'resposta', replyToId: original.id },
    })
    await testPrisma.message.update({
      where: { id: original.id },
      data: { deletedAt: new Date() },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(a.id),
    })

    const resposta = res
      .json()
      .data.find((m: { replyToId: string }) => m.replyToId === original.id)
    expect(resposta.replyTo.content).toBeNull()
  })
})

describe('edição', () => {
  it('cifra o novo texto e troca o ciphertext', async () => {
    const [a, b] = [await makeUser(), await makeUser()]
    const conversation = await makeDirectConversation(a.id, b.id)
    const message = await makeMessage(conversation.id, a.id, {
      content: 'antes',
    })
    const cipherAntes = (
      await testPrisma.message.findUniqueOrThrow({ where: { id: message.id } })
    ).contentCipher
    const texto = sentinela()

    const res = await app.inject({
      method: 'PATCH',
      url: `/conversations/${conversation.id}/messages/${message.id}`,
      headers: auth(a.id),
      body: { content: texto },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().content).toBe(texto)
    const depois = await testPrisma.message.findUniqueOrThrow({
      where: { id: message.id },
    })
    expect(depois.contentCipher).not.toBe(cipherAntes)
    expect(depois.editedAt).not.toBeNull()
    expect(await ocorrenciasNoBanco(texto)).toBe(0)
  })

  // Editar uma linha pré-backfill não pode deixar a versão antiga em claro.
  it('zera o plaintext legado ao editar uma mensagem antiga', async () => {
    const [a, b] = [await makeUser(), await makeUser()]
    const conversation = await makeDirectConversation(a.id, b.id)
    const message = await makeMessage(conversation.id, a.id, {
      content: 'texto em claro',
      legacyPlaintext: true,
    })

    await app.inject({
      method: 'PATCH',
      url: `/conversations/${conversation.id}/messages/${message.id}`,
      headers: auth(a.id),
      body: { content: 'texto novo' },
    })

    const depois = await testPrisma.message.findUniqueOrThrow({
      where: { id: message.id },
    })
    expect(depois.content).toBeNull()
    expect(await ocorrenciasNoBanco('texto em claro')).toBe(0)
  })
})

describe('inbox', () => {
  it('decifra a última mensagem de cada conversa', async () => {
    const dono = await makeUser()
    const outros = [await makeUser(), await makeUser(), await makeUser()]
    for (const [i, outro] of outros.entries()) {
      const conversation = await makeDirectConversation(dono.id, outro.id)
      await makeMessage(conversation.id, outro.id, { content: `última ${i}` })
    }

    const res = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: auth(dono.id),
    })

    const previews = res
      .json()
      .data.map(
        (c: { lastMessage: { content: string } }) => c.lastMessage.content,
      )
      .sort()
    expect(previews).toEqual(['última 0', 'última 1', 'última 2'])
  })
})

describe('idempotência', () => {
  it('devolve a mensagem decifrada no retry com a mesma key', async () => {
    const [a, b] = [await makeUser(), await makeUser()]
    const conversation = await makeDirectConversation(a.id, b.id)
    const texto = sentinela()
    const enviar = () =>
      app.inject({
        method: 'POST',
        url: `/conversations/${conversation.id}/messages`,
        headers: { ...auth(a.id), 'idempotency-key': 'chave-fixa' },
        body: { content: texto },
      })

    const primeira = await enviar()
    const retry = await enviar()

    expect(primeira.json().id).toBe(retry.json().id)
    expect(retry.json().content).toBe(texto)
    expect(await testPrisma.message.count()).toBe(1)
  })
})

describe('provisionamento da chave', () => {
  it('só cria a chave na primeira escrita', async () => {
    const [a, b] = [await makeUser(), await makeUser()]
    const conversation = await makeDirectConversation(a.id, b.id)

    expect(
      await testPrisma.conversationKey.count({
        where: { conversationId: conversation.id },
      }),
    ).toBe(0)

    await app.inject({
      method: 'POST',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(a.id),
      body: { content: 'primeira' },
    })

    const keys = await testPrisma.conversationKey.findMany({
      where: { conversationId: conversation.id },
    })
    expect(keys).toHaveLength(1)
    expect(keys[0].version).toBe(1)
    expect(keys[0].kekVersion).toBe(1)
  })

  // Dois envios simultâneos numa conversa sem chave: o unique elege um vencedor
  // e o perdedor reusa a chave dele — nunca duas chaves para a mesma conversa.
  it('corrida de provisionamento cria uma única chave', async () => {
    const [a, b] = [await makeUser(), await makeUser()]
    const conversation = await makeDirectConversation(a.id, b.id)

    const [um, dois] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/conversations/${conversation.id}/messages`,
        headers: auth(a.id),
        body: { content: 'simultânea A' },
      }),
      app.inject({
        method: 'POST',
        url: `/conversations/${conversation.id}/messages`,
        headers: auth(b.id),
        body: { content: 'simultânea B' },
      }),
    ])

    expect([um.statusCode, dois.statusCode]).toEqual([201, 201])
    expect(
      await testPrisma.conversationKey.count({
        where: { conversationId: conversation.id },
      }),
    ).toBe(1)

    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(a.id),
    })
    const conteudos = res.json().data.map((m: { content: string }) => m.content)
    expect(conteudos.sort()).toEqual(['simultânea A', 'simultânea B'])
  })
})

describe('hidratação em lote', () => {
  // Prova que a leitura NÃO faz um unwrap por mensagem: 20 mensagens numa
  // conversa custam um único desembrulho.
  it('desembrulha a chave uma vez para a página inteira', async () => {
    const [a, b] = [await makeUser(), await makeUser()]
    const conversation = await makeDirectConversation(a.id, b.id)
    for (let i = 0; i < 20; i++) {
      await makeMessage(conversation.id, a.id, { content: `msg ${i}` })
    }

    // A escrita deixou a DEK em cache; esvaziar simula um processo frio lendo a
    // conversa — senão a leitura custaria zero unwraps e o teste não provaria
    // nada sobre o lote.
    __resetDekCache()

    const real = getKeyProvider()
    let unwraps = 0
    const contador: IKeyProvider = {
      activeVersion: () => real.activeVersion(),
      wrap: (key, aad) => real.wrap(key, aad),
      unwrap: (wrapped, aad) => {
        unwraps++
        return real.unwrap(wrapped, aad)
      },
    }
    setKeyProvider(contador)

    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(b.id),
    })

    expect(res.json().data).toHaveLength(20)
    expect(unwraps).toBe(1)
  })
})

describe('chave indisponível', () => {
  // Contrato de degradação: conteúdo nulo, nunca 500 — é o que torna o
  // crypto-shredding utilizável sem quebrar a listagem.
  it('devolve conteúdo nulo sem derrubar a listagem', async () => {
    const [a, b] = [await makeUser(), await makeUser()]
    const conversation = await makeDirectConversation(a.id, b.id)
    await makeMessage(conversation.id, a.id, { content: 'some depois' })

    await testPrisma.conversationKey.deleteMany({
      where: { conversationId: conversation.id },
    })
    // Apagar a linha não basta: a DEK em cache seguiria decifrando até o TTL.
    // Invalidar é o que o crypto-shredding faz na instância local — nas demais,
    // o TTL é o teto da janela.
    invalidateDek(conversation.id)

    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(a.id),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
    expect(res.json().data[0].content).toBeNull()
  })

  it('uma conversa sem chave não afeta as outras no inbox', async () => {
    const dono = await makeUser()
    const [x, y] = [await makeUser(), await makeUser()]
    const quebrada = await makeDirectConversation(dono.id, x.id)
    const sadia = await makeDirectConversation(dono.id, y.id)
    await makeMessage(quebrada.id, x.id, { content: 'ilegível' })
    await makeMessage(sadia.id, y.id, { content: 'legível' })

    await testPrisma.conversationKey.deleteMany({
      where: { conversationId: quebrada.id },
    })
    // Só a conversa quebrada é invalidada: a sadia mantém a DEK em cache, o que
    // de quebra prova que a invalidação é por conversa, não global.
    invalidateDek(quebrada.id)

    const res = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: auth(dono.id),
    })

    expect(res.statusCode).toBe(200)
    const porId = new Map(
      res
        .json()
        .data.map(
          (c: { id: string; lastMessage: { content: string | null } }) => [
            c.id,
            c.lastMessage.content,
          ],
        ),
    )
    expect(porId.get(quebrada.id)).toBeNull()
    expect(porId.get(sadia.id)).toBe('legível')
  })
})

// Mensagem só de mídia tem content nulo: sem os anexos no preview, responder
// uma foto rendia citação em branco — o app monta o rótulo a partir do KIND do
// primeiro anexo (attachmentReplyLabel).
describe('anexos na citação da resposta', () => {
  async function seedMediaMessage(
    conversationId: string,
    senderId: string,
    kind: 'IMAGE' | 'AUDIO' | 'VIDEO' = 'IMAGE',
  ) {
    const message = await makeMessage(conversationId, senderId, {
      content: null,
    })
    await testPrisma.messageAttachment.create({
      data: {
        messageId: message.id,
        kind,
        url: 'https://cdn.test/foto.webp',
        key: `chat/${message.id}`,
        format: 'webp',
        size: 1024,
        waveform: [],
        order: 0,
      },
    })
    return message
  }

  it('responder mensagem só de mídia devolve o anexo citado', async () => {
    const [a, b] = [await makeUser(), await makeUser()]
    const conversation = await makeDirectConversation(a.id, b.id)
    const original = await seedMediaMessage(conversation.id, a.id)

    await app.inject({
      method: 'POST',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(b.id),
      body: { content: 'que foto boa', replyToId: original.id },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(a.id),
    })

    const { replyTo } = res.json().data[0]
    expect(replyTo.content).toBeNull()
    expect(replyTo.attachments).toHaveLength(1)
    expect(replyTo.attachments[0].kind).toBe('IMAGE')
    expect(replyTo.attachments[0].url).toBeTruthy()
  })

  it('preserva o kind do anexo citado (áudio não vira foto)', async () => {
    const [a, b] = [await makeUser(), await makeUser()]
    const conversation = await makeDirectConversation(a.id, b.id)
    const original = await seedMediaMessage(conversation.id, a.id, 'AUDIO')

    await app.inject({
      method: 'POST',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(b.id),
      body: { content: 'ouvi', replyToId: original.id },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(a.id),
    })

    expect(res.json().data[0].replyTo.attachments[0].kind).toBe('AUDIO')
  })

  // A key é interna (serve só para assinar a URL) e não pode vazar no payload —
  // mesma regra que shapeMessage já aplica aos anexos da própria mensagem.
  it('não vaza a key do anexo citado', async () => {
    const [a, b] = [await makeUser(), await makeUser()]
    const conversation = await makeDirectConversation(a.id, b.id)
    const original = await seedMediaMessage(conversation.id, a.id)

    await app.inject({
      method: 'POST',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(b.id),
      body: { content: 'resposta', replyToId: original.id },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(a.id),
    })

    expect(res.json().data[0].replyTo.attachments[0]).not.toHaveProperty('key')
  })

  it('mensagem citada só de texto devolve attachments vazio', async () => {
    const [a, b] = [await makeUser(), await makeUser()]
    const conversation = await makeDirectConversation(a.id, b.id)
    const original = await makeMessage(conversation.id, a.id, {
      content: 'só texto',
    })

    await app.inject({
      method: 'POST',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(b.id),
      body: { content: 'resposta', replyToId: original.id },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(a.id),
    })

    expect(res.json().data[0].replyTo.attachments).toEqual([])
  })

  // Citada apagada já zerava content; os anexos seguem a mesma regra, senão a
  // mídia sobreviveria à exclusão dentro da citação.
  it('citada apagada devolve attachments vazio', async () => {
    const [a, b] = [await makeUser(), await makeUser()]
    const conversation = await makeDirectConversation(a.id, b.id)
    const original = await seedMediaMessage(conversation.id, a.id)

    await app.inject({
      method: 'POST',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(b.id),
      body: { content: 'resposta', replyToId: original.id },
    })
    await testPrisma.message.update({
      where: { id: original.id },
      data: { deletedAt: new Date() },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${conversation.id}/messages`,
      headers: auth(a.id),
    })

    const { replyTo } = res.json().data[0]
    expect(replyTo.content).toBeNull()
    expect(replyTo.attachments).toEqual([])
  })
})
