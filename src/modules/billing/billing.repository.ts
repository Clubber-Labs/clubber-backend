import { Prisma, type SubscriptionStatus } from '@prisma/client'
import { prisma } from '../../lib/prisma'

type TxClient = Prisma.TransactionClient

const ACTIVE_STATUSES: SubscriptionStatus[] = ['TRIALING', 'ACTIVE', 'PAST_DUE']

/**
 * Subscription "ativa" do user — status que entrega valor (com isPremium=true).
 * Quando há histórico (canceladas + nova ativa), retorna a mais recente por startedAt.
 */
export async function findActiveSubscriptionByUserId(userId: string) {
  return prisma.subscription.findFirst({
    where: { userId, status: { in: ACTIVE_STATUSES } },
    orderBy: { startedAt: 'desc' },
  })
}

/**
 * True se o usuário já teve qualquer subscription (ativa, expirada, cancelada).
 * Usado pra decidir se concede trial novo (não concede se já teve).
 * Mitigação parcial de trial abuse — ver "Trial abuse" no plano.
 */
export async function hasAnyPreviousSubscription(userId: string) {
  const count = await prisma.subscription.count({ where: { userId } })
  return count > 0
}

/** Busca o user por id (camada de billing — service não toca Prisma). */
export async function findUserById(userId: string) {
  return prisma.user.findUnique({ where: { id: userId } })
}

/**
 * Fonte de verdade de leitura do estado premium. O billing é dono do conceito
 * (escreve via recalculateUserPremiumTx); consumidores de fora — o middleware
 * requirePremium e o módulo spots — leem por aqui em vez de reimplementar a
 * query contra a coluna. Se "premium" passar a depender de mais de um sinal,
 * muda só neste ponto.
 */
export async function findUserIsPremium(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isPremium: true },
  })
  return user?.isPremium ?? false
}

/** Vincula o Customer do Stripe ao user. */
export async function updateUserStripeCustomerId(
  userId: string,
  stripeCustomerId: string,
) {
  return prisma.user.update({
    where: { id: userId },
    data: { stripeCustomerId },
  })
}

/**
 * Zera o vínculo com o gateway apenas se ainda aponta pro id esperado —
 * condicional pra nunca apagar um vínculo recriado em paralelo por outro
 * fluxo (ensureStripeCustomer).
 */
export async function clearUserStripeCustomerIdIfMatches(
  userId: string,
  stripeCustomerId: string,
) {
  return prisma.user.updateMany({
    where: { id: userId, stripeCustomerId },
    data: { stripeCustomerId: null },
  })
}

/** Marca/desmarca o cancelamento ao fim do período numa subscription local. */
export async function setSubscriptionCancelAtPeriodEnd(
  id: string,
  cancelAtPeriodEnd: boolean,
) {
  return prisma.subscription.update({
    where: { id },
    data: { cancelAtPeriodEnd },
  })
}

/**
 * Reads tx-aware usados pelo handler do webhook dentro da $transaction.
 * Mantêm o Prisma confinado ao repository mesmo no caminho transacional — o
 * webhook orquestra, mas não toca o client direto.
 */
export async function findUserIdByStripeCustomerIdTx(
  tx: TxClient,
  stripeCustomerId: string,
) {
  const user = await tx.user.findUnique({
    where: { stripeCustomerId },
    select: { id: true },
  })
  return user?.id ?? null
}

export async function findSubscriptionByStripeIdTx(
  tx: TxClient,
  stripeSubscriptionId: string,
) {
  return tx.subscription.findUnique({ where: { stripeSubscriptionId } })
}

export async function isEventProcessed(stripeEventId: string) {
  const row = await prisma.webhookEvent.findUnique({
    where: { stripeEventId },
    select: { id: true },
  })
  return row !== null
}

/**
 * Expurgo (retenção/minimização LGPD) dos eventos de webhook processados: o
 * payload guarda o evento Stripe inteiro (e-mail, nome, dados de cobrança).
 * A idempotência só precisa de uma janela recente — o Stripe reenvia eventos
 * por no máximo alguns dias — então linhas além do prazo somem inteiras.
 */
export async function deleteWebhookEventsOlderThan(cutoff: Date) {
  const { count } = await prisma.webhookEvent.deleteMany({
    where: { processedAt: { lt: cutoff } },
  })
  return count
}

/**
 * Boundary da transação do billing. Mantém o `prisma.$transaction` (e a
 * config de timeout/maxWait) dentro do repository — única camada que toca o
 * client — para que o handler do webhook orquestre sem importar o Prisma.
 * O `maxWait` curto + `timeout` de 10s pressupõem que nenhuma chamada externa
 * (Stripe) roda dentro do callback (regra cumprida na fase externa do webhook).
 */
export async function runInBillingTransaction<T>(
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(fn, { timeout: 10_000, maxWait: 2_000 })
}

/**
 * Insere o evento como "processado". Deve rodar dentro da transação do
 * handler do webhook. Se duplicado, lança P2002 — o caller usa
 * `isDuplicateWebhookEventError` e retorna 200 silencioso (idempotência via
 * constraint do DB). Recebe o payload como `unknown` e faz o cast pro tipo do
 * Prisma aqui, confinando o tipo do ORM ao repository.
 */
export async function markEventProcessedTx(
  tx: TxClient,
  data: {
    stripeEventId: string
    type: string
    payload: unknown
  },
) {
  return tx.webhookEvent.create({
    data: {
      stripeEventId: data.stripeEventId,
      type: data.type,
      payload: data.payload as Prisma.InputJsonValue,
    },
  })
}

/**
 * Predicado de erro P2002 (unique constraint) usado pela idempotência do
 * webhook. Encapsula o tipo de erro do Prisma para que o handler não precise
 * importar o namespace do ORM só pra checar a corrida do INSERT.
 */
export function isDuplicateWebhookEventError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  )
}

/**
 * Recalcula User.isPremium baseado em TODAS as subscriptions do user.
 * Necessário porque o schema permite múltiplas subscriptions (histórico
 * de canceladas + nova ativa), e atualizar isPremium a partir de UM
 * evento isolado deixa o estado incorreto quando outra subscription
 * ainda está ativa.
 *
 * isPremium = true se existe pelo menos uma subscription com status em
 * (TRIALING, ACTIVE, PAST_DUE).
 */
export async function recalculateUserPremiumTx(tx: TxClient, userId: string) {
  const activeCount = await tx.subscription.count({
    where: {
      userId,
      status: { in: ACTIVE_STATUSES },
    },
  })
  return tx.user.update({
    where: { id: userId },
    data: { isPremium: activeCount > 0 },
  })
}

type UpsertSubscriptionInput = {
  userId: string
  stripeSubscriptionId: string
  stripePriceId: string
  status: SubscriptionStatus
  trialEndsAt: Date | null
  currentPeriodStart: Date
  currentPeriodEnd: Date
  cancelAtPeriodEnd: boolean
  canceledAt: Date | null
  lastSyncedAt: Date
}

export async function upsertSubscriptionTx(
  tx: TxClient,
  data: UpsertSubscriptionInput,
) {
  return tx.subscription.upsert({
    where: { stripeSubscriptionId: data.stripeSubscriptionId },
    create: data,
    update: {
      stripePriceId: data.stripePriceId,
      status: data.status,
      trialEndsAt: data.trialEndsAt,
      currentPeriodStart: data.currentPeriodStart,
      currentPeriodEnd: data.currentPeriodEnd,
      cancelAtPeriodEnd: data.cancelAtPeriodEnd,
      canceledAt: data.canceledAt,
      lastSyncedAt: data.lastSyncedAt,
    },
  })
}
