import type { Job, Queue, Worker } from 'bullmq'
import { env } from '../../lib/env'
import { logger } from '../../lib/logger'
import { createQueue, createWorker } from '../../lib/queue'
import { type PushContent, sendPushToUsers } from './notification-push.service'
import { runEventCreatedFanout } from './proximity-fanout.service'
import {
  runSpotJoinedFanout,
  runSpotPublishedFanout,
} from './spot-fanout.service'

const QUEUE_NAME = 'notifications'

type NotificationJob =
  | { kind: 'event.created'; eventId: string }
  | { kind: 'spot.published'; spotId: string }
  | { kind: 'spot.joined'; spotId: string; joinerId: string }
  | { kind: 'notification.push'; userId: string; content: PushContent }

let queue: Queue<NotificationJob> | null = null
let queueResolved = false

// A fila só existe com a feature ligada E Redis configurado. Resolvida uma vez
// (lazy) — sem Redis, createQueue devolve null e os enqueues viram no-op
// (notificação é best-effort; ver o refine de boot do env em produção).
function getQueue(): Queue<NotificationJob> | null {
  if (queueResolved) return queue
  queueResolved = true
  // Em teste a fila fica inerte (enqueue vira no-op) — os processadores
  // (fan-out, push, receipts) são testados diretamente, sem BullMQ/Redis.
  if (env.NOTIFICATIONS_ENABLED && env.NODE_ENV !== 'test') {
    queue = createQueue<NotificationJob>(QUEUE_NAME)
  }
  return queue
}

/** Enfileira o fan-out de proximidade de um evento. Best-effort. */
export async function enqueueEventCreated(eventId: string): Promise<void> {
  const q = getQueue()
  if (!q) return
  try {
    await q.add(
      'event.created',
      { kind: 'event.created', eventId },
      {
        // jobId determinístico colapsa enqueues duplicados do mesmo evento
        // (válido p/ jobs WAITING/DELAYED; se já estiver ACTIVE, o segundo
        // roda — a idempotência do fan-out garante que nada duplica).
        jobId: `event.created:${eventId}`,
        removeOnComplete: true,
        removeOnFail: 200,
      },
    )
  } catch (err) {
    logger.warn({ err, eventId }, 'falha ao enfileirar event.created')
  }
}

/** Enfileira o fan-out de proximidade de um spot recém-publicado. Best-effort. */
export async function enqueueSpotPublished(spotId: string): Promise<void> {
  const q = getQueue()
  if (!q) return
  try {
    await q.add(
      'spot.published',
      { kind: 'spot.published', spotId },
      {
        jobId: `spot.published:${spotId}`,
        removeOnComplete: true,
        removeOnFail: 200,
      },
    )
  } catch (err) {
    logger.warn({ err, spotId }, 'falha ao enfileirar spot.published')
  }
}

/** Enfileira a notificação de entrada num spot (criador + membros). Best-effort. */
export async function enqueueSpotJoined(
  spotId: string,
  joinerId: string,
): Promise<void> {
  const q = getQueue()
  if (!q) return
  try {
    await q.add(
      'spot.joined',
      { kind: 'spot.joined', spotId, joinerId },
      {
        jobId: `spot.joined:${spotId}:${joinerId}`,
        removeOnComplete: true,
        removeOnFail: 200,
      },
    )
  } catch (err) {
    logger.warn({ err, spotId, joinerId }, 'falha ao enfileirar spot.joined')
  }
}

/** Enfileira o envio de push de uma notificação (social). Best-effort. */
export async function enqueuePush(
  userId: string,
  content: PushContent,
): Promise<void> {
  const q = getQueue()
  if (!q) return
  try {
    await q.add(
      'notification.push',
      { kind: 'notification.push', userId, content },
      {
        removeOnComplete: true,
        removeOnFail: 200,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    )
  } catch (err) {
    logger.warn({ err, userId }, 'falha ao enfileirar notification.push')
  }
}

let worker: Worker<NotificationJob> | null = null

export function startNotificationsWorker(): void {
  if (worker) return
  worker = createWorker<NotificationJob>(
    QUEUE_NAME,
    async (job: Job<NotificationJob>) => {
      if (job.data.kind === 'event.created') {
        await runEventCreatedFanout(job.data.eventId)
      } else if (job.data.kind === 'spot.published') {
        await runSpotPublishedFanout(job.data.spotId)
      } else if (job.data.kind === 'spot.joined') {
        await runSpotJoinedFanout(job.data.spotId, job.data.joinerId)
      } else if (job.data.kind === 'notification.push') {
        await sendPushToUsers([job.data.userId], job.data.content)
      }
    },
    { concurrency: 4 },
  )
  if (worker) {
    worker.on('failed', (job, err) => {
      logger.warn(
        { err, jobId: job?.id, kind: job?.data?.kind },
        'notification job falhou',
      )
    })
    logger.info('notifications worker iniciado')
  }
}

export async function stopNotificationsWorker(): Promise<void> {
  if (worker) {
    await worker.close()
    worker = null
  }
  if (queue) {
    await queue.close()
    queue = null
  }
  queueResolved = false
}
