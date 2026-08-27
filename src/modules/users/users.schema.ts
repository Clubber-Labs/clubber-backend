import { z } from 'zod'
import { selectableCategorySchema } from '../../lib/event-categories'
import { SUPPORTED_LOCALES } from '../../lib/i18n/locale'
import { timezoneSchema } from '../../lib/i18n/timezone'
import { interestSchema } from '../../lib/subcategories'

// Fonte única das regras de formato do username: cadastro e checagem de
// disponibilidade precisam aceitar exatamente o mesmo conjunto de valores.
// Minúsculo é a forma canônica da identidade (o índice único é sobre lower()):
// normalizar aqui, e não no cliente, garante o formato venha de onde vier —
// app antigo, web ou login social. Charset no padrão Instagram: letras,
// números, ponto e underscore — ponto não inicia, não termina e não repete.
export const usernameFieldSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(4, 'Seu nome de usuario deve ter no minimo 4 caracteres')
  .max(25, 'Seu nome de usuario deve ter no maximo 25 caracteres')
  .regex(
    /^[a-z0-9._]+$/,
    'Seu nome de usuario deve conter apenas letras, numeros, pontos e underscores, sem espacos',
  )
  .regex(
    /^(?!\.)(?!.*\.\.)(?!.*\.$)/,
    'Pontos nao podem iniciar, terminar ou se repetir no nome de usuario',
  )

export const createUserSchema = z.object({
  name: z
    .string()
    .min(4, 'Seu nome deve ter no minimo 4 caracteres')
    .max(25, 'Seu nome deve ter no maximo 25 caracteres')
    .regex(/^[a-zA-ZÀ-ÿ\s]+$/, 'Seu nome deve conter apenas letras'),
  lastname: z
    .string()
    .min(4, 'Seu sobrenome deve ter no minimo 4 caracteres')
    .max(55, 'Seu sobrenome deve ter no maximo 55 caracteres')
    .regex(/^[a-zA-ZÀ-ÿ\s]+$/, 'Seu sobrenome deve conter apenas letras'),
  username: usernameFieldSchema,
  phone: z
    .string()
    .min(10, 'Seu telefone deve conter no minimo 10 caracteres')
    .max(11, 'Seu telefone deve conter no maximo 11 caracteres')
    .regex(/^\d+$/, 'Telefone deve conter apenas números'),
  email: z.email().toLowerCase(),
  password: z.string().min(8, 'Sua senha deve conter no minimo 8 caracteres'),
  bio: z
    .string()
    .max(255, 'Sua bio deve conter no maximo 255 caracteres')
    .optional(),
  isPrivate: z.boolean().default(false),
  birthdate: z.coerce.date(),
  // Perfil mínimo de rolê: ao menos 2 categorias DISTINTAS, obrigatórias — todo
  // perfil nasce com sinal pra recomendação (sem perfil vazio). O dedup roda
  // ANTES da contagem, então categorias repetidas não burlam o mínimo. No update
  // (updateUserSchema é .partial()) o campo é opcional, mas se enviado a regra
  // continua valendo: não dá pra reduzir abaixo de 2 nem limpar para [].
  preferredCategories: z
    .array(selectableCategorySchema)
    .max(10)
    .transform((list) => Array.from(new Set(list)))
    .refine((list) => list.length >= 2, {
      message: 'Escolha ao menos 2 categorias de rolê',
    }),
  // Interesses do 2º nível (subcategorias de venue + gêneros) — refinam o perfil.
  // Uma subcategoria implica seu pai no matching; não exige a categoria também.
  preferredSubcategories: z.array(interestSchema).max(30).optional(),
  // IANA do aparelho — o cadastro é o primeiro ponto onde o app conhece o
  // device; persiste junto da criação (o deviceLocale vem do Accept-Language).
  timezone: timezoneSchema.optional(),
})

export type CreateUserBody = z.infer<typeof createUserSchema>

// Preferências de produto: não entram no cadastro (nascem `true` por contrato /
// legítimo interesse), só no opt-out. Não confundir com os consentimentos do
// PATCH /consent, que exigem opt-in explícito.
export const userPreferencesSchema = z.object({
  socialFeed: z.boolean(),
  socialVisibility: z.boolean(),
  analytics: z.boolean(),
  // Mostrar os top artistas do Spotify no perfil. Nasce `true` no vínculo (a
  // tela avisa) e o toggle em Configurações desliga.
  spotifyArtistsVisible: z.boolean(),
})

export const updateUserSchema = createUserSchema
  .omit({ password: true, email: true })
  .extend(userPreferencesSchema.shape)
  .extend({
    // Idioma explícito da UI (null = seguir o aparelho). Guardado, não só
    // negociado por request: push/e-mail rodam em job, sem Accept-Language.
    localePreference: z.enum(SUPPORTED_LOCALES).nullable(),
  })
  .partial()

export type UpdateUserBody = z.infer<typeof updateUserSchema>

export const userIdParamSchema = z.object({
  id: z.string().uuid('ID inválido'),
})

export type UserIdParam = z.infer<typeof userIdParamSchema>

// Exclusão de conta (soft-delete): reconfirmação de senha opcional — exigida no
// service apenas quando a conta tem senha (contas social-only dispensam) — e
// motivo de saída opcional (analytics de churn), só neste fluxo de exclusão.
export const deleteAccountBodySchema = z
  .object({
    password: z.string().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .optional()

export type DeleteAccountBody = z.infer<typeof deleteAccountBodySchema>

export const listUsersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
})

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>

export const searchUsersQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(2, 'Busca deve ter ao menos 2 caracteres')
    .max(100, 'Busca deve ter no máximo 100 caracteres'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
})

export type SearchUsersQuery = z.infer<typeof searchUsersQuerySchema>

export const usernameAvailabilityQuerySchema = z.object({
  username: usernameFieldSchema,
})

export type UsernameAvailabilityQuery = z.infer<
  typeof usernameAvailabilityQuerySchema
>
