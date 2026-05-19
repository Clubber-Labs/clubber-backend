import { z } from 'zod'

export const featuredEventParamsSchema = z.object({
  id: z.uuid(),
})

export const featuredEventFeatureParamsSchema = z.object({
  id: z.uuid(),
  featureId: z.uuid(),
})

export const createFeaturedEventBodySchema = z
  .object({
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((d) => d.startsAt < d.endsAt, {
    message: 'startsAt deve ser anterior a endsAt',
    path: ['endsAt'],
  })

export type CreateFeaturedEventBody = z.infer<
  typeof createFeaturedEventBodySchema
>
export type FeaturedEventParams = z.infer<typeof featuredEventParamsSchema>
export type FeaturedEventFeatureParams = z.infer<
  typeof featuredEventFeatureParamsSchema
>
