import type { IncomingMessage } from 'node:http'
import { uuidv7 } from 'uuidv7'

// Limita o que aceitamos de fora: evita header injection (CR/LF), espaços e
// payloads gigantes que poluiriam logs e métricas. uuidv7 é ordenável no tempo.
const VALID_REQUEST_ID = /^[A-Za-z0-9_.:-]+$/
const MAX_LENGTH = 200

/**
 * Gera o id da request. Reaproveita o `x-request-id` de entrada quando ele é
 * válido (correlação ponta-a-ponta entre serviços), senão gera um uuidv7 novo.
 * Usado como `genReqId` do Fastify — o valor vira `request.id` e o `reqId` dos
 * logs filhos.
 */
export function genReqId(req: IncomingMessage): string {
  const header = req.headers['x-request-id']
  const candidate = Array.isArray(header) ? header[0] : header
  if (
    typeof candidate === 'string' &&
    candidate.length > 0 &&
    candidate.length <= MAX_LENGTH &&
    VALID_REQUEST_ID.test(candidate)
  ) {
    return candidate
  }
  return uuidv7()
}
