"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerUser = registerUser;
const bcryptjs_1 = require("bcryptjs");
const users_repository_1 = require("./users.repository");
async function registerUser(data) {
    const emailExists = await (0, users_repository_1.findUserByEmail)(data.email);
    const usernameExists = await (0, users_repository_1.findUserByUsername)(data.username);
    if (emailExists) {
        throw { statusCode: 409, message: 'Email já cadastrado' };
    }
    if (usernameExists) {
        throw { statusCode: 409, message: 'Nome de usuário já cadastrado' };
    }
    const passwordHash = await (0, bcryptjs_1.hash)(data.password, 10);
    const user = await (0, users_repository_1.createUser)({
        ...data,
        password: passwordHash,
    });
    return user;
}
//# sourceMappingURL=users.service.js.map