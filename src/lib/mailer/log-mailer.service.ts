import { logger } from '../logger'
import type { IMailerService, SendMailInput } from './mailer.interface'

const log = logger.child({ component: 'log-mailer' })

/**
 * Driver de e-mail para dev/test: não envia nada, só escreve o conteúdo no log.
 * Em dev é onde o desenvolvedor lê o código OTP de recuperação no terminal.
 */
export class LogMailerService implements IMailerService {
  async sendMail({ to, subject, text }: SendMailInput): Promise<void> {
    log.info({ to, subject, text }, 'Email (driver log)')
  }
}
