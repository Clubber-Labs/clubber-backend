import { fastifyCors } from '@fastify/cors'
import fastifyJwt from '@fastify/jwt'
import { fastifySwagger } from '@fastify/swagger'
import ScalarApiReference from '@scalar/fastify-api-reference'
import { type FastifyReply, type FastifyRequest, fastify } from 'fastify'
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { authRoutes } from './modules/auth/auth.routes'
import { eventsRoutes } from './modules/events/events.routes'

const app = fastify().withTypeProvider<ZodTypeProvider>()

app.setValidatorCompiler(validatorCompiler)
app.setSerializerCompiler(serializerCompiler)

app.register(fastifyCors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
})

app.register(fastifyJwt, {
  secret: process.env.JWT_SECRET ?? 'fallback_secret',
})

app.decorate(
  'authenticate',
  async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify()
    } catch {
      reply.status(401).send({ message: 'Unauthorized' })
    }
  },
)

app.register(fastifySwagger, {
  openapi: {
    info: {
      title: 'ConnectAI API',
      description: 'API documentation for ConnectAI backend',
      version: '1.0.0',
    },
  },
  transform: jsonSchemaTransform,
})

app.register(ScalarApiReference, {
  routePrefix: '/docs',
})

app.register(authRoutes)
app.register(eventsRoutes)

app.listen({ port: 3333, host: '0.0.0.0' }).then(() => {
  console.log('Server is running on http://localhost:3333')
})
