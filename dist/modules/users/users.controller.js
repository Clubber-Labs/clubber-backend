"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.postUser = postUser;
const users_service_1 = require("./users.service");
async function postUser(request, reply) {
    const user = await (0, users_service_1.registerUser)(request.body);
    return reply.status(201).send(user);
}
//# sourceMappingURL=users.controller.js.map