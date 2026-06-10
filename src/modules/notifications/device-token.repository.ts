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

/** Tokens ativos de vários usuários (envio em lote no fan-out). */
export async function findActiveDeviceTokensForUsers(userIds: string[]) {
  if (userIds.length === 0) return []
  return prisma.deviceToken.findMany({
    where: { userId: { in: userIds }, invalidatedAt: null },
    select: { id: true, userId: true, token: true },
  })
}

/**
 * Soft-disable de um token (ex.: DeviceNotRegistered no ticket/receipt). Não
 * apaga — preserva auditoria e permite reativar se o app re-registrar o token.
 */
export async function invalidateDeviceToken(id: string, reason: string) {
  const result = await prisma.deviceToken.updateMany({
    where: { id, invalidatedAt: null },
    data: { invalidatedAt: new Date(), invalidatedReason: reason },
  })
  return result.count
}
