import { getKeyProvider } from '../../lib/crypto'
import { AEAD_ALG, open, randomDek, seal } from '../../lib/crypto/aead'
import type { RewrapSource } from '../../lib/crypto/rewrap'
import {
  countEvidencesToRewrap,
  findEvidencesToRewrap,
  updateEvidenceEnvelope,
} from './report-evidence.repository'

// Cifra da evidência de denúncia. Espelha chat.crypto.ts: o SERVICE chama isto,
// o REPOSITORY só persiste bytes opacos.

export type SealedEvidence = {
  wrappedDek: Buffer
  kekVersion: number
  iv: Buffer
  tag: Buffer
  alg: string
  payloadCipher: Buffer
}

type EvidenceRow = {
  wrappedDek: Uint8Array
  kekVersion: number
  iv: Uint8Array
  tag: Uint8Array
  payloadCipher: Uint8Array
}

/**
 * AAD versionada e amarrada ao reportId: um payload não pode ser transplantado
 * para outra denúncia. Trocar esta string torna ilegível tudo que já foi
 * gravado — é migração de dados, não renomeação.
 */
function evidenceAad(reportId: string) {
  return `evidence:v1:${reportId}`
}

/**
 * DEK PRÓPRIA por evidência, nunca a da conversa: rotação ou crypto-shredding
 * da conversa não podem destruir a prova que sustenta a punição.
 */
export async function sealEvidence(
  reportId: string,
  payload: unknown,
): Promise<SealedEvidence> {
  const dek = randomDek()
  const aad = evidenceAad(reportId)
  const wrapped = await getKeyProvider().wrap(dek, aad)
  const sealed = seal(dek, Buffer.from(JSON.stringify(payload), 'utf8'), aad)
  return {
    wrappedDek: wrapped.blob,
    kekVersion: wrapped.kekVersion,
    iv: sealed.iv,
    tag: sealed.tag,
    alg: AEAD_ALG,
    payloadCipher: sealed.ct,
  }
}

export async function openEvidence<T>(
  reportId: string,
  row: EvidenceRow,
): Promise<T> {
  const aad = evidenceAad(reportId)
  const dek = await getKeyProvider().unwrap(
    { kekVersion: row.kekVersion, blob: Buffer.from(row.wrappedDek) },
    aad,
  )
  const plaintext = open(
    dek,
    {
      iv: Buffer.from(row.iv),
      tag: Buffer.from(row.tag),
      ct: Buffer.from(row.payloadCipher),
    },
    aad,
  )
  return JSON.parse(plaintext.toString('utf8')) as T
}

/**
 * Fonte de rewrap das evidências — espelha a do chat, e pelo mesmo motivo mora
 * ao lado da `evidenceAad` em vez de exportá-la.
 */
export const reportEvidenceRewrapSource: RewrapSource = {
  name: 'report_evidences',
  async countPending(activeVersion) {
    const rows = await countEvidencesToRewrap(activeVersion)
    return rows.map((row) => ({
      kekVersion: row.kekVersion,
      pending: row._count._all,
    }))
  },
  async findPending(activeVersion, limit) {
    const rows = await findEvidencesToRewrap(activeVersion, limit)
    return rows.map((row) => ({
      id: row.id,
      aad: evidenceAad(row.reportId),
      wrappedDek: row.wrappedDek,
      kekVersion: row.kekVersion,
    }))
  },
  persist(id, fromKekVersion, wrapped) {
    return updateEvidenceEnvelope(id, fromKekVersion, wrapped)
  },
}
