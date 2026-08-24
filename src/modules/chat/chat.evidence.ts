import { env } from '../../lib/env'
import { hydrateMessages } from './chat.crypto'
import {
  findConversationForEvidence,
  findMessagesAround,
} from './chat.repository'

// Monta o snapshot de uma denúncia de mensagem. Fica no módulo `chat` porque só
// ele sabe desembrulhar a DEK da conversa; o módulo `reports` recebe o snapshot
// já em claro e o cifra com a DEK PRÓPRIA da evidência.

type EvidenceAttachment = {
  key: string
  kind: string
  format: string | null
  thumbnailKey: string | null
  // Material para decifrar a mídia. Nulo enquanto a mídia sobe em claro; quando
  // a cifra de anexo entrar, é isto que torna a prova autocontida — a moderação
  // segue lendo o arquivo depois do shred da conversa.
  encryption: null
}

export type MessageEvidenceSnapshot = {
  version: 1
  capturedAt: string
  conversation: { id: string; type: string; title: string | null }
  participants: { userId: string; username: string; leftAt: string | null }[]
  reportedMessageId: string
  messages: {
    id: string
    senderId: string
    type: string
    content: string | null
    createdAt: string
    editedAt: string | null
    deletedAt: string | null
    isReported: boolean
    attachments: EvidenceAttachment[]
  }[]
}

export type MessageEvidence = {
  snapshot: MessageEvidenceSnapshot
  /** Chaves de storage que a remoção do conteúdo não pode apagar. */
  retainedMediaKeys: string[]
  reportedUserId: string | null
}

export async function buildMessageEvidenceSnapshot(
  conversationId: string,
  messageId: string,
): Promise<MessageEvidence> {
  const conversation = await findConversationForEvidence(conversationId)
  const rows = await findMessagesAround(
    conversationId,
    messageId,
    env.CHAT_EVIDENCE_CONTEXT_BEFORE,
    env.CHAT_EVIDENCE_CONTEXT_AFTER,
  )
  // O texto vai EM CLARO para dentro do payload, que é cifrado inteiro em
  // seguida: sem isso a prova morreria junto com a chave da conversa.
  await hydrateMessages(rows)

  const messages = rows.map((row) => {
    const attachments = row.attachments.map((a) => {
      return {
        key: a.key,
        kind: a.kind,
        format: a.format,
        thumbnailKey: a.thumbnailKey,
        encryption: null,
      }
    })
    return {
      id: row.id,
      senderId: row.senderId,
      type: row.type,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      editedAt: row.editedAt?.toISOString() ?? null,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      isReported: row.id === messageId,
      attachments,
    }
  })

  return {
    snapshot: {
      version: 1,
      capturedAt: new Date().toISOString(),
      conversation: {
        id: conversationId,
        type: conversation?.type ?? 'UNKNOWN',
        title: conversation?.title ?? null,
      },
      participants: (conversation?.participants ?? []).map((p) => ({
        userId: p.userId,
        username: p.user.username,
        leftAt: p.leftAt?.toISOString() ?? null,
      })),
      reportedMessageId: messageId,
      messages,
    },
    // Só a mídia da mensagem DENUNCIADA é retida: reter a do contexto inteiro
    // transformaria uma denúncia em cópia da conversa no storage.
    retainedMediaKeys: messages
      .filter((m) => m.isReported)
      .flatMap((m) =>
        m.attachments.flatMap((a) =>
          a.thumbnailKey ? [a.key, a.thumbnailKey] : [a.key],
        ),
      ),
    reportedUserId: messages.find((m) => m.isReported)?.senderId ?? null,
  }
}
