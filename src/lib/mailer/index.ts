import { env } from '../env'
import { LogMailerService } from './log-mailer.service'
import type { IMailerService } from './mailer.interface'
import { ResendMailerService } from './resend-mailer.service'

let instance: IMailerService | null = null

/**
 * Resolve o mailer pela env (lazy). NUNCA lança no load — credenciais ausentes
 * do Resend só estouram no sendMail (igual ao storage). Default `log` mantém o
 * boot seguro em dev/test/prod sem configuração. Chame SEMPRE por requisição
 * (dentro do service), nunca no escopo de módulo, para o setMailer dos testes
 * vencer.
 */
export function getMailer(): IMailerService {
  if (instance) return instance

  instance =
    env.EMAIL_DRIVER === 'resend'
      ? new ResendMailerService(env.RESEND_API_KEY ?? '', env.EMAIL_FROM)
      : new LogMailerService()

  return instance
}

/** Permite injetar um mailer customizado em testes. */
export function setMailer(svc: IMailerService): void {
  instance = svc
}

export * from './mailer.interface'
