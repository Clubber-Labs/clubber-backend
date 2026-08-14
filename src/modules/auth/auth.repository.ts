import { prisma } from '../../lib/prisma'

// O identificador (e-mail ou username) é resolvido para o id em
// findUserIdByIdentifier (users.repository), que compara por lower().
export async function findUserForLogin(id: string) {
  return prisma.user.findUnique({
    where: { id },
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
// revogar" (duas trocas paralelas gerariam duas famílias válidas). Marca
// `rotatedAt` no MESMO update: assinatura à prova de corrida de "revogado por
// ROTAÇÃO" (≠ logout/reset, que não setam) — sem depender do encadeamento do
// sucessor, que só é gravado depois. Quem perde o claim relê o estado ATUAL (o
// `record` do find inicial pode estar defasado se outra requisição revogou em
// paralelo) para classificar reuso/carência/expirado com dado fresco.
export async function claimRefreshToken(tokenHash: string) {
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash } })
  if (!record) return { record: null, claimed: false }
  const now = new Date()
  const result = await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
    data: { revokedAt: now, rotatedAt: now },
  })
  // `record` é o snapshot PRÉ-update: no claim vencedor só `id` e `userId` são
  // confiáveis (revokedAt/rotatedAt ainda valem null aqui, não o `now` recém-gravado).
  if (result.count > 0) return { record, claimed: true }
  const current = await prisma.refreshToken.findUnique({ where: { tokenHash } })
  return { record: current ?? record, claimed: false }
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
