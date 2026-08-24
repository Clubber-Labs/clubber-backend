import { getKeyProvider } from '../../lib/crypto'
import {
  decodeSealed,
  encodeSealed,
  open,
  randomDek,
  seal,
} from '../../lib/crypto/aead'
import {
  conversationDekCacheKey,
  getCachedDek,
  setCachedDek,
} from '../../lib/crypto/dek-cache'
import { logger } from '../../lib/logger'
import { isUniqueViolation } from '../../lib/prisma-errors'
import {
  createConversationKey,
  findActiveConversationKey,
  findConversationKey,
} from './chat.repository'

// Camada de cifra do chat: o SERVICE chama isto, o REPOSITORY só persiste bytes
// opacos. Fica fora do repository porque fala com o key provider, e fora do
// service porque não é regra de negócio.

export type EncryptedContent = { cipher: string; keyVersion: number }

/**
 * AADs versionadas e distintas por propósito. Trocar qualquer uma destas strings
 * torna ilegível tudo que já foi gravado — a mudança é uma migração de dados,
 * não uma renomeação.
 */
function dekAad(conversationId: string) {
  return `conv-dek:v1:${conversationId}`
}

function contentAad(conversationId: string) {
  return `msg-content:v1:${conversationId}`
}

/**
 * A chave da conversa sumiu (linha apagada, ou crypto-shredding). Não é erro de
 * programação: a leitura precisa degradar para conteúdo nulo em vez de derrubar
 * a listagem inteira com 500.
 */
export class ConversationKeyUnavailableError extends Error {
  constructor(conversationId: string, version: number) {
    super(`Chave v${version} indisponível para a conversa ${conversationId}`)
    this.name = 'ConversationKeyUnavailableError'
  }
}

// O Prisma devolve `Bytes` como Uint8Array; a lib de cripto trabalha com Buffer.
// A conversão fica AQUI, na fronteira, para não vazar o detalhe do ORM.
async function unwrapAndCache(
  conversationId: string,
  row: { version: number; wrappedDek: Uint8Array; kekVersion: number },
): Promise<Buffer> {
  const dek = await getKeyProvider().unwrap(
    { kekVersion: row.kekVersion, blob: Buffer.from(row.wrappedDek) },
    dekAad(conversationId),
  )
  setCachedDek(conversationDekCacheKey(conversationId, row.version), dek)
  return dek
}

/**
 * Provisionamento PREGUIÇOSO: a chave nasce na primeira escrita, não na criação
 * da conversa. Conversas surgem em três lugares (DM, grupo e spot) e isto cobre
 * os três sem tocar em nenhum.
 */
export async function ensureConversationDek(
  conversationId: string,
): Promise<{ dek: Buffer; version: number }> {
  const active = await findActiveConversationKey(conversationId)
  if (active) {
    const cached = getCachedDek(
      conversationDekCacheKey(conversationId, active.version),
    )
    return {
      dek: cached ?? (await unwrapAndCache(conversationId, active)),
      version: active.version,
    }
  }

  const dek = randomDek()
  const wrapped = await getKeyProvider().wrap(dek, dekAad(conversationId))
  try {
    const created = await createConversationKey(conversationId, 1, wrapped)
    setCachedDek(conversationDekCacheKey(conversationId, created.version), dek)
    return { dek, version: created.version }
  } catch (err) {
    // SÓ a violação do unique é corrida. Sem esta guarda, uma queda de conexão
    // ou permissão negada na tabela viraria "chave indisponível" — o sintoma
    // que a auditoria desta cifra mais precisa enxergar ficaria escondido.
    if (!isUniqueViolation(err)) throw err
    // Corrida de provisionamento: dois envios simultâneos numa conversa sem
    // chave. O unique (conversationId, version) elege um vencedor; o perdedor
    // relê e usa a chave dele — jamais duas chaves para a mesma conversa.
    const winner = await findActiveConversationKey(conversationId)
    if (!winner) throw new ConversationKeyUnavailableError(conversationId, 1)
    return {
      dek: await unwrapAndCache(conversationId, winner),
      version: winner.version,
    }
  }
}

async function loadConversationDek(
  conversationId: string,
  version: number,
): Promise<Buffer> {
  const cached = getCachedDek(conversationDekCacheKey(conversationId, version))
  if (cached) return cached

  const row = await findConversationKey(conversationId, version)
  // wrappedDek vazio = crypto-shredded: a chave foi destruída de propósito.
  if (!row || row.wrappedDek.length === 0) {
    throw new ConversationKeyUnavailableError(conversationId, version)
  }
  return unwrapAndCache(conversationId, row)
}

export async function encryptContent(
  conversationId: string,
  plaintext: string,
): Promise<EncryptedContent> {
  const { dek, version } = await ensureConversationDek(conversationId)
  const sealed = seal(
    dek,
    Buffer.from(plaintext, 'utf8'),
    contentAad(conversationId),
  )
  return { cipher: encodeSealed(sealed), keyVersion: version }
}

// ── Hidratação ───────────────────────────────────────────────────────────────

type CipherFields = {
  content: string | null
  contentCipher: string | null
  contentKeyVersion: number | null
}

export type HydratableMessage = CipherFields & {
  conversationId: string
  replyTo?: (CipherFields & { id: string }) | null
}

/**
 * LEITURA DUAL, invariante único do sistema:
 *   contentCipher !== null → decifra
 *   contentCipher === null → devolve `content` (legado, pré-backfill)
 * A COLUNA é a fonte da verdade — nunca decidir por data nem por flag global,
 * senão o backfill deixa de ser retomável e o rollback deixa de ser trivial.
 */
function decryptField(row: CipherFields, dek: Buffer, aad: string) {
  if (row.contentCipher === null) return
  row.content = open(dek, decodeSealed(row.contentCipher), aad).toString('utf8')
}

/**
 * Preenche `content` (e o do replyTo) nas linhas vindas do repository, ANTES do
 * shape. Em lote de propósito: um unwrap por (conversa, versão) em vez de um por
 * mensagem, e `shapeMessage`/`shapeReplyPreview` continuam SÍNCRONOS — torná-los
 * async propagaria `await` por todo o service.
 */
export async function hydrateMessages<T extends HydratableMessage>(
  rows: T[],
): Promise<T[]> {
  const deks = new Map<string, Buffer | null>()

  for (const row of rows) {
    const versions = [row.contentKeyVersion, row.replyTo?.contentKeyVersion]
    for (const version of versions) {
      if (version === null || version === undefined) continue
      const cacheKey = conversationDekCacheKey(row.conversationId, version)
      if (deks.has(cacheKey)) continue
      try {
        deks.set(
          cacheKey,
          await loadConversationDek(row.conversationId, version),
        )
      } catch (err) {
        // Uma conversa sem chave não pode derrubar a página inteira: as demais
        // seguem legíveis e esta devolve conteúdo nulo.
        deks.set(cacheKey, null)
        logger.error(
          `Chave indisponível ao ler mensagens: ${(err as Error).message}`,
        )
      }
    }
  }

  const aad = (conversationId: string) => contentAad(conversationId)

  for (const row of rows) {
    for (const target of [row, row.replyTo]) {
      if (!target || target.contentCipher === null) continue
      const version = target.contentKeyVersion
      const dek =
        version === null
          ? null
          : (deks.get(conversationDekCacheKey(row.conversationId, version)) ??
            null)
      if (!dek) {
        target.content = null
        continue
      }
      try {
        decryptField(target, dek, aad(row.conversationId))
      } catch (err) {
        target.content = null
        logger.error(`Falha ao decifrar mensagem: ${(err as Error).message}`)
      }
    }
  }

  return rows
}

export async function hydrateMessage<T extends HydratableMessage>(
  row: T,
): Promise<T> {
  const [hydrated] = await hydrateMessages([row])
  return hydrated
}
