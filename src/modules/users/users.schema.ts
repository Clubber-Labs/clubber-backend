import { z } from 'zod'

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
  username: z
    .string()
    .min(4, 'Seu nome de usuario deve ter no minimo 4 caracteres')
    .max(25, 'Seu nome de usuario deve ter no maximo 25 caracteres'),
  phone: z
    .string()
    .min(10, 'Seu telefone deve conter no minimo 10 caracteres')
    .max(11, 'Seu telefone deve conter no maximo 11 caracteres')
    .regex(/^\d+$/, 'Telefone deve conter apenas números'),
  email: z.email(),
  password: z.string().min(8, 'Sua senha deve conter no minimo 8 caracteres'),
  bio: z
    .string()
    .max(255, 'Sua bio deve conter no maximo 255 caracteres')
    .optional(),
  isPrivate: z.boolean().default(false),
  birthdate: z.coerce.date(),
  isBanned: z.boolean().default(false),
})

export type CreateUserBody = z.infer<typeof createUserSchema>

export const updateUserSchema = createUserSchema
  .omit({ password: true, email: true })
  .partial()

export type UpdateUserBody = z.infer<typeof updateUserSchema>

export const userIdParamSchema = z.object({
  id: z.string().uuid('ID inválido'),
})

export type UserIdParam = z.infer<typeof userIdParamSchema>

export const listUsersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
})

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>
