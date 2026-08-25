import { z } from 'zod'

export const inviteLinkEventParamSchema = z.object({
  eventId: z.uuid('ID do evento inválido'),
})

export type InviteLinkEventParam = z.infer<typeof inviteLinkEventParamSchema>

export const inviteLinkIdParamSchema = z.object({
  eventId: z.uuid('ID do evento inválido'),
  linkId: z.uuid('ID do link inválido'),
})

export type InviteLinkIdParam = z.infer<typeof inviteLinkIdParamSchema>

export const inviteTokenParamSchema = z.object({
  token: z.string().min(1).max(64),
})

export type InviteTokenParam = z.infer<typeof inviteTokenParamSchema>
