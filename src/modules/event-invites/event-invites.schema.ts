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
