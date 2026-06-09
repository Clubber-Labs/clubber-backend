import { describe, expect, it } from 'vitest'
import {
  makeBlock,
  makeComment,
  makeEvent,
  makeFollow,
  makeUser,
} from '../../test/factories'
import { testPrisma } from '../../test/prisma'
import { reconcileAccountDeletions } from './account-deletion.reconciler'

function past(ms: number) {
  return new Date(Date.now() - ms)
}

function future(ms: number) {
  return new Date(Date.now() + ms)
}

describe('reconcileAccountDeletions', () => {
  it('anonimiza conta vencida: PII zerada, conteúdo próprio apagado, comentário alheio mantido', async () => {
    const otherOwner = await makeUser()
    const otherEvent = await makeEvent(otherOwner.id)
    const user = await makeUser({
      accountStatus: 'PENDING_DELETION',
      deactivatedAt: past(31 * 86_400_000),
      scheduledDeletionAt: past(86_400_000),
    })
    const ownEvent = await makeEvent(user.id)
    const comment = await makeComment(
      user.id,
      otherEvent.id,
      'em evento alheio',
    )

    const result = await reconcileAccountDeletions()
    expect(result.anonymized).toBe(1)

    const reloaded = await testPrisma.user.findUnique({
      where: { id: user.id },
    })
    expect(reloaded?.accountStatus).toBe('ANONYMIZED')
    expect(reloaded?.anonymizedAt).not.toBeNull()
    expect(reloaded?.scheduledDeletionAt).toBeNull()
    expect(reloaded?.email).toBe(`deleted+${user.id}@deleted.invalid`)
    expect(reloaded?.username).toBe(`deleted_${user.id}`)
    expect(reloaded?.password).toBeNull()
    expect(reloaded?.name).toBe('Usuário')
    expect(reloaded?.lastname).toBe('Excluído')

    // Conteúdo próprio standalone removido.
    expect(
      await testPrisma.event.findUnique({ where: { id: ownEvent.id } }),
    ).toBeNull()
    // Conteúdo em espaço alheio preservado (exibido como "Usuário Excluído").
    expect(
      await testPrisma.comment.findUnique({ where: { id: comment.id } }),
    ).not.toBeNull()
  })

  it('não processa conta com carência no futuro', async () => {
    const user = await makeUser({
      accountStatus: 'PENDING_DELETION',
      scheduledDeletionAt: future(86_400_000),
    })

    const result = await reconcileAccountDeletions()

    expect(result.due).toBe(0)
    const reloaded = await testPrisma.user.findUnique({
      where: { id: user.id },
    })
    expect(reloaded?.accountStatus).toBe('PENDING_DELETION')
  })

  it('é idempotente: a segunda passada não reprocessa', async () => {
    await makeUser({
      accountStatus: 'PENDING_DELETION',
      scheduledDeletionAt: past(1000),
    })

    const first = await reconcileAccountDeletions()
    expect(first.anonymized).toBe(1)

    const second = await reconcileAccountDeletions()
    expect(second.due).toBe(0)
  })

  it('não toca contas ACTIVE ou DEACTIVATED', async () => {
    const active = await makeUser()
    const deactivated = await makeUser({ accountStatus: 'DEACTIVATED' })

    await reconcileAccountDeletions()

    expect(
      (await testPrisma.user.findUnique({ where: { id: active.id } }))
        ?.accountStatus,
    ).toBe('ACTIVE')
    expect(
      (await testPrisma.user.findUnique({ where: { id: deactivated.id } }))
        ?.accountStatus,
    ).toBe('DEACTIVATED')
  })

  it('remove bloqueios FEITOS pela conta anonimizada e mantém os CONTRA ela', async () => {
    const user = await makeUser({
      accountStatus: 'PENDING_DELETION',
      scheduledDeletionAt: past(1000),
    })
    const blockedByUser = await makeUser()
    const blockerOfUser = await makeUser()
    await makeBlock(user.id, blockedByUser.id) // feito pelo usuário → remove
    await makeBlock(blockerOfUser.id, user.id) // contra o usuário → mantém

    await reconcileAccountDeletions()

    const outgoing = await testPrisma.block.findMany({
      where: { blockerId: user.id },
    })
    const incoming = await testPrisma.block.findMany({
      where: { blockedId: user.id },
    })
    expect(outgoing).toHaveLength(0)
    expect(incoming).toHaveLength(1)
  })

  it('decrementa o followersCount de quem a conta anonimizada seguia', async () => {
    const user = await makeUser({
      accountStatus: 'PENDING_DELETION',
      scheduledDeletionAt: past(1000),
    })
    const friend = await makeUser()
    await makeFollow(user.id, friend.id)
    await testPrisma.user.update({
      where: { id: friend.id },
      data: { followersCount: 1 },
    })

    await reconcileAccountDeletions()

    const reloaded = await testPrisma.user.findUnique({
      where: { id: friend.id },
    })
    expect(reloaded?.followersCount).toBe(0)
  })
})
