import { describe, expect, it } from 'vitest'
import { anthropicWorkspaceIdSchema, isInternalRedisHost } from './env'

// `ANTHROPIC_WORKSPACE_ID=` vazio (copiado do .env.example) tem que valer como
// "não configurado", igual ao ANTHROPIC_API_KEY= da linha de cima — não derrubar
// o boot.
describe('anthropicWorkspaceIdSchema', () => {
  it('aceita ausente e trata string vazia como ausente', () => {
    expect(anthropicWorkspaceIdSchema.parse(undefined)).toBeUndefined()
    expect(anthropicWorkspaceIdSchema.parse('')).toBeUndefined()
  })

  it('aceita id no formato do Console', () => {
    expect(
      anthropicWorkspaceIdSchema.parse('wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ'),
    ).toBe('wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ')
  })

  it('rejeita valor fora do formato com mensagem legível no boot', () => {
    const result = anthropicWorkspaceIdSchema.safeParse('sk-ant-api03-x')
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain('wrkspc_')
  })
})

// Esta função decide QUANDO NÃO exigir TLS no Redis de produção. Um falso
// positivo aqui libera o texto decifrado do chat a trafegar em claro por uma
// rede não confiável, então os casos de borda importam.
describe('isInternalRedisHost', () => {
  it('aceita nome de serviço do compose (rótulo único)', () => {
    expect(isInternalRedisHost('redis://redis-service:6379')).toBe(true)
    expect(isInternalRedisHost('redis://redis:6379/0')).toBe(true)
  })

  it('aceita loopback e IP privado', () => {
    expect(isInternalRedisHost('redis://localhost:6379')).toBe(true)
    expect(isInternalRedisHost('redis://127.0.0.1:6379')).toBe(true)
    expect(isInternalRedisHost('redis://10.0.1.5:6379')).toBe(true)
    expect(isInternalRedisHost('redis://172.20.0.3:6379')).toBe(true)
    expect(isInternalRedisHost('redis://192.168.1.10:6379')).toBe(true)
    expect(isInternalRedisHost('redis://[::1]:6379')).toBe(true)
  })

  it('recusa host público, mesmo com credenciais na URL', () => {
    expect(isInternalRedisHost('redis://cache.upstash.io:6379')).toBe(false)
    expect(
      isInternalRedisHost('redis://user:pass@redis.example.com:6379'),
    ).toBe(false)
  })

  it('recusa IP público que só parece privado', () => {
    // 172.32 está FORA do bloco privado (172.16–172.31).
    expect(isInternalRedisHost('redis://172.32.0.1:6379')).toBe(false)
    expect(isInternalRedisHost('redis://11.0.0.1:6379')).toBe(false)
  })

  it('recusa URL que não parseia — na dúvida, exige TLS', () => {
    expect(isInternalRedisHost('redis://')).toBe(false)
    expect(isInternalRedisHost('não é url')).toBe(false)
  })
})
