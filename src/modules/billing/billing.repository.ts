import { Prisma, type SubscriptionStatus } from '@prisma/client'
import { prisma } from '../../lib/prisma'

type TxClient = Prisma.TransactionClient

// Statuses que o reconciler de sync considera "vivos" e re-sincroniza quando
// vencidos — inclui TRIALING órfão de propósito (o re-sync confirma o cancel no
// fim do trial). NÃO é o mesmo que "premium" — ver PREMIUM_GRANTING_OR.
const ACTIVE_STATUSES: SubscriptionStatus[] = ['TRIALING', 'ACTIVE', 'PAST_DUE']

// Predicado "premium-granting": subscription que de fato entrega valor.
// ACTIVE/PAST_DUE implicam cobrança (o cartão existiu); TRIALING só conta com
// cartão confirmado (defaultPaymentMethodId) — um trial órfão (PaymentSheet
// aberto e abandonado, sem cartão) NÃO concede premium. Fonte única usada por
// recalculateUserPremiumTx E findActiveSubscriptionByUserId pra não divergirem.
const PREMIUM_GRANTING_OR: Prisma.SubscriptionWhereInput[] = [
  { status: { in: ['ACTIVE', 'PAST_DUE'] } },
  { status: 'TRIALING', defaultPaymentMethodId: { not: null } },
]

/**
 * Subscription "ativa" do user = a que concede premium (MESMA regra de
 * recalculateUserPremiumTx, via PREMIUM_GRANTING_OR). Um trial órfão (sem
 * cartão) NÃO entra: senão o guard 409 travaria o retry de quem abandonou a
 * sheet e o GET /billing/subscription mostraria uma assinatura que não vale
 * nada. Com histórico (canceladas + nova ativa), retorna a mais recente por
 * startedAt.
 */
export async function findActiveSubscriptionByUserId(userId: string) {
  return prisma.subscription.findFirst({
    where: { userId, OR: PREMIUM_GRANTING_OR },
    orderBy: { startedAt: 'desc' },
  })
}

/**
 * True se o usuário já teve uma subscription que VALEU algo — política de
 * produto: um trial por usuário. Quem já usou um trial REAL ou pagou não ganha
 * trial de novo, mesmo voltando após cancelar.
 *
 * "Valeu algo" = teve cartão confirmado (defaultPaymentMethodId) OU chegou a um
 * status de cobrança (ACTIVE/PAST_DUE/UNPAID). De fora ficam:
 * - INCOMPLETE/INCOMPLETE_EXPIRED: sheet sem trial aberta e abandonada.
 * - TRIALING/CANCELED ÓRFÃO (sem cartão): o trial do PaymentSheet nasce
 *   `trialing` sem cartão; abrir e fechar a sheet — ou nem abrir — deixa um
 *   órfão. Contá-lo queimaria o trial de quem nunca chegou a usá-lo, que é
 *   justamente o que esta função sempre quis evitar.
 */
export async function hasAnyPreviousSubscription(userId: string) {
  const count = await prisma.subscription.count({
    where: {
      userId,
      OR: [
        { defaultPaymentMethodId: { not: null } },
        { status: { in: ['ACTIVE', 'PAST_DUE', 'UNPAID'] } },
      ],
    },
  })
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
 * Subscriptions "vencidas": status ainda ativo localmente, mas
 * currentPeriodEnd além da tolerância — sinal de webhook perdido (renovação
 * teria avançado o período; cancelamento teria mudado o status).
 *
 * O filtro de lastSyncedAt evita re-poll: uma PAST_DUE em retry de cobrança
 * fica semanas com período vencido LEGITIMAMENTE — sem o filtro, seria
 * re-consultada no Stripe a cada tick; com ele, no máximo 1x por janela de
 * grace. Como webhooks aplicados também avançam lastSyncedAt, o critério vira
 * "só re-consulta quem está MUDO há mais que o grace" — quem recebe eventos
 * normalmente nem entra no lote.
 *
 * Usa o índice [status, currentPeriodEnd]. `limit` protege o tick do
 * reconciler de um backlog gigante; o restante fica pros próximos ticks.
 */
export async function findStaleActiveSubscriptions(
  cutoff: Date,
  limit: number,
) {
  return prisma.subscription.findMany({
    where: {
      status: { in: ACTIVE_STATUSES },
      currentPeriodEnd: { lt: cutoff },
      lastSyncedAt: { lt: cutoff },
    },
    orderBy: { currentPeriodEnd: 'asc' },
    take: limit,
    select: { stripeSubscriptionId: true, userId: true },
  })
}

/**
 * Cancela localmente uma subscription que não existe mais no gateway
 * (resource_missing no re-sync). lastSyncedAt avança junto: eventos de
 * webhook mais velhos que o sync são descartados pelo ordering check.
 */
export async function markSubscriptionCanceledTx(
  tx: TxClient,
  stripeSubscriptionId: string,
  canceledAt: Date,
) {
  return tx.subscription.update({
    where: { stripeSubscriptionId },
    data: { status: 'CANCELED', canceledAt, lastSyncedAt: canceledAt },
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
 * isPremium = true se existe ao menos uma subscription que entrega valor:
 * - ACTIVE/PAST_DUE: implicam cobrança (paga ou tentada) — o cartão existiu.
 * - TRIALING: SÓ conta com método de pagamento anexado. O PaymentSheet cria a
 *   subscription como trial ANTES de coletar o cartão (default_incomplete +
 *   trial_period_days nasce 'trialing' sem cartão); sem esse gate, abrir a
 *   sheet e abandonar — ou nem abrir — já daria premium grátis por 7 dias. O
 *   defaultPaymentMethodId é gravado quando o SetupIntent conclui.
 */
export async function recalculateUserPremiumTx(tx: TxClient, userId: string) {
  // Mesma regra de findActiveSubscriptionByUserId — ver PREMIUM_GRANTING_OR.
  const activeCount = await tx.subscription.count({
    where: { userId, OR: PREMIUM_GRANTING_OR },
  })
  return tx.user.update({
    where: { id: userId },
    data: { isPremium: activeCount > 0 },
  })
}

/**
 * Carimba o método de pagamento coletado (via SetupIntent do trial) nas
 * subscriptions TRIALING ainda sem cartão do user — o sinal que destrava o
 * premium do trial (ver recalculateUserPremiumTx). updateMany + filtro
 * `defaultPaymentMethodId: null` torna idempotente: reentregas do webhook não
 * sobrescrevem nem afetam linhas já carimbadas. Retorna a contagem afetada.
 *
 * updateMany (e não um stripeSubscriptionId específico) é intencional: o
 * setup_intent não referencia a subscription, e um user que chamou subscribe
 * em buckets de minuto distintos pode ter mais de uma TRIALING órfã — todas
 * são carimbadas. Inofensivo: ele vira premium de um jeito ou de outro, e as
 * órfãs sem cobrança real cancelam no fim do trial (missing_payment_method).
 */
export async function setTrialingPaymentMethodTx(
  tx: TxClient,
  userId: string,
  paymentMethodId: string,
) {
  return tx.subscription.updateMany({
    where: { userId, status: 'TRIALING', defaultPaymentMethodId: null },
    data: { defaultPaymentMethodId: paymentMethodId },
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
  defaultPaymentMethodId: string | null
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
      // "Sticky": o cartão entra pelo SetupIntent (setTrialingPaymentMethodTx) e
      // o payload da subscription em trial traz default_payment_method=null. Um
      // `update` posterior com null NÃO pode zerar o cartão já registrado e
      // revogar o premium — `?? undefined` mantém a coluna intacta nesse caso.
      defaultPaymentMethodId: data.defaultPaymentMethodId ?? undefined,
      lastSyncedAt: data.lastSyncedAt,
    },
  })
}
