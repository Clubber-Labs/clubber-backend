"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findAllPublicEvents = findAllPublicEvents;
exports.findEventById = findEventById;
exports.createEvent = createEvent;
exports.updateEvent = updateEvent;
exports.deleteEvent = deleteEvent;
const prisma_1 = require("../../lib/prisma");
async function findAllPublicEvents() {
    return prisma_1.prisma.event.findMany({
        where: { isPublic: true },
        include: { author: { select: { id: true, name: true, lastname: true } } },
        orderBy: { date: 'asc' },
    });
}
async function findEventById(id) {
    return prisma_1.prisma.event.findUnique({
        where: { id },
        include: { author: { select: { id: true, name: true, lastname: true } } },
    });
}
async function createEvent(data) {
    return prisma_1.prisma.event.create({ data });
}
async function updateEvent(id, data) {
    return prisma_1.prisma.event.update({ where: { id }, data });
}
async function deleteEvent(id) {
    return prisma_1.prisma.event.delete({ where: { id } });
}
//# sourceMappingURL=events.repository.js.map