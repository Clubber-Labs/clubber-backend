import type { FastifyReply, FastifyRequest } from 'fastify'
import type { SeriesParams } from './recurring-events.schema'
import { cancelSeries } from './recurring-events.service'

export async function deleteSeriesHandler(
  request: FastifyRequest<{ Params: SeriesParams }>,
  reply: FastifyReply,
) {
  const { seriesId } = request.params
  await cancelSeries(seriesId, request.user.sub)
  request.log.info(
    { userId: request.user.sub, seriesId },
    'User canceled recurring event series',
  )
  return reply.status(204).send()
}
