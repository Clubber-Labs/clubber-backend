import type { FastifyReply, FastifyRequest } from 'fastify'
import { issueSession } from '../auth/auth.session'
import type { SocialLoginBody } from './social-auth.schema'
import { socialLogin } from './social-auth.service'

export async function postSocialLogin(
  request: FastifyRequest<{ Body: SocialLoginBody }>,
  reply: FastifyReply,
) {
  const { user, profileIncomplete } = await socialLogin(request.body)
  const { token, refreshToken } = await issueSession(reply, user.id, {
    userAgent: request.headers['user-agent'] ?? null,
    ip: request.ip,
  })
  request.log.info(
    { userId: user.id, provider: request.body.provider },
    'User logged in with social provider',
  )
  return reply.send({ token, refreshToken, user, profileIncomplete })
}
