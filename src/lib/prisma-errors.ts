/**
 * Predicados sobre códigos de erro do Prisma. Vivem fora dos módulos porque são
 * da fronteira com o ORM, não regra de negócio — e porque tratar "qualquer erro"
 * como se fosse a violação esperada mascara falha real de banco.
 */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'P2002'
  )
}

export function isRecordNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'P2025'
  )
}
