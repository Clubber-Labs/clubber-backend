import { prisma } from '../../lib/prisma'

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
  })
}

// Recovery codes não são lidos em memória — o consumo é direto no banco
// (consumeRecoveryCode). Não buscar os hashes evita trazer dado sensível à toa.
const mfaSelect = {
  id: true,
  email: true,
  role: true,
  mfaEnabled: true,
  mfaSecret: true,
} as const

export async function findUserMfaById(id: string) {
  return prisma.user.findUnique({ where: { id }, select: mfaSelect })
}

export async function updateUserMfa(
  id: string,
  data: {
    mfaEnabled?: boolean
    mfaSecret?: string | null
    mfaRecoveryCodes?: string[]
  },
) {
  return prisma.user.update({
    where: { id },
    data,
    select: { id: true, mfaEnabled: true },
  })
}

// ── Refresh tokens (sessão longa, rotativa e revogável) ──────────────────────

export async function createRefreshToken(data: {
  userId: string
  tokenHash: string
  expiresAt: Date
  userAgent?: string | null
  ip?: string | null
}) {
  return prisma.refreshToken.create({ data, select: { id: true } })
}

export async function findRefreshTokenByHash(tokenHash: string) {
  return prisma.refreshToken.findUnique({ where: { tokenHash } })
}

// Revoga um refresh específico e (opcionalmente) registra o sucessor na cadeia
// de rotação.
export async function revokeRefreshTokenById(
  id: string,
  replacedByTokenId?: string,
) {
  return prisma.refreshToken.update({
    where: { id },
    data: { revokedAt: new Date(), replacedByTokenId: replacedByTokenId ?? null },
  })
}

// Revoga um refresh pelo hash, restrito ao dono (logout). updateMany torna a
// operação idempotente (0 linhas se já revogado / inexistente).
export async function revokeRefreshTokenByHash(tokenHash: string, userId: string) {
  return prisma.refreshToken.updateMany({
    where: { tokenHash, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

// Revoga TODAS as sessões ativas do usuário (logout-all, reset de senha,
// disable de MFA, ou defesa contra reuso de token rotacionado).
export async function revokeAllRefreshTokensForUser(userId: string) {
  return prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

// Consome um código de recuperação de forma ATÔMICA. O array_remove + o filtro
// `${hash} = ANY(...)` no mesmo UPDATE adquirem o lock da linha e afetam 0
// linhas se o código já tinha sido consumido — fechando a corrida de dois
// logins concorrentes com o mesmo código (o read-check-write em dois roundtrips
// deixava ambos passarem). Retorna true só para quem de fato removeu o hash.
export async function consumeRecoveryCode(
  id: string,
  hash: string,
): Promise<boolean> {
  const affected = await prisma.$executeRaw`
    UPDATE "users"
    SET "mfaRecoveryCodes" = array_remove("mfaRecoveryCodes", ${hash})
    WHERE "id" = ${id} AND ${hash} = ANY("mfaRecoveryCodes")
  `
  return affected > 0
}
