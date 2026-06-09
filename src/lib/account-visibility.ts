import type { Prisma } from '@prisma/client'

/**
 * Regras de visibilidade do ciclo de vida da conta (soft-delete).
 *
 * Há DOIS contextos com regras diferentes:
 *
 * - PESSOA (perfil, lista, busca, follow, participantes, convidados): só conta
 *   ACTIVE aparece. Conta desativada/pendente/anonimizada não é gente
 *   pesquisável/seguível.
 *
 * - CONTEÚDO em espaço alheio (autor é metadado de comentário/post/mensagem/
 *   evento): além de ACTIVE, conta ANONYMIZED permanece visível — exigência
 *   LGPD: o conteúdo deixado fica, mas o nome do autor (já sobrescrito no
 *   próprio registro para "Usuário"/"Excluído") aparece como "Usuário Excluído".
 *   Conta apenas DEACTIVATED/PENDING_DELETION some temporariamente (volta ao
 *   reativar).
 */

export const VISIBLE_AS_USER = ['ACTIVE'] as const

export const VISIBLE_AS_AUTHOR = ['ACTIVE', 'ANONYMIZED'] as const

export const DELETED_DISPLAY_NAME = 'Usuário'
export const DELETED_DISPLAY_LASTNAME = 'Excluído'

/** WHERE para "a pessoa relacionada está ativa" — perfil/lista/follow. */
export function activeUserWhere(): Prisma.UserWhereInput {
  return { accountStatus: 'ACTIVE' }
}

/** WHERE para "o autor do conteúdo é visível" — filtro de parent por relação. */
export function visibleAuthorWhere(): Prisma.UserWhereInput {
  return { accountStatus: { in: [...VISIBLE_AS_AUTHOR] } }
}
