import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'

const TOP_CHECK_INS_LIMIT = 5

export type CheckInUser = {
  id: string
  name: string
  lastname: string
  username: string
  avatarUrl: string | null
}

/**
 * Grava a chegada e leva o RSVP junto para CONFIRMED, na MESMA transação: o
 * resumo do autor lê "quantos chegaram de quantos confirmaram", e as duas
 * escritas separadas deixariam o numerador passar o denominador. Por isso a
 * presença é escrita daqui e não pelo módulo attendance — transação exige um
 * cliente só.
 *
 * Idempotente pelos únicos (userId, eventId) das duas tabelas: o app repete o
 * POST em retry de rede e o segundo não pode virar erro nem segunda linha.
 */
export async function createCheckIn(eventId: string, userId: string) {
  return prisma.$transaction([
    prisma.eventCheckIn.upsert({
      where: { userId_eventId: { userId, eventId } },
      create: { userId, eventId },
      update: {},
    }),
    prisma.eventAttendance.upsert({
      where: { userId_eventId: { userId, eventId } },
      create: { userId, eventId, type: 'CONFIRMED' },
      update: { type: 'CONFIRMED' },
    }),
  ])
}

export async function countCheckIns(eventId: string): Promise<number> {
  return prisma.eventCheckIn.count({ where: { eventId } })
}

export async function hasCheckedIn(
  eventId: string,
  userId: string,
): Promise<boolean> {
  const found = await prisma.eventCheckIn.findUnique({
    where: { userId_eventId: { userId, eventId } },
    select: { id: true },
  })
  return found !== null
}

/**
 * Quem chegou, em destaque: amigos primeiro, depois por chegada mais recente.
 * Mesma forma e mesma régua de visibilidade de findTopAttendancesByEvent — o
 * app renderiza os dois com o mesmo componente de avatares.
 */
export async function findTopCheckIns(
  eventId: string,
  followingIds: string[],
): Promise<CheckInUser[]> {
  // followingIds vazio (anônimo ou sem rede) → ninguém é amigo e a ordenação
  // cai só na recência.
  const isFriendExpr = followingIds.length
    ? Prisma.sql`c."userId" IN (${Prisma.join(followingIds)})`
    : Prisma.sql`FALSE`

  // A amizade sai como COLUNA da derivada em vez de ir direto no ORDER BY: sem
  // amigos o fragmento vira a constante FALSE, e o Postgres recusa constante
  // não-inteira em ORDER BY de topo ("non-integer constant in ORDER BY").
  return prisma.$queryRaw<CheckInUser[]>(Prisma.sql`
    SELECT ranked.id, ranked.name, ranked.lastname,
           ranked.username, ranked."avatarUrl"
    FROM (
      SELECT u.id, u.name, u.lastname, u.username, u."avatarUrl",
             (${isFriendExpr}) AS is_friend,
             c."createdAt", c."userId"
      FROM event_check_ins c
      JOIN users u ON u.id = c."userId"
      WHERE c."eventId" = ${eventId}
        -- Equivale ao activeUserWhere() (lib/account-visibility); aqui é raw SQL,
        -- então o literal 'ACTIVE' é intencional — manter em sincronia com o enum.
        AND u."accountStatus" = 'ACTIVE'
    ) ranked
    ORDER BY ranked.is_friend DESC,
             ranked."createdAt" DESC,
             -- Desempate total: createdAt empata no timestamp(3) e sem isso a
             -- ordem varia entre requests iguais.
             ranked."userId" ASC
    LIMIT ${TOP_CHECK_INS_LIMIT}
  `)
}
