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
import { usersRoutes } from './modules/users/users.routes'

const app = fastify().withTypeProvider<ZodTypeProvider>()

app.setValidatorCompiler(validatorCompiler)
app.setSerializerCompiler(serializerCompiler)

app.setErrorHandler((error: Error, _request, reply) => {
  const statusCode = (error as {statusCode?: number}).statusCode ?? 500
  const message = error.message ?? 'Internal Server Error'
  reply.status(statusCode).send({ message })
})

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
  async (request: FastifyRequest, _reply: FastifyReply) => {
    const payload = await request.jwtVerify<{ sub: string }>()
    request.user = payload
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
app.register(usersRoutes)

app.listen({ port: 3333, host: '0.0.0.0' }).then(() => {
  console.log('🔥 Server is running on http://localhost:3333')
})
