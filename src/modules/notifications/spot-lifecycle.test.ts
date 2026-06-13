import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { realtime } from '../../lib/realtime'
import { makeSpot, makeUser } from '../../test/factories'
import { fakePush } from '../../test/fake-push'
import { testPrisma } from '../../test/prisma'
import { renewSpotById } from '../spots/spots.repository'
import {
  runSpotCleanup,
  runSpotRenewalReminders,
} from './spot-lifecycle.reconciler'

const LEAD_MS = 60 * 60 * 1000 // 1h

beforeEach(() => {
  vi.spyOn(realtime, 'publishNotification').mockResolvedValue(undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  fakePush.reset()
})
afterAll(async () => {
  await testPrisma.$disconnect()
})

const soon = () => new Date(Date.now() + 30 * 60 * 1000) // vence em 30min
const past = () => new Date(Date.now() - 1000)

describe('runSpotRenewalReminders (SPOT_RENEWAL)', () => {
  it('lembra o criador de um spot vencendo dentro do lead', async () => {
    const creator = await makeUser()
    const spot = await makeSpot(creator.id, { endsAt: soon() })

    const { reminded } = await runSpotRenewalReminders(new Date(), LEAD_MS)

    expect(reminded).toBe(1)
    const n = await testPrisma.notification.findFirst({
      where: { userId: creator.id, type: 'SPOT_RENEWAL', spotId: spot.id },
    })
    expect(n).not.toBeNull()
    // Marcou o lembrete (não re-notifica a mesma janela).
    const after = await testPrisma.spot.findUnique({ where: { id: spot.id } })
    expect(after?.renewalNotifiedAt).not.toBeNull()
  })

  it('não lembra spot que vence depois do lead', async () => {
    const creator = await makeUser()
    await makeSpot(creator.id, { endsAt: new Date(Date.now() + 3 * 3600_000) })

    const { reminded } = await runSpotRenewalReminders(new Date(), LEAD_MS)
    expect(reminded).toBe(0)
  })

  it('é idempotente: segundo tick não re-lembra a mesma janela', async () => {
    const creator = await makeUser()
    const spot = await makeSpot(creator.id, { endsAt: soon() })

    await runSpotRenewalReminders(new Date(), LEAD_MS)
    const second = await runSpotRenewalReminders(new Date(), LEAD_MS)

    expect(second.reminded).toBe(0)
    expect(
      await testPrisma.notification.count({
        where: { type: 'SPOT_RENEWAL', spotId: spot.id },
      }),
    ).toBe(1)
  })

  it('não lembra spot cancelado nem já encerrado', async () => {
    const creator = await makeUser()
    await makeSpot(creator.id, { endsAt: soon(), canceledAt: new Date() })
    await makeSpot(creator.id, {
      startsAt: new Date(Date.now() - 2 * 3600_000),
      endsAt: past(),
    })

    const { reminded } = await runSpotRenewalReminders(new Date(), LEAD_MS)
    expect(reminded).toBe(0)
  })

  it('re-arma após renovar: novo lembrete na nova janela', async () => {
    const creator = await makeUser()
    const spot = await makeSpot(creator.id, { endsAt: soon() })

    await runSpotRenewalReminders(new Date(), LEAD_MS) // 1º lembrete
    // Renova: endsAt += 24h e renewalNotifiedAt zerado.
    await renewSpotById(spot.id)
    // Lead largo o bastante para pegar a nova janela (~24h30min).
    const second = await runSpotRenewalReminders(new Date(), 25 * 3600_000)

    expect(second.reminded).toBe(1)
    expect(
      await testPrisma.notification.count({
        where: { type: 'SPOT_RENEWAL', spotId: spot.id },
      }),
    ).toBe(2) // uma por janela
  })
})

describe('runSpotCleanup', () => {
  it('spot encerrado e VAZIO: apaga spot + conversa', async () => {
    const creator = await makeUser()
    const spot = await makeSpot(creator.id, {
      startsAt: new Date(Date.now() - 2 * 3600_000),
      endsAt: past(),
    })

    const { deleted } = await runSpotCleanup(new Date())

    expect(deleted).toBe(1)
    expect(
      await testPrisma.spot.findUnique({ where: { id: spot.id } }),
    ).toBeNull()
    expect(
      await testPrisma.conversation.findUnique({
        where: { id: spot.conversationId },
      }),
    ).toBeNull()
  })

  it('spot encerrado e POPULADO: apaga só o spot, mantém a conversa', async () => {
    const creator = await makeUser()
    const member = await makeUser()
    const spot = await makeSpot(creator.id, {
      memberIds: [member.id],
      startsAt: new Date(Date.now() - 2 * 3600_000),
      endsAt: past(),
    })

    const { deleted, graduated } = await runSpotCleanup(new Date())

    expect(deleted).toBe(0)
    expect(graduated).toBe(1)
    expect(
      await testPrisma.spot.findUnique({ where: { id: spot.id } }),
    ).toBeNull()
    // A conversa sobrevive como grupo normal.
    expect(
      await testPrisma.conversation.findUnique({
        where: { id: spot.conversationId },
      }),
    ).not.toBeNull()
  })

  it('spot cancelado e vazio também é limpo', async () => {
    const creator = await makeUser()
    const spot = await makeSpot(creator.id, { canceledAt: new Date() })

    const { deleted } = await runSpotCleanup(new Date())
    expect(deleted).toBe(1)
    expect(
      await testPrisma.spot.findUnique({ where: { id: spot.id } }),
    ).toBeNull()
  })

  it('spot ativo não é tocado', async () => {
    const creator = await makeUser()
    const spot = await makeSpot(creator.id) // ativo (endsAt futuro)

    const { deleted, graduated } = await runSpotCleanup(new Date())
    expect(deleted + graduated).toBe(0)
    expect(
      await testPrisma.spot.findUnique({ where: { id: spot.id } }),
    ).not.toBeNull()
  })

  it('é idempotente: segundo tick não erra', async () => {
    const creator = await makeUser()
    await makeSpot(creator.id, {
      startsAt: new Date(Date.now() - 2 * 3600_000),
      endsAt: past(),
    })

    await runSpotCleanup(new Date())
    const second = await runSpotCleanup(new Date())
    expect(second.deleted + second.graduated).toBe(0)
  })
})
