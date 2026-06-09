export interface PushMessage {
  /** Expo push token do device de destino. */
  to: string
  title: string
  body: string
  data?: Record<string, unknown>
}

/** Resultado por mensagem enviada (ticket do Expo). */
export interface PushTicketResult {
  status: 'ok' | 'error'
  /** Token de destino — correlaciona o ticket ao DeviceToken. */
  token: string
  /** receiptId, presente quando status==='ok' — usado para buscar o receipt. */
  ticketId?: string
  /** Código de erro do Expo (ex.: 'DeviceNotRegistered'), quando status==='error'. */
  error?: string
}

/** Resultado de um receipt (confirmação assíncrona de entrega). */
export interface PushReceiptResult {
  status: 'ok' | 'error'
  error?: string
}

export interface IPushService {
  /** Envia mensagens (faz chunking interno) e devolve um ticket por mensagem. */
  send(messages: PushMessage[]): Promise<PushTicketResult[]>
  /** Busca os receipts dos tickets enviados (chamar ~15min depois). */
  getReceipts(ticketIds: string[]): Promise<Map<string, PushReceiptResult>>
}

/** Ação a tomar para um device a partir do erro de um ticket/receipt. */
export type PushErrorAction = 'remove_token' | 'retry' | 'alert' | 'none'

/**
 * Mapeia o código de erro do Expo para a ação correta. Só `DeviceNotRegistered`
 * autoriza remover o token; `MessageRateExceeded` é retry com backoff; qualquer
 * outro erro (credencial do projeto, payload, provider) vira alerta operacional;
 * sem erro, nada a fazer. Códigos: DeveloperError | DeviceNotRegistered |
 * ExpoError | InvalidCredentials | MessageRateExceeded | MessageTooBig |
 * ProviderError (expo-server-sdk 6.x).
 */
export function classifyPushError(error?: string): PushErrorAction {
  switch (error) {
    case 'DeviceNotRegistered':
      return 'remove_token'
    case 'MessageRateExceeded':
      return 'retry'
    case undefined:
    case '':
      return 'none'
    default:
      return 'alert'
  }
}
