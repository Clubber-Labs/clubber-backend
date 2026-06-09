import { z } from 'zod'

export const forgotPasswordBodySchema = z.object({
  email: z.email(),
})

export const resetPasswordBodySchema = z.object({
  email: z.email(),
  // String (não número) para preservar zeros à esquerda no código de 6 dígitos.
  code: z.string().regex(/^\d{6}$/, 'Código inválido'),
  // Mínimo 8 (NIST prioriza comprimento sobre composição). Máx. 72 porque o bcrypt
  // ignora bytes além de 72 — sem o teto, parte da senha seria silenciosamente
  // truncada na verificação.
  newPassword: z.string().min(8).max(72),
})

export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>
export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>
