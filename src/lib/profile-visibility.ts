import type { Prisma } from '@prisma/client'
import { areMutualFollowers } from '../modules/follows/follows.repository'

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
 * Alcançabilidade para CONVERSA (DM e grupo). Mais estrita que a visibilidade
 * de conteúdo de propósito: ver conteúdo público não pede vínculo nenhum, mas
 * conversa é canal direto — perfil privado exige follow MÚTUO aceito, a mesma
 * definição de "amigo" que os rolês privados já usam.
 *
 * NÃO checa bloqueio: quem chama (assertReachable) já barra antes, e com outro
 * código de erro — juntar aqui apagaria a distinção.
 *
 * `targetIsPrivate` vem do chamador, que já carregou o alvo para checar
 * existência/status — refazer a query aqui dobraria as idas ao banco por
 * membro ao criar grupo.
 */
export async function canChatWith(
  targetId: string,
  viewerId: string,
  targetIsPrivate: boolean,
): Promise<boolean> {
  if (viewerId === targetId) return true
  if (!targetIsPrivate) return true

  return areMutualFollowers(viewerId, targetId)
}
