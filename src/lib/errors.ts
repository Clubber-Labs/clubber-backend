import { Prisma } from '@prisma/client'
import type { ErrorCode } from './errors/error-codes'

const UNIQUE_FIELD_CODES: Record<string, ErrorCode> = {
  phone: 'PHONE_TAKEN',
  email: 'EMAIL_TAKEN',
  username: 'USERNAME_TAKEN',
}

// Violação vinda de índice funcional (unicidade case-insensitive da identidade)
// chega como o NOME do índice, não como a coluna — o Prisma não sabe mapear uma
// expressão de volta para um campo do schema.
const UNIQUE_INDEX_FIELDS: Record<string, string> = {
  users_email_lower_key: 'email',
  users_username_lower_key: 'username',
}

// `field` só sai para as colunas conhecidas acima: o cliente marca o campo do
// formulário sem inferir pelo código, e o contrato fica restrito a nomes que
// ele reconhece (nome de constraint interna não vaza).
export type FriendlyError = {
  statusCode: number
  code: ErrorCode
  field?: string
}

export function handlePrismaUniqueError(error: unknown): FriendlyError | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null
  if (error.code !== 'P2002') return null

  const target = error.meta?.target
  const raw: unknown[] = Array.isArray(target)
    ? target
    : typeof target === 'string'
      ? [target]
      : []
  const fields = raw
    .filter((f): f is string => typeof f === 'string')
    .map((f) => UNIQUE_INDEX_FIELDS[f] ?? f)

  if (
    fields.includes('reporterId') &&
    fields.includes('status') &&
    fields.some((field) =>
      ['eventId', 'commentId', 'messageId', 'targetUserId'].includes(field),
    )
  ) {
    return { statusCode: 409, code: 'REPORT_ALREADY_OPEN' }
  }

  const field = fields.find((f) => f in UNIQUE_FIELD_CODES)
  if (!field) return { statusCode: 409, code: 'DUPLICATE_VALUE' }
  return { statusCode: 409, code: UNIQUE_FIELD_CODES[field], field }
}
