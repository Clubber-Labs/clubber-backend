import { beforeEach, describe, expect, it } from 'vitest'
import {
  makeBlock,
  makeDirectConversation,
  makeGroupConversation,
  makeMessage,
  makeUser,
} from '../../test/factories'
import { fakePush } from '../../test/fake-push'
import { testPrisma } from '../../test/prisma'
import { runChatMessagePush } from './chat-push.service'

/** Destinatário apto a receber push: consentimento + device token ativo. */
async function makePushableUser() {
  const user = await makeUser()
  await testPrisma.userConsent.update({
    where: { userId: user.id },
    data: { pushNotifications: true },
  })
  await testPrisma.deviceToken.create({
    data: { userId: user.id, token: `ExponentPushToken[${user.id}]` },
  })
  return user
}

function markDelivered(conversationId: string, userId: string, at: Date) {
  return testPrisma.conversationParticipant.updateMany({
    where: { conversationId, userId },
    data: { lastDeliveredAt: at },
  })
}

beforeEach(() => {
  fakePush.reset()
})

describe('runChatMessagePush — DM', () => {
  it('envia push ao destinatário que não recebeu via socket', async () => {
    const sender = await makeUser()
    const recipient = await makePushableUser()
    const convo = await makeDirectConversation(sender.id, recipient.id)
    const message = await makeMessage(convo.id, sender.id, { content: 'oi!' })

    const { sent } = await runChatMessagePush(message.id)

    expect(sent).toBe(1)
    expect(fakePush.sent).toHaveLength(1)
    expect(fakePush.sent[0]).toMatchObject({
      to: `ExponentPushToken[${recipient.id}]`,
      title: `${sender.name} ${sender.lastname}`.trim(),
      body: 'oi!',
      data: {
        type: 'chat.message',
        conversationId: convo.id,
        messageId: message.id,
      },
    })
  })

  it('pula quem já recebeu via socket (lastDeliveredAt cobre a mensagem)', async () => {
    const sender = await makeUser()
    const recipient = await makePushableUser()
    const convo = await makeDirectConversation(sender.id, recipient.id)
    const message = await makeMessage(convo.id, sender.id)
    await markDelivered(convo.id, recipient.id, new Date(Date.now() + 1000))

    const { sent } = await runChatMessagePush(message.id)

    expect(sent).toBe(0)
    expect(fakePush.sent).toHaveLength(0)
  })

  it('empurra para quem tem watermark ANTERIOR à mensagem', async () => {
    const sender = await makeUser()
    const recipient = await makePushableUser()
    const convo = await makeDirectConversation(sender.id, recipient.id)
    await markDelivered(convo.id, recipient.id, new Date(Date.now() - 60_000))
    const message = await makeMessage(convo.id, sender.id)

    const { sent } = await runChatMessagePush(message.id)
    expect(sent).toBe(1)
  })

  it('não envia sem consentimento de push', async () => {
    const sender = await makeUser()
    const recipient = await makeUser()
    await testPrisma.deviceToken.create({
      data: { userId: recipient.id, token: 'ExponentPushToken[semconsent]' },
    })
    const convo = await makeDirectConversation(sender.id, recipient.id)
    const message = await makeMessage(convo.id, sender.id)

    const { sent } = await runChatMessagePush(message.id)
    expect(sent).toBe(0)
  })

  it('não envia com consentimento revogado', async () => {
    const sender = await makeUser()
    const recipient = await makePushableUser()
    await testPrisma.userConsent.update({
      where: { userId: recipient.id },
      data: { revokedAt: new Date() },
    })
    const convo = await makeDirectConversation(sender.id, recipient.id)
    const message = await makeMessage(convo.id, sender.id)

    const { sent } = await runChatMessagePush(message.id)
    expect(sent).toBe(0)
  })

  it('não envia quando há bloqueio em qualquer direção', async () => {
    for (const direction of ['recipient-blocks', 'sender-blocks'] as const) {
      const sender = await makeUser()
      const recipient = await makePushableUser()
      if (direction === 'recipient-blocks') {
        await makeBlock(recipient.id, sender.id)
      } else {
        await makeBlock(sender.id, recipient.id)
      }
      const convo = await makeDirectConversation(sender.id, recipient.id)
      const message = await makeMessage(convo.id, sender.id)

      const { sent } = await runChatMessagePush(message.id)
      expect(sent).toBe(0)
    }
  })

  it('não envia para mensagem apagada nem de sistema', async () => {
    const sender = await makeUser()
    const recipient = await makePushableUser()
    const convo = await makeDirectConversation(sender.id, recipient.id)

    const deleted = await makeMessage(convo.id, sender.id)
    await testPrisma.message.update({
      where: { id: deleted.id },
      data: { deletedAt: new Date() },
    })
    expect((await runChatMessagePush(deleted.id)).sent).toBe(0)

    const system = await makeMessage(convo.id, sender.id)
    await testPrisma.message.update({
      where: { id: system.id },
      data: { type: 'SYSTEM' },
    })
    expect((await runChatMessagePush(system.id)).sent).toBe(0)
  })

  it('mensagem inexistente é no-op', async () => {
    const { sent } = await runChatMessagePush(crypto.randomUUID())
    expect(sent).toBe(0)
  })

  it('trunca corpo longo', async () => {
    const sender = await makeUser()
    const recipient = await makePushableUser()
    const convo = await makeDirectConversation(sender.id, recipient.id)
    const message = await makeMessage(convo.id, sender.id, {
      content: 'a'.repeat(300),
    })

    await runChatMessagePush(message.id)
    expect(fakePush.sent[0].body?.length).toBeLessThanOrEqual(121)
    expect(fakePush.sent[0].body?.endsWith('…')).toBe(true)
  })

  it('anexo sem texto vira placeholder no corpo', async () => {
    const sender = await makeUser()
    const recipient = await makePushableUser()
    const convo = await makeDirectConversation(sender.id, recipient.id)
    const message = await makeMessage(convo.id, sender.id, { content: null })
    await testPrisma.messageAttachment.create({
      data: {
        messageId: message.id,
        kind: 'IMAGE',
        url: 'https://cdn.test/img.jpg',
        key: 'chat/img',
        format: 'jpg',
        size: 1024,
        order: 0,
      },
    })

    await runChatMessagePush(message.id)
    expect(fakePush.sent[0].body).toBe('📷 Foto')
  })
})

describe('runChatMessagePush — grupo', () => {
  it('usa título do grupo e prefixa o remetente; só quem está atrás recebe', async () => {
    const sender = await makeUser()
    const behind = await makePushableUser()
    const covered = await makePushableUser()
    const left = await makePushableUser()
    const convo = await makeGroupConversation(
      sender.id,
      [behind.id, covered.id, left.id],
      { title: 'Resenha' },
    )
    await markDelivered(convo.id, covered.id, new Date(Date.now() + 1000))
    await testPrisma.conversationParticipant.updateMany({
      where: { conversationId: convo.id, userId: left.id },
      data: { leftAt: new Date() },
    })
    const message = await makeMessage(convo.id, sender.id, { content: 'bora?' })

    const { sent } = await runChatMessagePush(message.id)

    expect(sent).toBe(1)
    expect(fakePush.sent[0]).toMatchObject({
      to: `ExponentPushToken[${behind.id}]`,
      title: 'Resenha',
      body: `${sender.name} ${sender.lastname}`.trim().concat(': bora?'),
    })
  })
})
