import { timingSafeEqual } from 'node:crypto'
import type { IKeyProvider, WrappedKey } from './key-provider.interface'

// Reembrulha DEKs existentes na KEK ativa. Módulo PURO: não conhece Prisma nem
// domínio. Quem sabe montar a AAD é a FONTE — o motor nunca constrói uma, porque
// AAD errada aqui torna ilegível o que já estava gravado.

export type RewrapCandidate = {
  id: string
  aad: string
  wrappedDek: Uint8Array
  kekVersion: number
}

export type RewrapPending = { kekVersion: number; pending: number }

export type RewrapSource = {
  /** Rótulo de métrica e log — o nome da tabela. */
  name: string
  countPending(activeVersion: number): Promise<RewrapPending[]>
  findPending(activeVersion: number, limit: number): Promise<RewrapCandidate[]>
  /**
   * UPDATE com compare-and-set em `kekVersion`, gravando envelope e versão
   * JUNTOS. Devolve o número de linhas afetadas: 0 significa que outra instância
   * chegou primeiro.
   */
  persist(
    id: string,
    fromKekVersion: number,
    wrapped: WrappedKey,
  ): Promise<number>
}

export type RewrapOutcome = 'rewrapped' | 'skipped'

/**
 * A AAD NÃO muda no rewrap: ela deriva do contexto (conversa, denúncia), não da
 * KEK. Reembrulhar é trocar o envelope do MESMO segredo com o MESMO contexto —
 * trocar a AAD seria migração de dados.
 *
 * Lança em falha real (KEK antiga fora do ambiente, envelope corrompido). Quem
 * isola a linha problemática do resto do lote é o reconciler, que assim ainda
 * tem o erro em mãos para logar — engolir aqui esconderia justamente o alarme de
 * "removeram a KEK antiga cedo demais".
 */
export async function rewrapCandidate(
  candidate: RewrapCandidate,
  source: RewrapSource,
  provider: IKeyProvider,
): Promise<RewrapOutcome> {
  // Blob vazio é crypto-shredding ou expurgo de evidência, não erro: a chave foi
  // destruída de propósito e o unwrap só produziria ruído no log.
  if (candidate.wrappedDek.length === 0) return 'skipped'

  const dek = await provider.unwrap(
    {
      kekVersion: candidate.kekVersion,
      blob: Buffer.from(candidate.wrappedDek),
    },
    candidate.aad,
  )
  const wrapped = await provider.wrap(dek, candidate.aad)

  // Verificação ANTES de gravar. O pior defeito possível nesta rotina é
  // persistir em massa um envelope que não abre — perda de dados silenciosa,
  // percebida só quando alguém tentar ler. O custo é um unwrap a mais.
  const roundTrip = await provider.unwrap(wrapped, candidate.aad)
  if (roundTrip.length !== dek.length || !timingSafeEqual(roundTrip, dek)) {
    throw new Error(
      `rewrap não reproduziu a DEK original (${source.name} ${candidate.id})`,
    )
  }

  const affected = await source.persist(
    candidate.id,
    candidate.kekVersion,
    wrapped,
  )
  // 0 = outra instância reembrulhou entre o SELECT e o UPDATE. O compare-and-set
  // é o que dispensa lock distribuído: sem ele, duas réplicas poderiam intercalar
  // e gravar um par (envelope, versão) inconsistente.
  return affected > 0 ? 'rewrapped' : 'skipped'
}
