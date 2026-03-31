"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loginBodySchema = exports.registerBodySchema = void 0;
const zod_1 = require("zod");
exports.registerBodySchema = zod_1.z.object({
    name: zod_1.z.string().min(2),
    email: zod_1.z.email(),
    password: zod_1.z.string().min(6),
});
exports.loginBodySchema = zod_1.z.object({
    email: zod_1.z.email(),
    password: zod_1.z.string().min(6),
});
//# sourceMappingURL=auth.schema.js.map