import type { Job, Queue, Worker } from 'bullmq'
import { env } from '../../lib/env'
import { logger } from '../../lib/logger'
import { notificationQueueFailuresTotal } from '../../lib/metrics'
import { createQueue, createWorker } from '../../lib/queue'
import {
  CHAT_MESSAGE_PUSH_DELAY_MS,
  runChatMessagePush,
} from './chat-push.service'
import { type PushContent, sendPushToUsers } from './notification-push.service'
import { runPromotionReachFanout } from './promotion-fanout.service'
import { runEventCreatedFanout } from './proximity-fanout.service'
import {
  runSpotJoinedFanout,
  runSpotPublishedFanout,
} from './spot-fanout.service'

const QUEUE_NAME = 'notifications'

/**
 * jobId determinístico com separador seguro: o BullMQ (>=5.78) rejeita ':' em
 * jobId customizado ("Custom Id cannot contain :") e o enqueue best-effort
 * engoliria o erro — o job simplesmente nunca entraria na fila.
 */
export function deterministicJobId(...parts: string[]): string {
  return parts.join('_')
}

type NotificationJob =
  | { kind: 'event.created'; eventId: string }
  | { kind: 'promotion.started'; eventId: string }
  | { kind: 'spot.published'; spotId: string }
  | { kind: 'spot.joined'; spotId: string; joinerId: string }
  | { kind: 'notification.push'; userId: string; content: PushContent }
  | { kind: 'chat.message.push'; messageId: string }

/**
 * Falha de fila é best-effort (nunca quebra a ação principal), mas não pode ser
 * SÓ um warn: o contador é o alarme, o log é o contexto. `stage` separa perder
 * o job antes da fila (enqueue) de falhar processando (process).
 */
export function recordQueueFailure(
  stage: 'enqueue' | 'process',
  kind: NotificationJob['kind'] | 'unknown',
  err: unknown,
  context: Record<string, unknown> = {},
): void {
  notificationQueueFailuresTotal.inc({ stage, kind })
  const msg =
    stage === 'enqueue'
      ? `falha ao enfileirar ${kind}`
      : 'notification job falhou'
  logger.warn({ err, ...context }, msg)
}

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
        jobId: deterministicJobId('event.created', eventId),
        removeOnComplete: true,
        removeOnFail: 200,
      },
    )
  } catch (err) {
    recordQueueFailure('enqueue', 'event.created', err, { eventId })
  }
}

/**
 * Enfileira o alcance da promoção assim que a janela do destaque abre — o push
 * pago não pode esperar o próximo tick de um reconciler. Best-effort.
 */
export async function enqueuePromotionStarted(eventId: string): Promise<void> {
  const q = getQueue()
  if (!q) return
  try {
    await q.add(
      'promotion.started',
      { kind: 'promotion.started', eventId },
      {
        jobId: deterministicJobId('promotion.started', eventId),
        removeOnComplete: true,
        removeOnFail: 200,
        // Diferente dos fan-outs gratuitos: aqui a entrega foi paga, então uma
        // falha transiente tem que ser retentada em vez de sumir. O fan-out é
        // idempotente pela dedupeKey, então re-executar só cobre quem faltou.
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    )
  } catch (err) {
    recordQueueFailure('enqueue', 'promotion.started', err, { eventId })
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
        jobId: deterministicJobId('spot.published', spotId),
        removeOnComplete: true,
        removeOnFail: 200,
      },
    )
  } catch (err) {
    recordQueueFailure('enqueue', 'spot.published', err, { spotId })
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
        jobId: deterministicJobId('spot.joined', spotId, joinerId),
        removeOnComplete: true,
        removeOnFail: 200,
      },
    )
  } catch (err) {
    recordQueueFailure('enqueue', 'spot.joined', err, { spotId, joinerId })
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
    recordQueueFailure('enqueue', 'notification.push', err, { userId })
  }
}

/**
 * Enfileira o push de uma mensagem de chat, com DELAY proposital: o job só
 * roda depois que quem estava online já recebeu via socket (e avançou o
 * watermark de entrega) — o processador então notifica apenas quem ficou pra
 * trás. Best-effort, como os demais enqueues.
 */
export async function enqueueChatMessagePush(messageId: string): Promise<void> {
  const q = getQueue()
  if (!q) return
  try {
    await q.add(
      'chat.message.push',
      { kind: 'chat.message.push', messageId },
      {
        jobId: deterministicJobId('chat.message.push', messageId),
        delay: CHAT_MESSAGE_PUSH_DELAY_MS,
        removeOnComplete: true,
        removeOnFail: 200,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    )
  } catch (err) {
    recordQueueFailure('enqueue', 'chat.message.push', err, { messageId })
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
      } else if (job.data.kind === 'promotion.started') {
        await runPromotionReachFanout(job.data.eventId)
      } else if (job.data.kind === 'spot.published') {
        await runSpotPublishedFanout(job.data.spotId)
      } else if (job.data.kind === 'spot.joined') {
        await runSpotJoinedFanout(job.data.spotId, job.data.joinerId)
      } else if (job.data.kind === 'notification.push') {
        await sendPushToUsers([job.data.userId], job.data.content)
      } else if (job.data.kind === 'chat.message.push') {
        await runChatMessagePush(job.data.messageId)
      }
    },
    { concurrency: 4 },
  )
  if (worker) {
    worker.on('failed', (job, err) => {
      recordQueueFailure('process', job?.data?.kind ?? 'unknown', err, {
        jobId: job?.id,
        kind: job?.data?.kind,
      })
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
