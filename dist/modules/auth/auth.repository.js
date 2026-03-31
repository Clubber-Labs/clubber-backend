"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findUserByEmail = findUserByEmail;
exports.findUserById = findUserById;
const prisma_1 = require("../../lib/prisma");
async function findUserByEmail(email) {
    return prisma_1.prisma.user.findUnique({
        where: { email },
    });
}
async function findUserById(id) {
    return prisma_1.prisma.user.findUnique({
        where: { id },
        select: { id: true, name: true, email: true, bio: true, createdAt: true },
    });
}
//# sourceMappingURL=auth.repository.js.map