import Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stripe } from '../../lib/stripe'
import {
  makeBlock,
  makeComment,
  makeEvent,
  makeFollow,
  makeSubscription,
  makeUser,
} from '../../test/factories'
import { testPrisma } from '../../test/prisma'
import { describeReconcilerTimer } from '../../test/reconciler-lifecycle'
import {
  reconcileAccountDeletions,
  startAccountDeletionReconciler,
  stopAccountDeletionReconciler,
} from './account-deletion.reconciler'
import { anonymizeAccount } from './users.service'

// A anonimização encerra o billing no Stripe (terminateBillingForUser) antes
// da tx local. Mock do singleton — sem rede em teste; contas sem
// stripeCustomerId nem chegam a tocá-lo (no-op), então os testes antigos
// seguem inalterados.
vi.mock('../../lib/stripe', () => ({
  STRIPE_API_VERSION: 'test',
  stripe: { customers: { del: vi.fn() } },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

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

  it('encerra billing: deleta Customer no Stripe, limpa vínculo e remove subscriptions', async () => {
    const user = await makeUser({
      isPremium: true,
      accountStatus: 'PENDING_DELETION',
      scheduledDeletionAt: past(1000),
    })
    await testPrisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: 'cus_lgpd' },
    })
    await makeSubscription(user.id, { status: 'ACTIVE' })
    vi.mocked(stripe.customers.del).mockResolvedValue({} as never)

    const result = await reconcileAccountDeletions()
    expect(result.anonymized).toBe(1)

    // Customer deletado no gateway (cancela subscriptions + remove PII de lá).
    expect(stripe.customers.del).toHaveBeenCalledWith('cus_lgpd')

    const reloaded = await testPrisma.user.findUnique({
      where: { id: user.id },
    })
    expect(reloaded?.accountStatus).toBe('ANONYMIZED')
    expect(reloaded?.stripeCustomerId).toBeNull()
    expect(reloaded?.isPremium).toBe(false)
    expect(
      await testPrisma.subscription.count({ where: { userId: user.id } }),
    ).toBe(0)
  })

  it('falha no Stripe NÃO anonimiza: conta segue PENDING_DELETION pro retry do próximo tick', async () => {
    const user = await makeUser({
      accountStatus: 'PENDING_DELETION',
      scheduledDeletionAt: past(1000),
    })
    await testPrisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: 'cus_fail' },
    })
    const sub = await makeSubscription(user.id, { status: 'ACTIVE' })
    // Erro real do SDK (não Error genérico): em produção a falha de gateway
    // atravessa o wrapStripeError e vira { statusCode: 502 } — o teste deve
    // exercitar esse caminho, não o re-throw de erro desconhecido.
    vi.mocked(stripe.customers.del).mockRejectedValue(
      new Stripe.errors.StripeAPIError({
        message: 'stripe indisponível',
        // biome-ignore lint/suspicious/noExplicitAny: construtor raw do SDK
      } as any),
    )

    const result = await reconcileAccountDeletions()

    expect(result.due).toBe(1)
    expect(result.anonymized).toBe(0)
    const reloaded = await testPrisma.user.findUnique({
      where: { id: user.id },
    })
    // Nada parcial: PII intacta, billing intacto — tudo ou nada por tick.
    expect(reloaded?.accountStatus).toBe('PENDING_DELETION')
    expect(reloaded?.email).toBe(user.email)
    expect(reloaded?.stripeCustomerId).toBe('cus_fail')
    expect(
      await testPrisma.subscription.findUnique({ where: { id: sub.id } }),
    ).not.toBeNull()
  })

  it('corrida de reativação: guard da tx vence, mas o ponteiro do Customer deletado é limpo', async () => {
    // Simula o login vencendo a corrida: a conta foi listada como due, mas já
    // voltou a ACTIVE quando a anonimização roda. O Customer é deletado no
    // Stripe ANTES do guard — sem o reparo, o ponteiro morto sobraria e o
    // próximo checkout usaria um Customer inexistente (500 no gateway).
    const user = await makeUser({ isPremium: true })
    await testPrisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: 'cus_race' },
    })
    const sub = await makeSubscription(user.id, { status: 'ACTIVE' })
    vi.mocked(stripe.customers.del).mockResolvedValue({} as never)

    const ok = await anonymizeAccount(user.id, { error: () => {} })

    expect(ok).toBe(false)
    const reloaded = await testPrisma.user.findUnique({
      where: { id: user.id },
    })
    // Login venceu: nada de anonimização.
    expect(reloaded?.accountStatus).toBe('ACTIVE')
    expect(reloaded?.email).toBe(user.email)
    // Reparo: ponteiro morto limpo — próximo checkout cria Customer novo.
    expect(reloaded?.stripeCustomerId).toBeNull()
    // Subscription local fica: o webhook customer.subscription.deleted a acha
    // pelo stripeSubscriptionId (sem depender do ponteiro) e rebaixa isPremium.
    expect(
      await testPrisma.subscription.findUnique({ where: { id: sub.id } }),
    ).not.toBeNull()
  })
})

describeReconcilerTimer('account-deletion', {
  start: () => startAccountDeletionReconciler(60_000),
  stop: stopAccountDeletionReconciler,
  intervalMs: 60_000,
})
