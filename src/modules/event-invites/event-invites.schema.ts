import { z } from 'zod'

export const eventInviteParamSchema = z.object({
  eventId: z.uuid('ID do evento inválido'),
})

export type EventInviteParam = z.infer<typeof eventInviteParamSchema>

export const inviteUsersBodySchema = z
  .object({
    // se omitido, convida todos os seguidores
    userIds: z.array(z.uuid()).min(1).optional(),
  })
  .optional()

export type InviteUsersBody = z.infer<typeof inviteUsersBodySchema>

// Contrato do GET: o usuário vem ANINHADO em `invited` e o app achata na
// fronteira dele — mudar este shape quebra clients em produção via OTA. O
// schema congela os campos e barra vazamento acidental de coluna nova.
export const eventInviteListSchema = z.array(
  z.object({
    id: z.uuid(),
    eventId: z.uuid(),
    inviterId: z.uuid(),
    invitedId: z.uuid(),
    createdAt: z.date(),
    invited: z.object({
      id: z.uuid(),
      name: z.string(),
      lastname: z.string(),
      username: z.string(),
      avatarUrl: z.string().nullable(),
    }),
  }),
)
