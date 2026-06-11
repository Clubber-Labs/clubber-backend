import { z } from 'zod'
import {
  booleanQuery,
  categoryFilter,
  eventCategoriesInput,
} from '../events/events.schema'

export const spotVisibilitySchema = z.enum(['PUBLIC', 'FRIENDS'])

export const createSpotSchema = z
  .object({
    title: z.string().min(3),
    description: z.string().optional(),
    categories: eventCategoriesInput,
    visibility: spotVisibilitySchema.default('PUBLIC'),
    // Âncora do estabelecimento (place_id do Google Places) + coordenadas.
    placeId: z.string().min(1),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((v) => v.endsAt > v.startsAt, {
    message: 'endsAt deve ser depois de startsAt',
    path: ['endsAt'],
  })

// Edição parcial: só título e descrição (horário/categorias/local são imutáveis
// no PR de domínio). Exige ao menos um campo.
export const updateSpotSchema = z
  .object({
    title: z.string().min(3).optional(),
    description: z.string().nullable().optional(),
  })
  .refine((v) => v.title !== undefined || v.description !== undefined, {
    message: 'Informe ao menos um campo para atualizar',
  })

export const spotParamSchema = z.object({
  id: z.string().uuid(),
})

// Mapa: spots dentro da bbox visível. Visibilidade (público/amigos) e janela
// ativa são resolvidas no service/repository, não como parâmetro do cliente.
export const listSpotsQuerySchema = z
  .object({
    bboxNorth: z.coerce.number().min(-90).max(90),
    bboxSouth: z.coerce.number().min(-90).max(90),
    bboxEast: z.coerce.number().min(-180).max(180),
    bboxWest: z.coerce.number().min(-180).max(180),
    category: categoryFilter,
    friendsOnly: booleanQuery.default(false),
    limit: z.coerce.number().int().min(1).max(300).default(200),
  })
  .refine((q) => q.bboxNorth > q.bboxSouth, {
    message: 'bboxNorth deve ser maior que bboxSouth',
    path: ['bboxNorth'],
  })
  .refine((q) => q.bboxEast > q.bboxWest, {
    message: 'bboxEast deve ser maior que bboxWest',
    path: ['bboxEast'],
  })

// Geração de sugestões: ponto em torno do qual buscar (centro do mapa / posição).
export const suggestionsSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
})

export type CreateSpotBody = z.infer<typeof createSpotSchema>
export type UpdateSpotBody = z.infer<typeof updateSpotSchema>
export type SpotParam = z.infer<typeof spotParamSchema>
export type ListSpotsQuery = z.infer<typeof listSpotsQuerySchema>
export type SuggestionsBody = z.infer<typeof suggestionsSchema>
