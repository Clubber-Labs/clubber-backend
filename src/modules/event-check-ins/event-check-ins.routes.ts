import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { rateLimit } from '../../lib/rate-limit'
import { postCheckIn } from './event-check-ins.controller'
import { eventCheckInParamSchema } from './event-check-ins.schema'

export async function eventCheckInsRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  // "Cheguei" do evento ao vivo. Idempotente: repetir devolve 201 sem duplicar,
  // porque o app reenvia em retry de rede.
  api.post(
    '/events/:eventId/check-ins',
    {
      schema: { params: eventCheckInParamSchema },
      onRequest: [app.authenticate],
      config: { rateLimit: rateLimit(20) },
    },
    postCheckIn,
  )
}
