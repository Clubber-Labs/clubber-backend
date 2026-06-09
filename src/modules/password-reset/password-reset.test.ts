import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../test/app'
import { makeUser } from '../../test/factories'
import { fakeMailer } from '../../test/fake-mailer'
import { testPrisma } from '../../test/prisma'
import { reconcilePasswordResetCodes } from './password-reset.reconciler'

let app: FastifyInstance

beforeAll(async () => {
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await testPrisma.$disconnect()
})

/** Extrai o código de 6 dígitos do último e-mail enviado pelo fake mailer. */
function lastCode(): string {
  const match = fakeMailer.last?.text.match(/\b(\d{6})\b/)
  if (!match) throw new Error('nenhum código enviado no último e-mail')
  return match[1]
}

/** Devolve um código de 6 dígitos garantidamente diferente do informado. */
function wrongCode(real: string): string {
  return real === '000000' ? '111111' : '000000'
}

async function forgot(email: string) {
  return app.inject({
    method: 'POST',
    url: '/auth/forgot-password',
    body: { email },
  })
}

async function reset(email: string, code: string, newPassword: string) {
  return app.inject({
    method: 'POST',
    url: '/auth/reset-password',
    body: { email, code, newPassword },
  })
}

describe('POST /auth/forgot-password', () => {
  it('gera um código e envia e-mail para conta existente', async () => {
    const user = await makeUser()

    const res = await forgot(user.email)

    expect(res.statusCode).toBe(200)
    expect(fakeMailer.sent).toHaveLength(1)
    expect(fakeMailer.last?.to).toBe(user.email)

    const codes = await testPrisma.passwordResetCode.findMany({
      where: { userId: user.id },
    })
    expect(codes).toHaveLength(1)
    expect(codes[0].usedAt).toBeNull()
  })

  it('retorna 200 sem gerar código nem enviar e-mail para email inexistente', async () => {
    const res = await forgot('naoexiste@test.com')

    expect(res.statusCode).toBe(200)
    expect(fakeMailer.sent).toHaveLength(0)
    expect(await testPrisma.passwordResetCode.count()).toBe(0)
  })

  it('retorna 200 sem fazer nada para conta ANONYMIZED', async () => {
    const user = await makeUser({
      accountStatus: 'ANONYMIZED',
      password: null,
      anonymizedAt: new Date(),
    })

    const res = await forgot(user.email)

    expect(res.statusCode).toBe(200)
    expect(fakeMailer.sent).toHaveLength(0)
    expect(await testPrisma.passwordResetCode.count()).toBe(0)
  })

  it('não gera novo código dentro do cooldown (anti email bombing)', async () => {
    const user = await makeUser()

    await forgot(user.email)
    await forgot(user.email)

    // A segunda solicitação imediata é no-op: 1 e-mail, 1 código.
    expect(fakeMailer.sent).toHaveLength(1)
    const codes = await testPrisma.passwordResetCode.findMany({
      where: { userId: user.id },
    })
    expect(codes).toHaveLength(1)
  })

  it('requisições concorrentes não criam dois códigos ativos', async () => {
    const user = await makeUser()

    // Sem o advisory lock, ambas passariam a checagem de cooldown e criariam
    // dois códigos ativos. O lock serializa por usuário → só um é criado.
    await Promise.all([forgot(user.email), forgot(user.email)])

    const active = await testPrisma.passwordResetCode.findMany({
      where: { userId: user.id, usedAt: null },
    })
    expect(active).toHaveLength(1)
  })

  it('invalida o código anterior ao gerar um novo após o cooldown', async () => {
    const user = await makeUser()
    await forgot(user.email)

    // Envelhece o código além do cooldown (mas ainda dentro do TTL de 15 min).
    await testPrisma.passwordResetCode.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 10 * 60_000) },
    })

    await forgot(user.email)

    // Só o novo código permanece (o anterior foi apagado) e há 2 e-mails.
    const active = await testPrisma.passwordResetCode.findMany({
      where: { userId: user.id, usedAt: null },
    })
    expect(active).toHaveLength(1)
    expect(fakeMailer.sent).toHaveLength(2)

    // O novo código (último e-mail) é o válido.
    const ok = await reset(user.email, lastCode(), 'novaSenha1')
    expect(ok.statusCode).toBe(200)
  })

  it('retorna 429 após exceder o limite de tentativas no minuto', async () => {
    const user = await makeUser()

    for (let i = 0; i < 5; i++) {
      const res = await forgot(user.email)
      expect(res.statusCode).toBe(200)
    }

    const blocked = await forgot(user.email)
    expect(blocked.statusCode).toBe(429)
  })
})

describe('POST /auth/reset-password', () => {
  it('redefine a senha com código válido e permite login com a nova senha', async () => {
    const user = await makeUser()
    await forgot(user.email)
    const code = lastCode()

    const res = await reset(user.email, code, 'novaSenha1')
    expect(res.statusCode).toBe(200)

    const used = await testPrisma.passwordResetCode.findFirst({
      where: { userId: user.id },
    })
    expect(used?.usedAt).not.toBeNull()

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'novaSenha1' },
    })
    expect(login.statusCode).toBe(200)
    expect(login.json()).toHaveProperty('token')
  })

  it('permite que conta só-social (sem senha) defina uma senha', async () => {
    const user = await makeUser({ password: null })
    await forgot(user.email)

    const res = await reset(user.email, lastCode(), 'novaSenha1')
    expect(res.statusCode).toBe(200)

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      body: { email: user.email, password: 'novaSenha1' },
    })
    expect(login.statusCode).toBe(200)
  })

  it('reativa conta DEACTIVATED ao redefinir a senha', async () => {
    const user = await makeUser({
      accountStatus: 'DEACTIVATED',
      deactivatedAt: new Date(),
    })
    await forgot(user.email)

    const res = await reset(user.email, lastCode(), 'novaSenha1')
    expect(res.statusCode).toBe(200)

    const reloaded = await testPrisma.user.findUnique({
      where: { id: user.id },
      select: { accountStatus: true, deactivatedAt: true },
    })
    expect(reloaded?.accountStatus).toBe('ACTIVE')
    expect(reloaded?.deactivatedAt).toBeNull()
  })

  it('reativa conta PENDING_DELETION e cancela exclusão agendada', async () => {
    const user = await makeUser({
      accountStatus: 'PENDING_DELETION',
      deactivatedAt: new Date(),
      scheduledDeletionAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })
    await forgot(user.email)

    const res = await reset(user.email, lastCode(), 'novaSenha1')
    expect(res.statusCode).toBe(200)

    const reloaded = await testPrisma.user.findUnique({
      where: { id: user.id },
      select: { accountStatus: true, scheduledDeletionAt: true },
    })
    expect(reloaded?.accountStatus).toBe('ACTIVE')
    expect(reloaded?.scheduledDeletionAt).toBeNull()
  })

  it('retorna 400 com código incorreto e incrementa as tentativas', async () => {
    const user = await makeUser()
    await forgot(user.email)
    const code = lastCode()

    const res = await reset(user.email, wrongCode(code), 'novaSenha1')
    expect(res.statusCode).toBe(400)

    const record = await testPrisma.passwordResetCode.findFirst({
      where: { userId: user.id },
    })
    expect(record?.attempts).toBe(1)
    expect(record?.usedAt).toBeNull()
  })

  it('retorna 400 com código expirado', async () => {
    const user = await makeUser()
    await forgot(user.email)
    const code = lastCode()

    await testPrisma.passwordResetCode.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    })

    const res = await reset(user.email, code, 'novaSenha1')
    expect(res.statusCode).toBe(400)
  })

  it('trava o código após exceder o máximo de tentativas', async () => {
    const user = await makeUser()
    await forgot(user.email)
    const code = lastCode()
    const bad = wrongCode(code)

    for (let i = 0; i < 5; i++) {
      const res = await reset(user.email, bad, 'novaSenha1')
      expect(res.statusCode).toBe(400)
    }

    // Mesmo com o código CORRETO, segue travado.
    const locked = await reset(user.email, code, 'novaSenha1')
    expect(locked.statusCode).toBe(400)
  })

  it('não permite reutilizar um código já usado', async () => {
    const user = await makeUser()
    await forgot(user.email)
    const code = lastCode()

    const first = await reset(user.email, code, 'novaSenha1')
    expect(first.statusCode).toBe(200)

    const second = await reset(user.email, code, 'outraSenha2')
    expect(second.statusCode).toBe(400)
  })

  it('retorna 400 para email inexistente', async () => {
    const res = await reset('naoexiste@test.com', '123456', 'novaSenha1')
    expect(res.statusCode).toBe(400)
  })

  it('retorna 400 para conta ANONYMIZED', async () => {
    const user = await makeUser({
      accountStatus: 'ANONYMIZED',
      password: null,
      anonymizedAt: new Date(),
    })

    const res = await reset(user.email, '123456', 'novaSenha1')
    expect(res.statusCode).toBe(400)
  })

  it('retorna 400 quando a nova senha tem menos de 8 caracteres', async () => {
    const user = await makeUser()
    await forgot(user.email)

    const res = await reset(user.email, lastCode(), '1234567')
    expect(res.statusCode).toBe(400)
  })

  it('uso concorrente do mesmo código: só uma redefinição vence', async () => {
    const user = await makeUser()
    await forgot(user.email)
    const code = lastCode()

    const [a, b] = await Promise.all([
      reset(user.email, code, 'novaSenha1'),
      reset(user.email, code, 'outraSenha2'),
    ])

    // A guarda atômica de uso único garante exatamente um 200 e um 400.
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 400])
  })

  it('retorna 429 após exceder o limite de tentativas no minuto', async () => {
    const body = {
      email: 'naoexiste@test.com',
      code: '000000',
      newPassword: 'novaSenha1',
    }

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        body,
      })
      expect(res.statusCode).toBe(400)
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      body,
    })
    expect(blocked.statusCode).toBe(429)
  })
})

describe('reconciler de expurgo de códigos (retenção LGPD)', () => {
  it('remove códigos usados e expirados, preserva os ativos', async () => {
    const user = await makeUser()
    const now = new Date()

    await testPrisma.passwordResetCode.createMany({
      data: [
        {
          userId: user.id,
          codeHash: 'usado',
          expiresAt: new Date(now.getTime() + 60_000),
          usedAt: now,
        },
        {
          userId: user.id,
          codeHash: 'expirado',
          expiresAt: new Date(now.getTime() - 60_000),
        },
        {
          userId: user.id,
          codeHash: 'ativo',
          expiresAt: new Date(now.getTime() + 60_000),
        },
      ],
    })

    const { deleted } = await reconcilePasswordResetCodes(now)
    expect(deleted).toBe(2)

    const remaining = await testPrisma.passwordResetCode.findMany({
      where: { userId: user.id },
    })
    expect(remaining).toHaveLength(1)
    expect(remaining[0].codeHash).toBe('ativo')
  })
})
