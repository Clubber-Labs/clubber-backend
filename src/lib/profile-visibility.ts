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
    AND: [
      {
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
      },
      // Bloqueio em qualquer direção esconde o conteúdo do autor, mesmo público
      // ou já seguido: `none` garante que o autor não bloqueou o viewer e que o
      // viewer não bloqueou o autor.
      {
        author: {
          blocksMade: { none: { blockedId: viewerId } },
          blocksReceived: { none: { blockerId: viewerId } },
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

  // Bloqueio em qualquer direção corta o acesso — inclusive a conteúdo público.
  if (viewerId && (await isBlockedBetween(authorId, viewerId))) return false

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

// Consulta local (não importa do módulo blocks) para manter lib/ como folha,
// sem depender de módulos de domínio. Block é apenas uma tabela.
async function isBlockedBetween(a: string, b: string): Promise<boolean> {
  const found = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
    select: { id: true },
  })
  return found !== null
}
