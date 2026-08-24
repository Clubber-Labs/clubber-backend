/**
 * Chave de dados (DEK) já envelopada pela chave mestra (KEK). O `blob` é OPACO:
 * seu formato pertence à implementação do provider — a do KMS devolveria o
 * ciphertext do próprio serviço. Só o `kekVersion` é contrato compartilhado,
 * porque é ele que diz com qual KEK desembrulhar (e o que o reconciler de
 * rotação varre para reembrulhar o que ficou para trás).
 */
export type WrappedKey = { kekVersion: number; blob: Buffer }

/**
 * Envelope encryption: a KEK envelopa DEKs, nunca o conteúdo. Rotacionar a KEK
 * reescreve N linhas de chave — jamais o ciphertext das mensagens.
 *
 * Assinaturas assíncronas de propósito: a implementação por env é síncrona, mas
 * um KMS (AWS/GCP) é I/O de rede. Nascer async evita refatorar todos os callers
 * no dia da troca.
 */
export interface IKeyProvider {
  /** Versão da KEK em que toda DEK NOVA é envelopada. */
  activeVersion(): number
  wrap(key: Buffer, aad: string): Promise<WrappedKey>
  unwrap(wrapped: WrappedKey, aad: string): Promise<Buffer>
}
