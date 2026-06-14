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

// Rotação do refresh token (/auth/refresh) e logout (revoga o apresentado).
// O token é `randomBytes(32).toString('base64url')` = 43 chars; o min/max corta
// entradas obviamente inválidas antes de chegar ao banco.
export const refreshBodySchema = z.object({
  refreshToken: z.string().min(40).max(100),
})

export type LoginBody = z.infer<typeof loginBodySchema>
export type MfaCodeBody = z.infer<typeof mfaCodeSchema>
export type RefreshBody = z.infer<typeof refreshBodySchema>
