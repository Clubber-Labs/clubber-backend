import { z } from 'zod';
export declare const createEventSchema: z.ZodObject<{
    title: z.ZodString;
    description: z.ZodString;
    date: z.ZodString;
    latitude: z.ZodNumber;
    longitude: z.ZodNumber;
    category: z.ZodString;
    isPublic: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export declare const updateEventSchema: z.ZodObject<{
    title: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    date: z.ZodOptional<z.ZodString>;
    latitude: z.ZodOptional<z.ZodNumber>;
    longitude: z.ZodOptional<z.ZodNumber>;
    category: z.ZodOptional<z.ZodString>;
    isPublic: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const eventParamSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
export type CreateEventBody = z.infer<typeof createEventSchema>;
export type UpdateEventBody = z.infer<typeof updateEventSchema>;
export type EventParams = z.infer<typeof eventParamSchema>;
//# sourceMappingURL=events.schema.d.ts.map