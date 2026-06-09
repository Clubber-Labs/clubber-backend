import { prisma } from '../../lib/prisma'

export async function findUserByEmailForReset(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: { id: true, accountStatus: true },
  })
}

/** Código vigente do usuário: não usado e não expirado, mais recente primeiro. */
export async function findActiveCodeByUser(userId: string) {
  return prisma.passwordResetCode.findFirst({
    where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Cria um novo código para o usuário, a menos que já exista um código ativo
 * criado há menos de `cooldownMs` — nesse caso retorna false (no-op). Apaga os
 * códigos não usados antes de criar (só um código ativo por vez). Tudo dentro de
 * um advisory lock por usuário (liberado no fim da transação), serializando
 * requisições concorrentes do mesmo usuário: sem ele, dois requests poderiam
 * passar a checagem de cooldown e criar dois códigos ativos. Mesmo padrão do
 * lock de cota de mídia em chat.repository.
 */
export async function createCodeIfNoneActive(
  userId: string,
  codeHash: string,
  expiresAt: Date,
  cooldownMs: number,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    // Chave de 64 bits do md5 do userId (hashtext seria int4 e colidiria à toa).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(('x' || md5(${userId}))::bit(64)::bigint)`

    const active = await tx.passwordResetCode.findFirst({
      where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })
    if (active && Date.now() - active.createdAt.getTime() < cooldownMs) {
      return false
    }

    await tx.passwordResetCode.deleteMany({ where: { userId, usedAt: null } })
    await tx.passwordResetCode.create({ data: { userId, codeHash, expiresAt } })
    return true
  })
}

export async function incrementAttempts(id: string) {
  return prisma.passwordResetCode.update({
    where: { id },
    data: { attempts: { increment: 1 } },
  })
}

/**
 * Consome o código e troca a senha numa única transação. O update do código é
 * condicional a `usedAt: null` (guarda de uso único): se duas requisições
 * concorrerem com o mesmo código, só a primeira casa o WHERE — a segunda recebe
 * count 0 e retorna false (sem trocar a senha duas vezes). Fecha o TOCTOU entre
 * o compare e o markCodeUsed.
 */
export async function consumeCodeAndSetPassword(
  codeId: string,
  userId: string,
  passwordHash: string,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const consumed = await tx.passwordResetCode.updateMany({
      where: { id: codeId, usedAt: null },
      data: { usedAt: new Date() },
    })
    if (consumed.count === 0) return false
    await tx.user.update({
      where: { id: userId },
      data: { password: passwordHash },
    })
    return true
  })
}

/** Expurgo de retenção (LGPD): remove códigos já usados ou expirados. */
export async function deleteExpiredAndUsedCodes(now: Date = new Date()) {
  return prisma.passwordResetCode.deleteMany({
    where: { OR: [{ usedAt: { not: null } }, { expiresAt: { lt: now } }] },
  })
}
