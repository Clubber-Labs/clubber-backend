import { z } from 'zod'
import { timezoneSchema } from '../../lib/i18n/timezone'

export const loginBodySchema = z
  .object({
    // E-mail OU username, resolvido no service (ambos case-insensitive). String
    // livre de propósito: os dois formatos têm charsets incompatíveis, então
    // qualquer validação de um recusaria identificadores válidos do outro.
    identifier: z.string().trim().min(1).max(255).optional(),
    // Legado: builds do app já publicadas só sabem enviar `email`. Aceito como
    // sinônimo de identifier — deixou de ser z.email() para não haver dois
    // formatos de resposta (400 de validação vs 401) pro mesmo erro de digitação.
    email: z.string().trim().min(1).max(255).optional(),
    password: z.string().min(6),
    // Código do app autenticador (6 dígitos) ou um código de recuperação.
    // Opcional: só exigido quando a conta tem MFA ativo.
    mfaCode: z.string().min(6).max(20).optional(),
    // IANA do aparelho — login é um dos pontos onde o app conhece o device.
    timezone: timezoneSchema.optional(),
  })
  .refine((body) => Boolean(body.identifier ?? body.email), {
    message: 'Informe seu e-mail ou nome de usuário',
    path: ['identifier'],
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
