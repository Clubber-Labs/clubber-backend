import type {
  IPushService,
  PushMessage,
  PushReceiptResult,
  PushTicketResult,
} from '../lib/push'

/**
 * Push fake para testes: não envia nada, guarda o que foi "enviado" e devolve
 * tickets `ok` por padrão. Espelha o FakeMailerService — injetado via
 * setPushService no setup.ts. `ticketFor` e `receipts` permitem roteirizar
 * erros (DeviceNotRegistered, etc.) cenário a cenário.
 */
export class FakePushService implements IPushService {
  sent: PushMessage[] = []
  /** Sobrescreva para roteirizar o ticket de uma mensagem (ex.: erro). */
  ticketFor: (message: PushMessage, index: number) => PushTicketResult = (
    message,
    index,
  ) => ({ status: 'ok', token: message.to, ticketId: `ticket-${index}` })
  /** Receipts roteirizados por ticketId; ausentes viram `ok`. */
  receipts = new Map<string, PushReceiptResult>()

  async send(messages: PushMessage[]): Promise<PushTicketResult[]> {
    const results = messages.map((m, i) => this.ticketFor(m, i))
    this.sent.push(...messages)
    return results
  }

  async getReceipts(
    ticketIds: string[],
  ): Promise<Map<string, PushReceiptResult>> {
    const out = new Map<string, PushReceiptResult>()
    for (const id of ticketIds) {
      out.set(id, this.receipts.get(id) ?? { status: 'ok' })
    }
    return out
  }

  reset(): void {
    this.sent = []
    this.receipts.clear()
    this.ticketFor = (message, index) => ({
      status: 'ok',
      token: message.to,
      ticketId: `ticket-${index}`,
    })
  }
}

export const fakePush = new FakePushService()
