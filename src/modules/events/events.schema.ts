import { z } from 'zod'
import {
  eventCategorySchema,
  selectableCategorySchema,
} from '../../lib/event-categories'
import { EVENT_STATUSES } from '../../lib/event-lifecycle'
import { recurrenceSchema } from '../recurring-events/recurring-events.schema'

const ONE_YEAR_MS = 365 * 86_400_000

const eventStatusEnum = z.enum(EVENT_STATUSES)

/** Boolean a partir de querystring: aceita true/false como string ou boolean. */
export const booleanQuery = z
  .union([z.boolean(), z.literal('true'), z.literal('false')])
  .transform((v) => v === true || v === 'true')

export const statusFilter = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined
    const list = (Array.isArray(value) ? value : [value])
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
    const unique = Array.from(new Set(list))
    return unique.length > 0 ? unique : undefined
  })
  .pipe(z.array(eventStatusEnum).optional())

export const categoryFilter = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined
    const list = (Array.isArray(value) ? value : [value])
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
    const unique = Array.from(new Set(list))
    return unique.length > 0 ? unique : undefined
  })
  // Filtro de BUSCA: aceita qualquer categoria armazenável (incl. legada como
  // RELIGION), para não quebrar a consulta de dado antigo. Só a CRIAÇÃO
  // (eventCategoriesInput) restringe ao selecionável.
  .pipe(z.array(eventCategorySchema).optional())

// Categorias que o evento POSSUI (mín. 1, sem duplicatas). Distinto do
// categoryFilter acima, que é o filtro de busca por categoria na listagem.
export const eventCategoriesInput = z
  .array(selectableCategorySchema)
  .min(1, 'Informe ao menos uma categoria')
  .max(5, 'Máximo de 5 categorias')
  .transform((list) => Array.from(new Set(list)))

export const createEventSchema = z
  .object({
    title: z.string().min(3),
    description: z.string().optional(),
    date: z.coerce.date(),
    endDate: z.coerce.date().optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    address: z.string().optional(),
    categories: eventCategoriesInput,
    isPublic: z.boolean().default(true),
    maxCapacity: z.number().optional(),
    canceledAt: z.coerce.date().optional(),
    // RF11.6: bloco opcional de recorrência (premium-only, validado no service).
    recurrence: recurrenceSchema.optional(),
  })
  .refine((v) => !v.endDate || v.endDate > v.date, {
    message: 'endDate deve ser depois de date',
    path: ['endDate'],
  })
  .refine(
    (v) =>
      !v.recurrence?.until ||
      v.recurrence.until.getTime() <= v.date.getTime() + ONE_YEAR_MS,
    {
      message: 'until não pode passar de 1 ano após a data do evento',
      path: ['recurrence', 'until'],
    },
  )
  .refine(
    // until antes da data do evento geraria zero ocorrências → criação quebraria
    // (first = undefined). Rejeita no schema com 400 em vez de estourar 500.
    (v) =>
      !v.recurrence?.until || v.recurrence.until.getTime() >= v.date.getTime(),
    {
      message: 'until não pode ser antes da data do evento',
      path: ['recurrence', 'until'],
    },
  )

export const updateEventSchema = z
  .object({
    title: z.string().min(3).optional(),
    description: z.string().optional(),
    date: z.coerce.date().optional(),
    endDate: z.coerce.date().nullable().optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    categories: eventCategoriesInput.optional(),
    isPublic: z.boolean().optional(),
    canceledAt: z.coerce.date().nullable().optional(),
  })
  .refine((v) => !v.date || !v.endDate || v.endDate > v.date, {
    message: 'endDate deve ser depois de date',
    path: ['endDate'],
  })

export const eventParamSchema = z.object({
  id: z.string().uuid(),
})

export const listEventsQuerySchema = z
  .object({
    category: categoryFilter,
    status: statusFilter,
    includePast: booleanQuery.default(false),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
    nearLat: z.coerce.number().min(-90).max(90).optional(),
    nearLng: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().positive().max(500).optional(),
    orderBy: z.enum(['date', 'distance']).default('date'),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine((q) => (q.nearLat === undefined) === (q.nearLng === undefined), {
    message: 'nearLat e nearLng devem ser fornecidos juntos',
    path: ['nearLat'],
  })
  .refine(
    (q) =>
      q.radiusKm === undefined ||
      (q.nearLat !== undefined && q.nearLng !== undefined),
    { message: 'radiusKm exige nearLat e nearLng', path: ['radiusKm'] },
  )
  .refine(
    (q) =>
      q.orderBy !== 'distance' ||
      (q.nearLat !== undefined && q.nearLng !== undefined),
    { message: 'orderBy=distance exige nearLat e nearLng', path: ['orderBy'] },
  )
  .refine((q) => q.orderBy !== 'distance' || q.cursor === undefined, {
    message: 'orderBy=distance não suporta paginação via cursor',
    path: ['cursor'],
  })

export const mapEventsQuerySchema = z
  .object({
    bboxNorth: z.coerce.number().min(-90).max(90),
    bboxSouth: z.coerce.number().min(-90).max(90),
    bboxEast: z.coerce.number().min(-180).max(180),
    bboxWest: z.coerce.number().min(-180).max(180),
    category: categoryFilter,
    status: statusFilter,
    friendsOnly: booleanQuery.default(false),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
  })
  .refine((q) => q.bboxNorth > q.bboxSouth, {
    message: 'bboxNorth deve ser maior que bboxSouth',
    path: ['bboxNorth'],
  })
  .refine((q) => q.bboxEast > q.bboxWest, {
    message: 'bboxEast deve ser maior que bboxWest',
    path: ['bboxEast'],
  })

// Viewport: eventos completos (FeedEvent) dentro da área visível, com cap.
export const viewportQuerySchema = z
  .object({
    bboxNorth: z.coerce.number().min(-90).max(90),
    bboxSouth: z.coerce.number().min(-90).max(90),
    bboxEast: z.coerce.number().min(-180).max(180),
    bboxWest: z.coerce.number().min(-180).max(180),
    category: categoryFilter,
    status: statusFilter,
    friendsOnly: booleanQuery.default(false),
    // Mapa: pins + preview leve. Teto menor que a lista — menos hidratação e
    // payload por request (o detalhe completo vem do GET /events/:id).
    limit: z.coerce.number().int().min(1).max(150).default(100),
  })
  .refine((q) => q.bboxNorth > q.bboxSouth, {
    message: 'bboxNorth deve ser maior que bboxSouth',
    path: ['bboxNorth'],
  })
  .refine((q) => q.bboxEast > q.bboxWest, {
    message: 'bboxEast deve ser maior que bboxWest',
    path: ['bboxEast'],
  })

// Busca textual global por título/descrição/endereço, paginada por cursor.
export const searchEventsQuerySchema = z.object({
  q: z.string().trim().min(2, 'Busca exige ao menos 2 caracteres'),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export const userEventsParamsSchema = z.object({
  userId: z.string().uuid(),
})

export const userEventsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export type UserEventsParams = z.infer<typeof userEventsParamsSchema>
export type UserEventsQuery = z.infer<typeof userEventsQuerySchema>
export type CreateEventBody = z.infer<typeof createEventSchema>
export type UpdateEventBody = z.infer<typeof updateEventSchema>
export type EventParams = z.infer<typeof eventParamSchema>
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>
export type MapEventsQuery = z.infer<typeof mapEventsQuerySchema>
export type ViewportQuery = z.infer<typeof viewportQuerySchema>
export type SearchEventsQuery = z.infer<typeof searchEventsQuerySchema>
