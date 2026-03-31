"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.login = login;
exports.me = me;
const auth_service_1 = require("./auth.service");
async function login(request, reply) {
    const user = await (0, auth_service_1.validateLogin)(request.body);
    const token = await reply.jwtSign({ sub: user.id });
    return reply.send({ token });
}
async function me(request, reply) {
    const user = await (0, auth_service_1.getAuthenticatedUser)(request.user.sub);
    return reply.send(user);
}
//# sourceMappingURL=auth.controller.js.map