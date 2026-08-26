import { DEK_BYTES } from './aead'

// Descoberta das KEKs do chat no ambiente. Vive fora do env.ts porque é a ÚNICA
// família de variáveis do projeto que não cabe em slot estático: cada rotação
// acrescenta uma `CHAT_KEK_V<n>`, e enumerá-las no schema fazia toda rotação
// custar três edições de código (ver histórico do CHAT_KEK_MAX_VERSION).

const CHAT_KEK_PATTERN = /^CHAT_KEK_V([1-9]\d*)$/

export type DiscoveredChatKeks = {
  keks: ReadonlyMap<number, Buffer>
  /** Nomes das vars presentes que NÃO decodificam para 32 bytes. */
  invalid: string[]
}

/**
 * Varre o ambiente por `CHAT_KEK_V<n>`. Não lança: devolve o que achou e o que
 * está quebrado, para o env.ts transformar em erro de boot com a mensagem no
 * formato dele. Var presente e vazia conta como AUSENTE (é como o Coolify
 * entrega um campo em branco), não como inválida.
 */
export function discoverChatKeks(
  source: NodeJS.ProcessEnv = process.env,
): DiscoveredChatKeks {
  const keks = new Map<number, Buffer>()
  const invalid: string[] = []

  for (const [name, raw] of Object.entries(source)) {
    const match = CHAT_KEK_PATTERN.exec(name)
    if (!match || !raw) continue
    const key = Buffer.from(raw, 'base64')
    // `Buffer.from` com base64 nunca lança: entrada inválida vira lixo curto.
    // O tamanho exato é, portanto, a única validação que vale.
    if (key.length !== DEK_BYTES) {
      invalid.push(name)
      continue
    }
    keks.set(Number(match[1]), key)
  }

  return { keks, invalid }
}
