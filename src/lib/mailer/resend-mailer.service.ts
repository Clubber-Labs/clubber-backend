import { Resend } from 'resend'
import { AppError } from '../errors/app-error'
import type { IMailerService, SendMailInput } from './mailer.interface'

/**
 * Driver de e-mail de produção via Resend. Recebe credenciais no construtor
 * (resolvidas pela factory a partir do env) — espelha o R2StorageService.
 */
export class ResendMailerService implements IMailerService {
  private readonly client: Resend

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey)
  }

  async sendMail({ to, subject, html, text }: SendMailInput): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to,
      subject,
      html,
      text,
    })
    if (error) {
      throw new AppError(502, 'EMAIL_SEND_FAILED')
    }
  }
}
