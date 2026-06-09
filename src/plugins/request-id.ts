import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'

// Ecoa o id da request no header da resposta para o cliente correlacionar.
// Setado em onRequest para que mesmo respostas de erro carreguem o header.
// O valor de request.id vem do genReqId (ver lib/request-id).
async function requestIdPluginFn(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id)
  })
}

export const requestIdPlugin = fp(requestIdPluginFn, {
  name: 'request-id-plugin',
})
