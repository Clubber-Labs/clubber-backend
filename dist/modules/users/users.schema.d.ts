import { z } from 'zod';
export declare const createUserSchema: z.ZodObject<{
    name: z.ZodString;
    lastname: z.ZodString;
    username: z.ZodString;
    phone: z.ZodString;
    email: z.ZodEmail;
    password: z.ZodString;
    bio: z.ZodOptional<z.ZodString>;
    birthdate: z.ZodISODate;
}, z.core.$strip>;
export type CreateUserBody = z.infer<typeof createUserSchema>;
//# sourceMappingURL=users.schema.d.ts.map