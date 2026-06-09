export interface SendMailInput {
  to: string
  subject: string
  html: string
  text: string
}

export interface IMailerService {
  sendMail(input: SendMailInput): Promise<void>
}
