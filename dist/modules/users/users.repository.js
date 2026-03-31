"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findUserByEmail = findUserByEmail;
exports.findUserByUsername = findUserByUsername;
exports.createUser = createUser;
const prisma_1 = require("../../lib/prisma");
async function findUserByEmail(email) {
    return prisma_1.prisma.user.findUnique({
        where: {
            email,
        },
    });
}
async function findUserByUsername(username) {
    return prisma_1.prisma.user.findUnique({
        where: {
            username,
        },
    });
}
async function createUser(data) {
    return prisma_1.prisma.user.create({ data });
}
//# sourceMappingURL=users.repository.js.map