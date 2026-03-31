"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventParamSchema = exports.updateEventSchema = exports.createEventSchema = void 0;
const zod_1 = require("zod");
exports.createEventSchema = zod_1.z.object({
    title: zod_1.z.string().min(3),
    description: zod_1.z.string().min(10),
    date: zod_1.z.string().datetime(),
    latitude: zod_1.z.number(),
    longitude: zod_1.z.number(),
    category: zod_1.z.string().min(2),
    isPublic: zod_1.z.boolean().default(true),
});
exports.updateEventSchema = zod_1.z.object({
    title: zod_1.z.string().min(3).optional(),
    description: zod_1.z.string().min(10).optional(),
    date: zod_1.z.string().datetime().optional(),
    latitude: zod_1.z.number().optional(),
    longitude: zod_1.z.number().optional(),
    category: zod_1.z.string().min(2).optional(),
    isPublic: zod_1.z.boolean().optional(),
});
exports.eventParamSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
});
//# sourceMappingURL=events.schema.js.map