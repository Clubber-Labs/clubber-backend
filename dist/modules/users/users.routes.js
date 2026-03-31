"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.usersRoutes = usersRoutes;
const users_controller_1 = require("./users.controller");
const users_schema_1 = require("./users.schema");
async function usersRoutes(app) {
    app.post('/users', { schema: { body: users_schema_1.createUserSchema } }, users_controller_1.postUser);
}
//# sourceMappingURL=users.routes.js.map