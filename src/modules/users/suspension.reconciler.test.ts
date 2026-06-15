import { afterAll, describe, expect, it } from 'vitest'
import { makeUser } from '../../test/factories'
import { testPrisma } from '../../test/prisma'
import { describeReconcilerTimer } from '../../test/reconciler-lifecycle'
import {
  reconcileSuspensions,
  startSuspensionReconciler,
  stopSuspensionReconciler,
} from './suspension.reconciler'

afterAll(async () => {
  await testPrisma.$disconnect()
})

const past = () => new Date(Date.now() - 60_000)
const future = () => new Date(Date.now() + 86_400_000)

// A factory não expõe os campos de moderação — setamos direto após criar.
async function makeSuspended(suspendedUntil: Date) {
  const user = await makeUser()
  await testPrisma.user.update({
    where: { id: user.id },
    data: {
      accountStatus: 'SUSPENDED',
      suspendedAt: new Date(Date.now() - 7 * 86_400_000),
      suspendedUntil,
      suspensionReason: 'teste',
    },
  })
  return user
}

async function makeBanned() {
  const user = await makeUser()
  await testPrisma.user.update({
    where: { id: user.id },
    data: { accountStatus: 'BANNED', suspendedUntil: null },
  })
  return user
}

async function statusOf(id: string) {
  const u = await testPrisma.user.findUnique({
    where: { id },
    select: { accountStatus: true },
  })
  return u?.accountStatus
}

describe('reconcileSuspensions', () => {
  it('reativa suspensão vencida: SUSPENDED -> ACTIVE e zera os campos', async () => {
    const user = await makeSuspended(past())

    const result = await reconcileSuspensions()

    expect(result).toMatchObject({ due: 1, unsuspended: 1 })
    const reloaded = await testPrisma.user.findUnique({
      where: { id: user.id },
      select: {
        accountStatus: true,
        suspendedAt: true,
        suspendedUntil: true,
        suspensionReason: true,
      },
    })
    expect(reloaded?.accountStatus).toBe('ACTIVE')
    expect(reloaded?.suspendedAt).toBeNull()
    expect(reloaded?.suspendedUntil).toBeNull()
    expect(reloaded?.suspensionReason).toBeNull()
  })

  it('não toca suspensão ainda vigente (suspendedUntil no futuro)', async () => {
    const user = await makeSuspended(future())

    const result = await reconcileSuspensions()

    expect(result).toMatchObject({ due: 0, unsuspended: 0 })
    expect(await statusOf(user.id)).toBe('SUSPENDED')
  })

  it('nunca reativa conta BANNED (banimento é permanente)', async () => {
    const user = await makeBanned()

    const result = await reconcileSuspensions()

    expect(result).toMatchObject({ due: 0, unsuspended: 0 })
    expect(await statusOf(user.id)).toBe('BANNED')
  })

  it('ignora conta ACTIVE mesmo com suspendedUntil no passado', async () => {
    // Estado defensivo: o WHERE filtra por accountStatus SUSPENDED, não pela data.
    const user = await makeUser()
    await testPrisma.user.update({
      where: { id: user.id },
      data: { suspendedUntil: past() },
    })

    const result = await reconcileSuspensions()

    expect(result.due).toBe(0)
    expect(await statusOf(user.id)).toBe('ACTIVE')
  })

  it('lote misto: reativa só as vencidas, ignora vigente e banida', async () => {
    const expired = await makeSuspended(past())
    const stillSuspended = await makeSuspended(future())
    const banned = await makeBanned()

    const result = await reconcileSuspensions()

    expect(result).toMatchObject({ due: 1, unsuspended: 1 })
    expect(await statusOf(expired.id)).toBe('ACTIVE')
    expect(await statusOf(stillSuspended.id)).toBe('SUSPENDED')
    expect(await statusOf(banned.id)).toBe('BANNED')
  })

  it('idempotência: segundo run não encontra mais nada', async () => {
    await makeSuspended(past())

    const first = await reconcileSuspensions()
    expect(first.unsuspended).toBe(1)
    const second = await reconcileSuspensions()
    expect(second).toMatchObject({ due: 0, unsuspended: 0 })
  })

  it('respeita o now injetado (lte inclusivo no limiar)', async () => {
    const user = await makeSuspended(future()) // vence só amanhã
    // Com um now 2 dias à frente, a suspensão já conta como vencida.
    const result = await reconcileSuspensions(
      new Date(Date.now() + 2 * 86_400_000),
    )

    expect(result).toMatchObject({ due: 1, unsuspended: 1 })
    expect(await statusOf(user.id)).toBe('ACTIVE')
  })
})

describeReconcilerTimer('suspension', {
  start: () => startSuspensionReconciler(60_000),
  stop: stopSuspensionReconciler,
  intervalMs: 60_000,
})
