import type { IMailerService, SendMailInput } from '../lib/mailer'

/**
 * Mailer fake para testes: não envia nada, só guarda o que foi "enviado".
 * Espelha o FakeStorageService — injetado via setMailer no setup.ts.
 */
export class FakeMailerService implements IMailerService {
  sent: SendMailInput[] = []

  async sendMail(input: SendMailInput): Promise<void> {
    this.sent.push(input)
  }

  get last(): SendMailInput | undefined {
    return this.sent[this.sent.length - 1]
  }

  reset() {
    this.sent = []
  }
}

export const fakeMailer = new FakeMailerService()
