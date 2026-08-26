import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  getKeyProvider,
  type IKeyProvider,
  setKeyProvider,
} from '../../lib/crypto'
import { __resetDekCache } from '../../lib/crypto/dek-cache'
import { EnvKeyProvider } from '../../lib/crypto/env-key-provider.service'
import { reconcileKekRewrap } from '../../lib/crypto/kek-rewrap.reconciler'
import { chatKekRewrapPending } from '../../lib/metrics'
import { buildApp } from '../../test/app'
import {
  makeDirectConversation,
  makeMessage,
  makeUser,
} from '../../test/factories'
import { testPrisma } from '../../test/prisma'
import { reportEvidenceRewrapSource } from '../reports/report-evidence.crypto'
import { conversationKeyRewrapSource } from './chat.crypto'

const KEK_V1 = Buffer.alloc(32, 0x11)
const KEK_V2 = Buffer.alloc(32, 0x22)

const SOURCES = [conversationKeyRewrapSource, reportEvidenceRewrapSource]

let app: FastifyInstance
let providerReal: IKeyProvider

function token(userId: string) {
  return { authorization: `Bearer ${app.jwt.sign({ sub: userId })}` }
}

/** Antes da rotação: só a V1 existe e é a ativa. */
function antesDaRotacao() {
  setKeyProvider(new EnvKeyProvider(new Map([[1, KEK_V1]]), 1))
}

/** Durante a rotação: as duas convivem, a V2 é a ativa. */
function duranteARotacao() {
  setKeyProvider(
    new EnvKeyProvider(
      new Map([
        [1, KEK_V1],
        [2, KEK_V2],
      ]),
      2,
    ),
  )
}

/** Depois do rewrap: a V1 sai do ambiente. */
function depoisDaRotacao() {
  setKeyProvider(new EnvKeyProvider(new Map([[2, KEK_V2]]), 2))
  // Sem isto o cache guardaria a DEK já aberta e a leitura passaria mesmo que o
  // rewrap não tivesse acontecido — o teste não provaria nada.
  __resetDekCache()
}

async function denunciar(reporterId: string, messageId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/messages/${messageId}/report`,
    headers: token(reporterId),
    body: { reason: 'HARASSMENT' },
  })
  expect(res.statusCode).toBe(201)
  return res.json()
}

beforeAll(async () => {
  app = buildApp()
  await app.ready()
  providerReal = getKeyProvider()
})

afterEach(() => {
  setKeyProvider(providerReal)
  __resetDekCache()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

describe('rewrap da KEK', () => {
  it('a leitura sobrevive à remoção da KEK antiga do ambiente', async () => {
    antesDaRotacao()
    const [a, b] = [await makeUser(), await makeUser()]
    const convo = await makeDirectConversation(a.id, b.id)
    await makeMessage(convo.id, a.id, { content: 'combinado pra sexta' })

    duranteARotacao()
    const [chaves] = await reconcileKekRewrap(SOURCES)
    expect(chaves).toMatchObject({ rewrapped: 1, failed: 0, pending: 0 })

    const chave = await testPrisma.conversationKey.findFirstOrThrow({
      where: { conversationId: convo.id },
    })
    expect(chave.kekVersion).toBe(2)

    depoisDaRotacao()
    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${convo.id}/messages`,
      headers: token(a.id),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data[0].content).toBe('combinado pra sexta')
  })

  it('mantém a evidência de denúncia legível depois do rewrap', async () => {
    antesDaRotacao()
    const [autor, denunciante, admin] = [
      await makeUser(),
      await makeUser(),
      await makeUser({ role: 'ADMIN' }),
    ]
    const convo = await makeDirectConversation(autor.id, denunciante.id)
    const message = await makeMessage(convo.id, autor.id, {
      content: 'ameaça explícita',
    })
    const denuncia = await denunciar(denunciante.id, message.id)

    duranteARotacao()
    const resultados = await reconcileKekRewrap(SOURCES)
    expect(
      resultados.find((r) => r.source === 'report_evidences'),
    ).toMatchObject({ rewrapped: 1, failed: 0, pending: 0 })

    depoisDaRotacao()
    const res = await app.inject({
      method: 'GET',
      url: `/reports/${denuncia.id}/evidence`,
      headers: token(admin.id),
    })

    expect(res.statusCode).toBe(200)
    expect(
      res.json().messages.find((m: { isReported: boolean }) => m.isReported)
        .content,
    ).toBe('ameaça explícita')
  })

  it('não toca chave crypto-shreddada', async () => {
    antesDaRotacao()
    const [a, b] = [await makeUser(), await makeUser()]
    const convo = await makeDirectConversation(a.id, b.id)
    await makeMessage(convo.id, a.id, { content: 'irrelevante' })
    await testPrisma.conversationKey.updateMany({
      where: { conversationId: convo.id },
      data: { shreddedAt: new Date() },
    })

    duranteARotacao()
    const [chaves] = await reconcileKekRewrap(SOURCES)

    expect(chaves).toMatchObject({ rewrapped: 0, failed: 0, pending: 0 })
    const chave = await testPrisma.conversationKey.findFirstOrThrow({
      where: { conversationId: convo.id },
    })
    // Reembrulhar aqui reabriria uma chave destruída de propósito.
    expect(chave.kekVersion).toBe(1)
  })

  it('é idempotente: a segunda passada não tem o que fazer', async () => {
    antesDaRotacao()
    const [a, b] = [await makeUser(), await makeUser()]
    const convo = await makeDirectConversation(a.id, b.id)
    await makeMessage(convo.id, a.id, { content: 'oi' })

    duranteARotacao()
    await reconcileKekRewrap(SOURCES)
    const [segunda] = await reconcileKekRewrap(SOURCES)

    expect(segunda).toMatchObject({ rewrapped: 0, skipped: 0, failed: 0 })
  })

  it('conta os pendentes por versão de KEK', async () => {
    antesDaRotacao()
    const [a, b] = [await makeUser(), await makeUser()]
    const convo = await makeDirectConversation(a.id, b.id)
    await makeMessage(convo.id, a.id, { content: 'oi' })

    duranteARotacao()
    expect(await conversationKeyRewrapSource.countPending(2)).toEqual([
      { kekVersion: 1, pending: 1 },
    ])

    await reconcileKekRewrap(SOURCES)

    // Zerar aqui é a condição que autoriza remover a KEK antiga do ambiente.
    expect(await conversationKeyRewrapSource.countPending(2)).toEqual([])
  })

  it('conta falha quando a KEK antiga já saiu do ambiente', async () => {
    antesDaRotacao()
    const [a, b] = [await makeUser(), await makeUser()]
    const convo = await makeDirectConversation(a.id, b.id)
    await makeMessage(convo.id, a.id, { content: 'oi' })

    // Removeram a V1 antes de drenar: o pendente fica visível e a falha é
    // contada, em vez de o reconciler seguir em silêncio.
    setKeyProvider(new EnvKeyProvider(new Map([[2, KEK_V2]]), 2))
    const [chaves] = await reconcileKekRewrap(SOURCES)

    expect(chaves).toMatchObject({ rewrapped: 0, failed: 1, pending: 1 })
  })
  it('publica o pendente na métrica e limpa o rótulo quando drena', async () => {
    antesDaRotacao()
    const [a, b] = [await makeUser(), await makeUser()]
    const convo = await makeDirectConversation(a.id, b.id)
    await makeMessage(convo.id, a.id, { content: 'oi' })

    // Sem a V1 nada reembrulha: o pendente precisa APARECER na métrica.
    setKeyProvider(new EnvKeyProvider(new Map([[2, KEK_V2]]), 2))
    await reconcileKekRewrap(SOURCES)

    const pendente = (await chatKekRewrapPending.get()).values.find(
      (v) => v.labels.source === 'conversation_keys',
    )
    expect(pendente).toMatchObject({ value: 1, labels: { kek_version: '1' } })

    duranteARotacao()
    await reconcileKekRewrap(SOURCES)

    // E precisa SUMIR ao drenar: `countPending` não devolve linha para versão
    // zerada, então sem o reset a V1 ficaria pendurada no último valor para
    // sempre — e é esse número que autoriza removê-la do ambiente.
    expect(
      (await chatKekRewrapPending.get()).values.filter(
        (v) => v.labels.source === 'conversation_keys',
      ),
    ).toEqual([])
  })

  it('ignora linha com envelope vazio mesmo sem marca de shred', async () => {
    antesDaRotacao()
    const [a, b] = [await makeUser(), await makeUser()]
    const convo = await makeDirectConversation(a.id, b.id)
    await makeMessage(convo.id, a.id, { content: 'irrelevante' })
    await testPrisma.conversationKey.updateMany({
      where: { conversationId: convo.id },
      data: { wrappedDek: new Uint8Array(0) },
    })

    duranteARotacao()

    // Só o rewrap tira a linha do predicado. Se ela entrasse no lote sem nunca
    // poder ser reembrulhada, a drenagem releria a mesma linha até o teto do
    // tick — a cada tick, para sempre.
    expect(await conversationKeyRewrapSource.findPending(2, 10)).toEqual([])
    expect(await conversationKeyRewrapSource.countPending(2)).toEqual([])
  })
})
