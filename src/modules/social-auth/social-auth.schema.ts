import { z } from 'zod'

export const socialLoginBodySchema = z.object({
  provider: z.enum(['google', 'apple']),
  token: z.string().min(10, 'Token é obrigatório'),
  // Gotcha da Apple: o nome não vem no identityToken — só é entregue ao app no
  // primeiro consentimento, por isso atravessa pelo body. Client-fornecido e
  // inofensivo: usado só na criação da conta e editável pelo usuário.
  fullName: z
    .object({
      givenName: z.string().max(100).nullable(),
      familyName: z.string().max(100).nullable(),
    })
    .optional(),
})

export type SocialLoginBody = z.infer<typeof socialLoginBodySchema>

export type VerifiedSocialProfile = {
  provider: 'GOOGLE' | 'APPLE'
  providerUserId: string
  email: string | null
  emailVerified: boolean
  firstName: string | null
  lastName: string | null
  pictureUrl: string | null
}
