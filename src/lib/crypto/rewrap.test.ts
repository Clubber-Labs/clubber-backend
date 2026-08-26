import { describe, expect, it } from 'vitest'
import { randomDek } from './aead'
import { EnvKeyProvider } from './env-key-provider.service'
import type { IKeyProvider, WrappedKey } from './key-provider.interface'
import { type RewrapSource, rewrapCandidate } from './rewrap'

const KEK_V1 = Buffer.alloc(32, 0x11)
const KEK_V2 = Buffer.alloc(32, 0x22)
const AAD = 'conv-dek:v1:11111111-1111-1111-1111-111111111111'

function provider(entries: [number, Buffer][], active: number) {
  return new EnvKeyProvider(new Map(entries), active)
}

/** Fonte em memória: o motor não conhece Prisma, então o teste também não. */
function sourceStub(overrides: Partial<RewrapSource> = {}): RewrapSource & {
  persisted: { id: string; from: number; wrapped: WrappedKey }[]
} {
  const persisted: { id: string; from: number; wrapped: WrappedKey }[] = []
  return {
    persisted,
    name: 'stub',
    countPending: async () => [],
    findPending: async () => [],
    persist: async (id, from, wrapped) => {
      persisted.push({ id, from, wrapped })
      return 1
    },
    ...overrides,
  }
}

async function candidateFor(dek: Buffer, kekVersion: number) {
  const wrapped = await provider([[1, KEK_V1]], 1).wrap(dek, AAD)
  return { id: 'row-1', aad: AAD, wrappedDek: wrapped.blob, kekVersion }
}

describe('rewrapCandidate', () => {
  it('reembrulha na KEK ativa preservando o DEK', async () => {
    const dek = randomDek()
    const candidate = await candidateFor(dek, 1)
    const source = sourceStub()
    const ativo = provider(
      [
        [1, KEK_V1],
        [2, KEK_V2],
      ],
      2,
    )

    expect(await rewrapCandidate(candidate, source, ativo)).toBe('rewrapped')

    const [gravado] = source.persisted
    expect(gravado.from).toBe(1)
    expect(gravado.wrapped.kekVersion).toBe(2)
    // O que importa não é o envelope novo, é o segredo dentro dele continuar
    // sendo o mesmo — senão todo o histórico cifrado com ele fica ilegível.
    expect((await ativo.unwrap(gravado.wrapped, AAD)).equals(dek)).toBe(true)
  })

  it('trata blob vazio como shred, sem chamar o provider', async () => {
    const explode: IKeyProvider = {
      activeVersion: () => 2,
      wrap: () => Promise.reject(new Error('não deveria envelopar')),
      unwrap: () => Promise.reject(new Error('não deveria desembrulhar')),
    }
    const source = sourceStub()

    const outcome = await rewrapCandidate(
      { id: 'row-1', aad: AAD, wrappedDek: new Uint8Array(0), kekVersion: 1 },
      source,
      explode,
    )

    expect(outcome).toBe('skipped')
    expect(source.persisted).toHaveLength(0)
  })

  it('devolve skipped quando o compare-and-set não pega a linha', async () => {
    const candidate = await candidateFor(randomDek(), 1)
    const source = sourceStub({ persist: async () => 0 })

    const outcome = await rewrapCandidate(
      candidate,
      source,
      provider(
        [
          [1, KEK_V1],
          [2, KEK_V2],
        ],
        2,
      ),
    )

    // Outra instância chegou primeiro — corrida esperada, não falha.
    expect(outcome).toBe('skipped')
  })

  it('lança quando a KEK antiga saiu do ambiente', async () => {
    const candidate = await candidateFor(randomDek(), 1)

    await expect(
      rewrapCandidate(candidate, sourceStub(), provider([[2, KEK_V2]], 2)),
    ).rejects.toThrow(/CHAT_KEK_V1/)
  })

  it('não persiste envelope que não reproduz a DEK', async () => {
    const dek = randomDek()
    const candidate = await candidateFor(dek, 1)
    const source = sourceStub()
    // Provider defeituoso: envelopa lixo. Sem a verificação de round-trip isto
    // gravaria em massa material impossível de abrir.
    const corrompido: IKeyProvider = {
      activeVersion: () => 2,
      unwrap: async (wrapped: WrappedKey) =>
        wrapped.kekVersion === 1 ? dek : Buffer.alloc(32, 0xff),
      wrap: async () => ({ kekVersion: 2, blob: Buffer.alloc(60, 0xee) }),
    }

    await expect(
      rewrapCandidate(candidate, source, corrompido),
    ).rejects.toThrow(/não reproduziu/)
    expect(source.persisted).toHaveLength(0)
  })
})
