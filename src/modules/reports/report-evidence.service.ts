import { uuidv7 } from 'uuidv7'
import { AppError } from '../../lib/errors/app-error'
import { getStorage } from '../../lib/storage'
import {
  buildMessageEvidenceSnapshot,
  type MessageEvidenceSnapshot,
} from '../chat/chat.evidence'
import { openEvidence, sealEvidence } from './report-evidence.crypto'
import {
  createReportWithEvidence,
  readEvidenceWithAudit,
} from './report-evidence.repository'
import { assertReportAdmin } from './reports.access'
import type { CreateReportBody } from './reports.schema'

export async function createMessageReportWithEvidence(
  data: CreateReportBody,
  reporterId: string,
  message: { id: string; conversationId: string },
) {
  // O id nasce aqui porque a AAD da cifra o amarra — não dá para esperar o
  // insert devolvê-lo.
  const reportId = uuidv7()
  const evidence = await buildMessageEvidenceSnapshot(
    message.conversationId,
    message.id,
  )
  const sealed = await sealEvidence(reportId, evidence.snapshot)

  return createReportWithEvidence(
    reportId,
    data,
    reporterId,
    message.id,
    sealed,
    {
      conversationId: message.conversationId,
      reportedMessageId: message.id,
      reportedUserId: evidence.reportedUserId,
      contextCount: Math.max(evidence.snapshot.messages.length - 1, 0),
      retainedMediaKeys: evidence.retainedMediaKeys,
    },
  )
}

/**
 * Único caminho para o conteúdo denunciado em claro, e ele deixa rastro. O
 * `GET /reports` deixou de expor `message.content` justamente para que não haja
 * um segundo caminho, sem auditoria.
 */
export async function readReportEvidence(
  reportId: string,
  adminId: string,
  meta: { ipAddress: string | null; userAgent: string | null },
) {
  await assertReportAdmin(adminId)

  const evidence = await readEvidenceWithAudit(reportId, adminId, meta)
  if (!evidence) {
    throw new AppError(404, 'REPORT_EVIDENCE_NOT_FOUND')
  }

  const snapshot = await openEvidence<MessageEvidenceSnapshot>(
    reportId,
    evidence,
  )
  const storage = getStorage()

  return {
    id: evidence.id,
    capturedAt: evidence.capturedAt,
    contextCount: evidence.contextCount,
    conversation: snapshot.conversation,
    participants: snapshot.participants,
    reportedMessageId: snapshot.reportedMessageId,
    messages: snapshot.messages.map((m) => ({
      ...m,
      attachments: m.attachments.map(({ key, thumbnailKey, ...rest }) => ({
        ...rest,
        url: storage.signedUrl(key),
        thumbnailUrl: thumbnailKey ? storage.signedUrl(thumbnailKey) : null,
      })),
    })),
  }
}
