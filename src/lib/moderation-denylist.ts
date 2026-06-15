import { prisma } from './prisma'
import { redis } from './redis'

// Denylist de moderação: SET Redis com os IDs de usuários SUSPENDED/BANNED.
// Os JWTs do projeto não expiram (o mobile fica logado), e `authenticate` não
// faz lookup no banco — então bloquear só o login novo não impede a sessão
// existente de agir. Este índice é checado a cada request autenticado (O(1)
// via SISMEMBER) para barrar tokens de contas punidas de imediato.
//
// Fonte da verdade é o banco (User.accountStatus); o Redis é só o índice rápido,
// repopulado no boot via `rebuildFromDb`. Sem Redis, `isBlocked` degrada para
// `false` (o bloqueio de login + a ocultação por accountStatus seguem valendo).

const KEY = 'moderation:blocked'

function logErr(op: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  console.warn(`[moderation-denylist] ${op} falhou: ${message}`)
}

export async function block(userId: string): Promise<void> {
  if (!redis) return
  try {
    await redis.sadd(KEY, userId)
  } catch (err) {
    logErr('block', err)
  }
}

export async function unblock(userId: string): Promise<void> {
  if (!redis) return
  try {
    await redis.srem(KEY, userId)
  } catch (err) {
    logErr('unblock', err)
  }
}

export async function isBlocked(userId: string): Promise<boolean> {
  if (!redis) return false
  try {
    return (await redis.sismember(KEY, userId)) === 1
  } catch (err) {
    logErr('isBlocked', err)
    return false
  }
}

// Repopula o SET a partir do banco — chamado no boot do servidor para sobreviver
// a restarts e a flush do Redis. Idempotente (recria o SET do zero).
export async function rebuildFromDb(): Promise<number> {
  if (!redis) return 0
  try {
    const punished = await prisma.user.findMany({
      where: { accountStatus: { in: ['SUSPENDED', 'BANNED'] } },
      select: { id: true },
    })
    // MULTI/EXEC (atômico): del + sadd na mesma transação, sem janela em que o
    // SET fica vazio e um ban escaparia entre os dois comandos no boot.
    const multi = redis.multi()
    multi.del(KEY)
    if (punished.length > 0) {
      multi.sadd(KEY, ...punished.map((u) => u.id))
    }
    await multi.exec()
    return punished.length
  } catch (err) {
    logErr('rebuildFromDb', err)
    return 0
  }
}
