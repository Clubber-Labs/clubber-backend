import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { authenticateWsToken, type WsClaims } from './ws-auth'

// Fake mínimo: o helper só toca em app.jwt.verify; isBlocked é injetado.
function fakeApp(verify: (token: string) => WsClaims): FastifyInstance {
  return { jwt: { verify } } as unknown as FastifyInstance
}

const notBlocked = async () => false
const blocked = async () => true

describe('authenticateWsToken', () => {
  it('retorna os claims quando o token é válido e a conta não está bloqueada', async () => {
    const app = fakeApp(() => ({ sub: 'u1', exp: 123 }))
    expect(await authenticateWsToken(app, 'tok', notBlocked)).toEqual({
      sub: 'u1',
      exp: 123,
    })
  })

  it('retorna null quando o token é inválido (verify lança)', async () => {
    const app = fakeApp(() => {
      throw new Error('invalid')
    })
    expect(await authenticateWsToken(app, 'ruim', notBlocked)).toBeNull()
  })

  it('retorna null para token de matrícula de MFA (não vale como sessão)', async () => {
    const app = fakeApp(() => ({ sub: 'u1', mfaEnrollment: true }))
    expect(await authenticateWsToken(app, 'tok', notBlocked)).toBeNull()
  })

  it('retorna null quando a conta está na denylist de moderação (banida/suspensa)', async () => {
    const app = fakeApp(() => ({ sub: 'banido' }))
    expect(await authenticateWsToken(app, 'tok', blocked)).toBeNull()
  })
})
