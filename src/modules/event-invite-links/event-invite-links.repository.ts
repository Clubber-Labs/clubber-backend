import { visibleAuthorWhere } from '../../lib/account-visibility'
import { prisma } from '../../lib/prisma'

export async function findEventForLink(eventId: string) {
  return prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      authorId: true,
      isPublic: true,
      date: true,
      endDate: true,
      canceledAt: true,
    },
  })
}

/**
 * "Reusa o vigente ou cria" numa transação atrás de advisory lock por evento —
 * mesmo padrão do teto de spots (spots.repository): sob READ COMMITTED, dois
 * POSTs concorrentes leriam ambos "nenhum link ativo" e criariam dois. O lock
 * serializa a criação do MESMO evento; o token vindo do caller só é usado
 * quando o create de fato acontece.
 */
export async function findOrCreateActiveLink(
  eventId: string,
  data: { token: string; createdById: string; expiresAt: Date },
  now: Date,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invite_link:${eventId}`}))`
    const existing = await tx.eventInviteLink.findFirst({
      where: { eventId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    })
    if (existing) return { link: existing, created: false }
    const link = await tx.eventInviteLink.create({ data: { eventId, ...data } })
    return { link, created: true }
  })
}

export async function findLinksByEvent(eventId: string) {
  return prisma.eventInviteLink.findMany({
    where: { eventId },
    orderBy: { createdAt: 'desc' },
  })
}

export async function findLinkById(linkId: string) {
  return prisma.eventInviteLink.findUnique({ where: { id: linkId } })
}

export async function revokeLink(linkId: string, now: Date) {
  return prisma.eventInviteLink.update({
    where: { id: linkId },
    data: { revokedAt: now },
  })
}

/**
 * Link + evento para preview/aceite. O filtro de autor visível fica na QUERY
 * (autor banido/desativado → null → 404), igual ao findEventById.
 */
export async function findLinkByToken(token: string) {
  return prisma.eventInviteLink.findFirst({
    where: { token, event: { author: visibleAuthorWhere() } },
    include: {
      event: {
        select: {
          id: true,
          title: true,
          description: true,
          date: true,
          endDate: true,
          timezone: true,
          isPublic: true,
          canceledAt: true,
          authorId: true,
          author: {
            select: {
              id: true,
              name: true,
              lastname: true,
              username: true,
              avatarUrl: true,
            },
          },
          images: {
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
            take: 1,
            select: { url: true },
          },
        },
      },
    },
  })
}

/**
 * Materializa o convite e conta o uso na mesma transação. skipDuplicates torna
 * o aceite idempotente sob corrida: só o create que de fato inseriu incrementa.
 */
export async function acceptLink(
  linkId: string,
  eventId: string,
  inviterId: string,
  invitedId: string,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const created = await tx.eventInvite.createMany({
      data: [{ eventId, inviterId, invitedId }],
      skipDuplicates: true,
    })
    if (created.count > 0) {
      await tx.eventInviteLink.update({
        where: { id: linkId },
        data: { usesCount: { increment: 1 } },
      })
    }
    return created.count > 0
  })
}
