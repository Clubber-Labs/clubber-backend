import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'

/**
 * Filtro Prisma para "eventos cujo autor é visível ao viewer".
 * Visível quando o autor é público OU o viewer é o próprio autor OU
 * o viewer segue o autor com status ACCEPTED.
 *
 * Aplica como WHERE adicional em queries de listagem.
 */
export function authorVisibleWhere(viewerId?: string): Prisma.EventWhereInput {
  if (!viewerId) {
    return { author: { isPrivate: false } }
  }
  return {
    OR: [
      { authorId: viewerId },
      { author: { isPrivate: false } },
      {
        author: {
          followers: {
            some: { followerId: viewerId, status: 'ACCEPTED' },
          },
        },
      },
    ],
  }
}

/**
 * Resolve se o viewer pode ver o conteúdo do autor (eventos, posts etc.).
 * Equivalente em runtime ao filtro `authorVisibleWhere`, mas pra checagem
 * pontual (1 autor, 1 viewer) — usar quando não dá pra incluir em WHERE.
 */
export async function canViewAuthorContent(
  authorId: string,
  viewerId?: string,
): Promise<boolean> {
  if (viewerId === authorId) return true

  const author = await prisma.user.findUnique({
    where: { id: authorId },
    select: { isPrivate: true },
  })
  if (!author) return false
  if (!author.isPrivate) return true
  if (!viewerId) return false

  const follow = await prisma.follow.findUnique({
    where: {
      followerId_followingId: { followerId: viewerId, followingId: authorId },
    },
    select: { status: true },
  })
  return follow?.status === 'ACCEPTED'
}
