import { Prisma } from '@prisma/client'

const UNIQUE_FIELD_MESSAGES: Record<string, string> = {
  phone: 'Este telefone já está cadastrado em outra conta.',
  email: 'Este e-mail já está cadastrado em outra conta.',
  username: 'Este nome de usuário já está em uso.',
}

const DEFAULT_UNIQUE_MESSAGE = 'Este dado já está em uso em outra conta.'
const DUPLICATE_REPORT_MESSAGE =
  'Você já possui uma denúncia ativa para este item.'

export type FriendlyError = { statusCode: number; message: string }

export function handlePrismaUniqueError(error: unknown): FriendlyError | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null
  if (error.code !== 'P2002') return null

  const target = error.meta?.target
  const fields = Array.isArray(target)
    ? target
    : typeof target === 'string'
      ? [target]
      : []

  if (
    fields.includes('reporterId') &&
    fields.includes('status') &&
    fields.some((field) =>
      ['eventId', 'commentId', 'messageId', 'targetUserId'].includes(field),
    )
  ) {
    return { statusCode: 409, message: DUPLICATE_REPORT_MESSAGE }
  }

  const field = fields.find((f) => f in UNIQUE_FIELD_MESSAGES) ?? fields[0]
  const message =
    (field && UNIQUE_FIELD_MESSAGES[field]) ?? DEFAULT_UNIQUE_MESSAGE
  return { statusCode: 409, message }
}
