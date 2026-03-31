"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUserSchema = void 0;
const zod_1 = require("zod");
exports.createUserSchema = zod_1.z.object({
    name: zod_1.z
        .string()
        .min(4, 'Seu nome deve ter no minimo 4 caracteres')
        .max(25, 'Seu nome deve ter no maximo 25 caracteres')
        .regex(/^[a-zA-ZÀ-ÿ\s]+$/, 'Seu nome deve conter apenas letras'),
    lastname: zod_1.z
        .string()
        .min(4, 'Seu sobrenome deve ter no minimo 4 caracteres')
        .max(55, 'Seu sobrenome deve ter no maximo 55 caracteres')
        .regex(/^[a-zA-ZÀ-ÿ\s]+$/, 'Seu sobrenome deve conter apenas letras'),
    username: zod_1.z
        .string()
        .min(4, 'Seu nome de usuario deve ter no minimo 4 caracteres')
        .max(25, 'Seu nome de usuario deve ter no maximo 25 caracteres'),
    phone: zod_1.z
        .string()
        .min(10, 'Seu telefone deve conter no minimo 10 caracteres')
        .max(11, 'Seu telefone deve conter no maximo 11 caracteres')
        .regex(/^\d+$/, 'Telefone deve conter apenas números'),
    email: zod_1.z.email(),
    password: zod_1.z.string().min(8, 'Sua senha deve conter no minimo 8 caracteres'),
    bio: zod_1.z
        .string()
        .max(255, 'Sua bio deve conter no maximo 255 caracteres')
        .optional(),
    birthdate: zod_1.z.iso.date(),
});
//# sourceMappingURL=users.schema.js.map