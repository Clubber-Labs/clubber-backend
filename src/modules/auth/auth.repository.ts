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

// Status da conta para a guarda do refresh (conta ANONYMIZED não renova sessão).
export async function findUserAccountStatus(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: { accountStatus: true },
  })
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

// Reivindica o refresh para rotação de forma ATÔMICA: lê o registro e tenta
// revogá-lo numa só passada. O `updateMany` condicional (`revokedAt: null` +
// não expirado) é a porta atômica — entre N requisições concorrentes com o mesmo
// token, só UMA recebe `count > 0`. Isso fecha a corrida de "validar e só depois
// revogar" (duas trocas paralelas gerariam duas famílias válidas). `record`
// (lido antes do update) serve pra distinguir reuso (já revogado) de expirado.
export async function claimRefreshToken(tokenHash: string) {
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash } })
  if (!record) return { record: null, claimed: false }
  const result = await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { revokedAt: new Date() },
  })
  return { record, claimed: result.count > 0 }
}

// Encadeia o sucessor na cadeia de rotação (o antigo já foi revogado no claim).
export async function linkRefreshTokenSuccessor(
  id: string,
  replacedByTokenId: string,
) {
  return prisma.refreshToken.update({
    where: { id },
    data: { replacedByTokenId },
  })
}

// Revoga um refresh pelo hash, restrito ao dono (logout). updateMany torna a
// operação idempotente (0 linhas se já revogado / inexistente).
export async function revokeRefreshTokenByHash(
  tokenHash: string,
  userId: string,
) {
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
