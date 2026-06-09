import { prisma } from '../../lib/prisma'

/**
 * Registra (ou reativa) um device token de push. Upsert pelo token único: se o
 * mesmo device re-registrar — inclusive logando com OUTRA conta —, o token migra
 * de dono e é reativado (limpa invalidatedAt). Evita duplicar e ressuscita um
 * token que tinha sido soft-disabled por engano.
 */
export async function registerDeviceToken(
  userId: string,
  token: string,
  platform?: string,
) {
  return prisma.deviceToken.upsert({
    where: { token },
    create: { userId, token, platform },
    update: {
      userId,
      platform,
      invalidatedAt: null,
      invalidatedReason: null,
    },
  })
}

/** Remove um token do usuário (logout por device). */
export async function deleteDeviceToken(userId: string, token: string) {
  const result = await prisma.deviceToken.deleteMany({
    where: { token, userId },
  })
  return result.count
}

/** Tokens ativos do usuário — base do envio de push (entrega 5). */
export async function findActiveDeviceTokens(userId: string) {
  return prisma.deviceToken.findMany({
    where: { userId, invalidatedAt: null },
  })
}
