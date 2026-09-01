import { describe, expect, it } from 'vitest'
import { anthropicClientOptions } from './index'

// Chave pessoal/de service account multi-workspace (o padrão do Console hoje) só
// funciona se TODA request levar `anthropic-workspace-id`; sem o header a API
// responde 400 e a camada de IA inteira cai no template, silenciosamente para o
// usuário. Nenhum SDK manda esse header sozinho — o wiring aqui é que garante.
describe('anthropicClientOptions', () => {
  it('manda anthropic-workspace-id em todo request quando o workspace está configurado', () => {
    const options = anthropicClientOptions({
      apiKey: 'sk-ant-api03-x',
      workspaceId: 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ',
      timeout: 1000,
    })

    expect(options.defaultHeaders).toEqual({
      'anthropic-workspace-id': 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ',
    })
  })

  it('sem workspace, não manda o header (chave de workspace único dispensa)', () => {
    const options = anthropicClientOptions({
      apiKey: 'sk-ant-api03-x',
      workspaceId: undefined,
      timeout: 1000,
    })

    expect(options).not.toHaveProperty('defaultHeaders')
  })

  it('preserva chave, timeout e o teto de retries do SLA', () => {
    const options = anthropicClientOptions({
      apiKey: 'sk-ant-api03-x',
      workspaceId: undefined,
      timeout: 12_000,
    })

    expect(options).toMatchObject({
      apiKey: 'sk-ant-api03-x',
      timeout: 12_000,
      maxRetries: 1,
    })
  })
})
