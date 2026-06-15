import { afterAll, describe, expect, it } from 'vitest'
import { makeUser } from '../../test/factories'
import { testPrisma } from '../../test/prisma'
import { describeReconcilerTimer } from '../../test/reconciler-lifecycle'
import {
  reconcilePasswordResetCodes,
  startPasswordResetCleanupReconciler,
  stopPasswordResetCleanupReconciler,
} from './password-reset.reconciler'

afterAll(async () => {
  await testPrisma.$disconnect()
})

const future = () => new Date(Date.now() + 60_000)
const past = () => new Date(Date.now() - 60_000)

// Não há factory para PasswordResetCode — criamos direto (schema simples).
async function makeCode(
  userId: string,
  overrides: { codeHash?: string; expiresAt?: Date; usedAt?: Date | null } = {},
) {
  return testPrisma.passwordResetCode.create({
    data: {
      userId,
      codeHash: overrides.codeHash ?? 'hash',
      expiresAt: overrides.expiresAt ?? future(),
      usedAt: overrides.usedAt ?? null,
    },
  })
}

describe('reconcilePasswordResetCodes', () => {
  it('apaga só os códigos usados quando nenhum venceu', async () => {
    const user = await makeUser()
    await makeCode(user.id, { codeHash: 'u1', usedAt: past() })
    await makeCode(user.id, { codeHash: 'u2', usedAt: past() })
    const active = await makeCode(user.id, { codeHash: 'ativo' })

    const { deleted } = await reconcilePasswordResetCodes()

    expect(deleted).toBe(2)
    const remaining = await testPrisma.passwordResetCode.findMany({
      where: { userId: user.id },
    })
    expect(remaining.map((c) => c.id)).toEqual([active.id])
  })

  it('apaga só os expirados quando nenhum foi usado', async () => {
    const user = await makeUser()
    await makeCode(user.id, { codeHash: 'e1', expiresAt: past() })
    const active = await makeCode(user.id, { codeHash: 'ativo' })

    const { deleted } = await reconcilePasswordResetCodes()

    expect(deleted).toBe(1)
    const remaining = await testPrisma.passwordResetCode.findMany({
      where: { userId: user.id },
    })
    expect(remaining.map((c) => c.id)).toEqual([active.id])
  })

  it('idempotência: segundo run após o expurgo é no-op', async () => {
    const user = await makeUser()
    await makeCode(user.id, { codeHash: 'usado', usedAt: past() })
    await makeCode(user.id, { codeHash: 'exp', expiresAt: past() })
    await makeCode(user.id, { codeHash: 'ativo' })

    const first = await reconcilePasswordResetCodes()
    expect(first.deleted).toBe(2)
    const second = await reconcilePasswordResetCodes()
    expect(second.deleted).toBe(0)
    expect(await testPrisma.passwordResetCode.count()).toBe(1)
  })

  it('respeita o now injetado para decidir o que expirou', async () => {
    const user = await makeUser()
    // Expira daqui a 1min; com um now 2min à frente, já conta como vencido.
    await makeCode(user.id, { codeHash: 'curto', expiresAt: future() })

    const { deleted } = await reconcilePasswordResetCodes(
      new Date(Date.now() + 2 * 60_000),
    )

    expect(deleted).toBe(1)
  })

  it('não toca nos códigos de outro usuário', async () => {
    const u1 = await makeUser()
    const u2 = await makeUser()
    await makeCode(u1.id, { codeHash: 'usado', usedAt: past() })
    await makeCode(u2.id, { codeHash: 'ativo' })

    const { deleted } = await reconcilePasswordResetCodes()

    expect(deleted).toBe(1)
    expect(
      await testPrisma.passwordResetCode.count({ where: { userId: u2.id } }),
    ).toBe(1)
  })
})

describeReconcilerTimer('password-reset-cleanup', {
  start: () => startPasswordResetCleanupReconciler(60_000),
  stop: stopPasswordResetCleanupReconciler,
  intervalMs: 60_000,
})
