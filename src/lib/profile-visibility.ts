import type { Prisma } from '@prisma/client'
import { areMutualFollowers } from '../modules/follows/follows.repository'
import { visibleAuthorWhere } from './account-visibility'
import { prisma } from './prisma'

/**
 * Filtro Prisma para "o conteúdo desta pessoa é visível ao viewer".
 * Visível quando ela é pública OU é o próprio viewer OU o viewer a segue com
 * status ACCEPTED — e nunca quando há bloqueio em qualquer direção.
 *
 * Régua ÚNICA de visibilidade de conteúdo por pessoa: a versão em cima do
 * evento (authorVisibleWhere) e o portão do dono do perfil saem daqui, pra não
 * existirem duas definições de quem pode ver o quê.
 */
export function userContentVisibleWhere(
  viewerId?: string,
): Prisma.UserWhereInput {
  if (!viewerId) {
    return { isPrivate: false }
  }
  return {
    AND: [
      {
        OR: [
          { id: viewerId },
          { isPrivate: false },
          { followers: { some: { followerId: viewerId, status: 'ACCEPTED' } } },
        ],
      },
      // Bloqueio em qualquer direção esconde o conteúdo, mesmo público ou já
      // seguido: `none` garante que ela não bloqueou o viewer e que o viewer
      // não a bloqueou.
      {
        blocksMade: { none: { blockedId: viewerId } },
        blocksReceived: { none: { blockerId: viewerId } },
      },
    ],
  }
}

/**
 * O dono do perfil, quando o viewer pode ver o conteúdo dele. `null` = a
 * listagem inteira responde vazia.
 *
 * Existe porque a vitrine do perfil deixou de ser só "eventos que ele criou":
 * com as presenças confirmadas, o autor do evento é outra pessoa, e o filtro
 * por autor não protege mais a privacidade do DONO do perfil.
 */
export async function findVisibleProfileOwner(
  ownerId: string,
  viewerId?: string,
) {
  return prisma.user.findFirst({
    where: {
      AND: [
        { id: ownerId },
        visibleAuthorWhere(),
        userContentVisibleWhere(viewerId),
      ],
    },
    select: { id: true, socialVisibility: true },
  })
}

/**
 * Mesma régua, aplicada ao autor do evento em queries de listagem.
 */
export function authorVisibleWhere(viewerId?: string): Prisma.EventWhereInput {
  return { author: userContentVisibleWhere(viewerId) }
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
