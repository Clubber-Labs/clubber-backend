import { prisma } from '../../lib/prisma'
import type { SealedEvidence } from './report-evidence.crypto'
import type { CreateReportBody } from './reports.schema'

type EvidenceRefs = {
  conversationId: string
  reportedMessageId: string
  reportedUserId: string | null
  contextCount: number
  retainedMediaKeys: string[]
}

const evidenceSelect = {
  id: true,
  wrappedDek: true,
  kekVersion: true,
  iv: true,
  tag: true,
  payloadCipher: true,
  capturedAt: true,
  contextCount: true,
  retainedMediaKeys: true,
} as const

/**
 * Denúncia e prova nascem juntas ou nenhuma nasce. Sem a transação existiria
 * denúncia sem evidência sempre que a captura falhasse — e é a evidência que
 * sustenta a punição depois.
 *
 * O id vem de fora porque a AAD da cifra o amarra: precisa existir antes do
 * insert.
 */
export async function createReportWithEvidence(
  reportId: string,
  data: CreateReportBody,
  reporterId: string,
  messageId: string,
  sealed: SealedEvidence,
  refs: EvidenceRefs,
) {
  const [report] = await prisma.$transaction([
    prisma.report.create({
      data: { ...data, id: reportId, reporterId, messageId },
    }),
    prisma.reportEvidence.create({
      data: {
        reportId,
        kind: 'CHAT_MESSAGE',
        // Prisma tipa Bytes como Uint8Array<ArrayBuffer>; a conversão fica na
        // fronteira, igual ao createConversationKey.
        wrappedDek: new Uint8Array(sealed.wrappedDek),
        kekVersion: sealed.kekVersion,
        iv: new Uint8Array(sealed.iv),
        tag: new Uint8Array(sealed.tag),
        alg: sealed.alg,
        payloadCipher: new Uint8Array(sealed.payloadCipher),
        ...refs,
      },
    }),
  ])
  return report
}

/**
 * Leitura da prova E registro do acesso na MESMA transação, com o log gravado
 * antes de qualquer decifra: se o log falhar, o admin não vê nada. Fail-closed
 * de propósito — uma leitura sem rastro é pior que uma leitura negada.
 */
export async function readEvidenceWithAudit(
  reportId: string,
  adminId: string,
  meta: { ipAddress: string | null; userAgent: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const evidence = await tx.reportEvidence.findUnique({
      where: { reportId },
      select: evidenceSelect,
    })
    // Nada para ver (id inexistente, ou prova já expurgada pela retenção): não
    // registra. VIEW_EVIDENCE precisa significar "este admin leu este conteúdo"
    // — uma tentativa em vazio gravada como leitura envenena a própria trilha
    // que justifica ter tirado o content do GET /reports.
    if (!evidence || evidence.payloadCipher.length === 0) return null

    await tx.moderationAccessLog.create({
      data: {
        adminId,
        action: 'VIEW_EVIDENCE',
        reportId,
        evidenceId: evidence.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    })
    return evidence
  })
}

/** Keys que a remoção do conteúdo denunciado NÃO pode apagar. */
export async function findRetainedMediaKeys(reportId: string) {
  const evidence = await prisma.reportEvidence.findUnique({
    where: { reportId },
    select: { retainedMediaKeys: true },
  })
  return evidence?.retainedMediaKeys ?? []
}

export async function findExpiredEvidences(before: Date, limit: number) {
  return prisma.reportEvidence.findMany({
    where: { purgedAt: null, capturedAt: { lt: before } },
    orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
    take: limit,
    select: { id: true, retainedMediaKeys: true },
  })
}

/**
 * Expurgo: zera o ciphertext e a chave (o payload vira inalcançável mesmo se a
 * linha sobreviver em backup) e marca `purgedAt`, que é o que tira a linha do
 * predicado do reconciler — o próprio predicado é o cursor.
 */
export async function purgeEvidence(id: string) {
  return prisma.reportEvidence.update({
    where: { id },
    data: {
      wrappedDek: new Uint8Array(0),
      payloadCipher: new Uint8Array(0),
      retainedMediaKeys: [],
      purgedAt: new Date(),
    },
  })
}

/**
 * Pendentes de rewrap. Mesmo desenho do lado do chat: o predicado é o cursor, e
 * a evidência já expurgada fica de fora porque `purgeEvidence` zerou a chave.
 */
export async function findEvidencesToRewrap(
  activeVersion: number,
  limit: number,
) {
  return prisma.reportEvidence.findMany({
    where: {
      kekVersion: { lt: activeVersion },
      purgedAt: null,
      // Blob vazio nunca vira rewrap: sem este filtro a linha ficaria
      // presa no predicado e o lote a releria para sempre.
      wrappedDek: { not: new Uint8Array(0) },
    },
    orderBy: [{ kekVersion: 'asc' }, { id: 'asc' }],
    take: limit,
    select: { id: true, reportId: true, wrappedDek: true, kekVersion: true },
  })
}

export async function countEvidencesToRewrap(activeVersion: number) {
  return prisma.reportEvidence.groupBy({
    by: ['kekVersion'],
    where: {
      kekVersion: { lt: activeVersion },
      purgedAt: null,
      // Mesmo predicado do find acima: contagem e drenagem não podem divergir.
      wrappedDek: { not: new Uint8Array(0) },
    },
    _count: { _all: true },
  })
}

/** Compare-and-set em `kekVersion` — ver updateConversationKeyEnvelope. */
export async function updateEvidenceEnvelope(
  id: string,
  fromKekVersion: number,
  wrapped: { kekVersion: number; blob: Buffer },
) {
  const { count } = await prisma.reportEvidence.updateMany({
    where: { id, kekVersion: fromKekVersion },
    data: {
      wrappedDek: new Uint8Array(wrapped.blob),
      kekVersion: wrapped.kekVersion,
    },
  })
  return count
}
