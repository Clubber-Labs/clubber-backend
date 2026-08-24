// Cache das DEKs já DESEMBRULHADAS, em memória do processo.
//
// NUNCA no Redis: uma DEK aberta fora do processo anula o envelope inteiro —
// quem lesse o Redis dispensaria a KEK. O preço é que a invalidação (rotação,
// crypto-shredding) só é imediata na instância local; nas demais, o TTL abaixo
// é o LIMITE SUPERIOR da janela em que uma chave revogada ainda decifra.

export const DEK_CACHE_TTL_MS = 15 * 60 * 1000
export const DEK_CACHE_MAX_ENTRIES = 5000

type Entry = { dek: Buffer; expiresAt: number }

const cache = new Map<string, Entry>()

export function conversationDekCacheKey(
  conversationId: string,
  version: number,
): string {
  return `conv:${conversationId}:${version}`
}

export function getCachedDek(key: string): Buffer | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key)
    return null
  }
  // Re-inserção move a entrada para o fim: o Map preserva ordem de inserção,
  // então o primeiro item é sempre o menos usado recentemente (LRU).
  cache.delete(key)
  cache.set(key, entry)
  return entry.dek
}

export function setCachedDek(key: string, dek: Buffer): void {
  cache.delete(key)
  cache.set(key, { dek, expiresAt: Date.now() + DEK_CACHE_TTL_MS })
  while (cache.size > DEK_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}

/** Remove TODAS as versões da conversa — rotação e shred não sabem qual está em cache. */
export function invalidateDek(conversationId: string): void {
  const prefix = `conv:${conversationId}:`
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

/** Só para testes: o cache é global do processo e vazaria entre casos. */
export function __resetDekCache(): void {
  cache.clear()
}
