import { prisma } from '../../lib/prisma'

export type NewPushTicket = {
  deviceTokenId: string
  receiptId?: string | null
  status: string
  error?: string | null
}

export async function createPushTickets(tickets: NewPushTicket[]) {
  if (tickets.length === 0) return 0
  const result = await prisma.pushTicket.createMany({ data: tickets })
  return result.count
}

/**
 * Tickets PENDING com receiptId, criados antes do corte (maduros para checar o
 * receipt). Limitado para o reconciler processar em lotes.
 */
export async function findPendingReceipts(cutoff: Date, limit: number) {
  return prisma.pushTicket.findMany({
    where: {
      status: 'PENDING',
      receiptId: { not: null },
      createdAt: { lt: cutoff },
    },
    select: { id: true, receiptId: true, deviceTokenId: true },
    take: limit,
  })
}

export async function updatePushTicketStatus(
  id: string,
  status: string,
  error?: string | null,
) {
  return prisma.pushTicket.update({
    where: { id },
    data: { status, error: error ?? null },
  })
}

/** Expurgo de tickets antigos (já reconciliados ou obsoletos). */
export async function deletePushTicketsOlderThan(cutoff: Date) {
  const result = await prisma.pushTicket.deleteMany({
    where: { createdAt: { lt: cutoff } },
  })
  return result.count
}
