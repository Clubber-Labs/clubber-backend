import { AppError } from '../../lib/errors/app-error'
import { findUserRoleById } from './reports.repository'

/**
 * Relê o papel do BANCO em vez de confiar no JWT: um token emitido antes do
 * rebaixamento de um admin não pode continuar abrindo conteúdo denunciado.
 *
 * Vive fora do service porque a leitura auditada de evidência precisa da mesma
 * porta, e importá-la do reports.service criaria ciclo.
 */
export async function assertReportAdmin(userId: string) {
  const user = await findUserRoleById(userId)
  if (user?.role !== 'ADMIN') {
    throw new AppError(403, 'ADMIN_ONLY')
  }
}
