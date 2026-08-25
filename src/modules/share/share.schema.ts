import { z } from 'zod'

// Frouxo de propósito: a rota é aberta em browser — token estranho deve cair
// no 404 amigável da landing, não num 400 de validação em JSON.
export const shareTokenParamSchema = z.object({
  token: z.string().min(1).max(128),
})

export type ShareTokenParam = z.infer<typeof shareTokenParamSchema>
