import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

/**
 * Decorators de autenticação — ÚNICO ponto que registra `authenticate`,
 * `authenticateOptional` e `authenticateMfaSetup`. Compartilhado entre o server
 * de produção e o app de teste para que os testes exercitem exatamente o mesmo
 * comportamento (sem drift entre os dois).
 */

type JwtPayload = { sub: string; mfaEnrollment?: boolean }

// O token de matrícula de MFA (`mfaEnrollment`) só autoriza o cadastro do
// segundo fator — não vale como sessão. É recusado em qualquer rota normal para
// não virar um token de acesso amplo de curta duração.
function rejectEnrollmentToken(payload: JwtPayload) {
  if (payload.mfaEnrollment) {
    throw {
      statusCode: 401,
      message: 'Token de matrícula de MFA não autoriza esta rota',
    }
  }
}

export function registerAuthDecorators(app: FastifyInstance) {
  app.decorate(
    'authenticate',
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const payload = await request.jwtVerify<JwtPayload>()
      rejectEnrollmentToken(payload)
      request.user = payload
    },
  )

  app.decorate(
    'authenticateOptional',
    async (request: FastifyRequest, _reply: FastifyReply) => {
      if (request.headers.authorization) {
        const payload = await request.jwtVerify<JwtPayload>()
        // Token de matrícula não confere identidade aqui: trata como anônimo.
        if (!payload.mfaEnrollment) request.user = payload
      }
    },
  )

  // Cadastro do MFA (setup/enable): aceita o token de matrícula (admin sem MFA,
  // emitido no login) OU um token de sessão normal. O gating por role=ADMIN fica
  // no service (assertAdmin), que relê o papel do banco.
  app.decorate(
    'authenticateMfaSetup',
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const payload = await request.jwtVerify<JwtPayload>()
      request.user = payload
    },
  )
}
