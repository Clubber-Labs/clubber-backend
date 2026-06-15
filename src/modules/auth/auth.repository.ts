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
