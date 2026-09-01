/** Campo do primeiro issue do Zod — vira o `field` do AppError, preservando
 * qual metadado falhou sem expor a mensagem livre (não-traduzível) do schema. */
export function firstIssueField(error: { issues: { path: PropertyKey[] }[] }) {
  const segment = error.issues[0]?.path[0]
  return segment === undefined ? undefined : String(segment)
}
