import { z } from 'zod'

export const socialLoginBodySchema = z.object({
  provider: z.enum(['google', 'facebook']),
  token: z.string().min(10, 'Token é obrigatório'),
})

export type SocialLoginBody = z.infer<typeof socialLoginBodySchema>

export type VerifiedSocialProfile = {
  provider: 'GOOGLE' | 'FACEBOOK'
  providerUserId: string
  email: string | null
  emailVerified: boolean
  firstName: string | null
  lastName: string | null
  pictureUrl: string | null
}
