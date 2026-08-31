import { z } from 'zod'

export const eventInviteParamSchema = z.object({
  eventId: z.uuid('ID do evento inválido'),
})

export type EventInviteParam = z.infer<typeof eventInviteParamSchema>

// `strictObject` é o gate central: com `object` o Zod DESCARTA chave
// desconhecida, e como "sem lista" significa "convida todos os seguidores",
// um nome de campo errado virava fan-out em massa respondendo 201.
export const inviteUsersBodySchema = z
  .strictObject({
    userIds: z.array(z.uuid()).min(1).optional(),
    // Sinônimo de userIds: a base instalada do app manda este nome. Remover
    // quando ela tiver migrado.
    invitedIds: z.array(z.uuid()).min(1).optional(),
    // Intenção explícita de convidar todos os seguidores. Sem lista e sem
    // `all` ainda convida todos (contrato antigo, mantido pela base instalada).
    all: z.literal(true).optional(),
  })
  .refine((body) => !(body.userIds && body.invitedIds), {
    message: 'Envie userIds ou invitedIds, não os dois',
  })
  .refine((body) => !(body.all && (body.userIds ?? body.invitedIds)), {
    message: 'all não combina com uma lista de convidados',
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
