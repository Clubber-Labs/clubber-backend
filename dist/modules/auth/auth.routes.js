"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRoutes = authRoutes;
const auth_controller_1 = require("./auth.controller");
const auth_schema_1 = require("./auth.schema");
async function authRoutes(app) {
    app.post('/auth/login', { schema: { body: auth_schema_1.loginBodySchema } }, auth_controller_1.login);
    app.get('/auth/me', { onRequest: [app.authenticate] }, auth_controller_1.me);
}
//# sourceMappingURL=auth.routes.js.map