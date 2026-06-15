import { z } from 'zod'

export const loginBodySchema = z.object({
  email: z.email(),
  password: z.string().min(6),
  // Código do app autenticador (6 dígitos) ou um código de recuperação.
  // Opcional: só exigido quando a conta tem MFA ativo.
  mfaCode: z.string().min(6).max(20).optional(),
})

// Confirmação do cadastro / desativação do MFA: exige um código válido.
export const mfaCodeSchema = z.object({
  code: z.string().min(6).max(20),
})

export type LoginBody = z.infer<typeof loginBodySchema>
export type MfaCodeBody = z.infer<typeof mfaCodeSchema>
