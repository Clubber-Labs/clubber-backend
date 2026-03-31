"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateLogin = validateLogin;
exports.getAuthenticatedUser = getAuthenticatedUser;
const bcryptjs_1 = require("bcryptjs");
const auth_repository_1 = require("./auth.repository");
async function validateLogin(data) {
    const user = await (0, auth_repository_1.findUserByEmail)(data.email);
    if (!user) {
        throw { statusCode: 401, message: 'Invalid credentials' };
    }
    const valid = await (0, bcryptjs_1.compare)(data.password, user.password);
    if (!valid) {
        throw { statusCode: 401, message: 'Invalid credentials' };
    }
    return user;
}
async function getAuthenticatedUser(id) {
    const user = await (0, auth_repository_1.findUserById)(id);
    if (!user) {
        throw { statusCode: 404, message: 'User not found' };
    }
    return user;
}
//# sourceMappingURL=auth.service.js.map