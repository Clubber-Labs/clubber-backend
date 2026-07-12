import { z } from 'zod'

// Guarda de custo: além do debounce de 500ms no app, o backend só busca com
// 3+ caracteres — abaixo disso o Autocomplete devolve ruído e cobra igual.
export const placesAutocompleteQuerySchema = z
  .object({
    q: z.string().trim().min(3, 'Busca exige ao menos 3 caracteres').max(120),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radiusMeters: z.coerce.number().int().positive().max(50000).optional(),
    sessionToken: z.string().min(1).max(128).optional(),
  })
  .refine((q) => (q.lat === undefined) === (q.lng === undefined), {
    message: 'lat e lng devem ser fornecidos juntos',
    path: ['lat'],
  })

export const placeDetailsParamsSchema = z.object({
  placeId: z.string().min(1).max(512),
})

export const placeDetailsQuerySchema = z.object({
  sessionToken: z.string().min(1).max(128).optional(),
})

export type PlacesAutocompleteQuery = z.infer<
  typeof placesAutocompleteQuerySchema
>
export type PlaceDetailsParams = z.infer<typeof placeDetailsParamsSchema>
export type PlaceDetailsQuery = z.infer<typeof placeDetailsQuerySchema>
