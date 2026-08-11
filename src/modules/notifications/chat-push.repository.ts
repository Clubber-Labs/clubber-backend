import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'

// NOTA DE LOCALIZAÇÃO: mesmas razões do proximity.repository — a resolução de
// destinatários de push é query de DOMÍNIO de notificação (joins de
// consentimento e bloqueio); a estrutura de conversa é só o predicado. Fica no
// módulo de propósito; as leituras genéricas de conversa seguem no chat.

/** Payload mínimo pra montar o push de uma mensagem (remetente + conversa + 1º anexo). */
export async function findMessageForPush(id: string) {
  return prisma.message.findUnique({
    where: { id },
    select: {
      id: true,
      conversationId: true,
      senderId: true,
      type: true,
      content: true,
      deletedAt: true,
      createdAt: true,
      sender: { select: { name: true, lastname: true } },
      conversation: { select: { type: true, title: true } },
      attachments: {
        orderBy: { order: 'asc' as const },
        take: 1,
        select: { kind: true },
      },
    },
  })
}

/**
 * Destinatários do PUSH de uma mensagem: participantes ativos (menos o
 * remetente) cujo lastDeliveredAt ainda NÃO cobre o createdAt da mensagem —
 * ou seja, quem não a recebeu por socket até aqui (o job roda com delay).
 * Filtra bloqueio em qualquer direção (push é mais intrusivo que o frame) e
 * exige consentimento de push vigente. 1 query, qualquer tamanho de grupo.
 */
export async function findChatPushRecipientUserIds(
  conversationId: string,
  senderId: string,
  createdAt: Date,
) {
  const rows = await prisma.$queryRaw<{ userid: string }[]>(
    Prisma.sql`
      SELECT p."userId" AS userid
      FROM conversation_participants p
      JOIN user_consents uc
        ON uc."userId" = p."userId"
       AND uc."pushNotifications" = true
       AND uc."revokedAt" IS NULL
      WHERE p."conversationId" = ${conversationId}
        AND p."leftAt" IS NULL
        AND p."userId" <> ${senderId}
        AND (p."lastDeliveredAt" IS NULL OR p."lastDeliveredAt" < ${createdAt})
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b."blockerId" = ${senderId} AND b."blockedId" = p."userId")
             OR (b."blockerId" = p."userId" AND b."blockedId" = ${senderId})
        )
    `,
  )
  return rows.map((r) => r.userid)
}
