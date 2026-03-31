"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEvents = getEvents;
exports.getEvent = getEvent;
exports.postEvent = postEvent;
exports.putEvent = putEvent;
exports.deleteEventHandler = deleteEventHandler;
const events_service_1 = require("./events.service");
async function getEvents(_request, reply) {
    const events = await (0, events_service_1.listPublicEvents)();
    return reply.send(events);
}
async function getEvent(request, reply) {
    const event = await (0, events_service_1.getEventById)(request.params.id);
    return reply.send(event);
}
async function postEvent(request, reply) {
    const event = await (0, events_service_1.addEvent)(request.body, request.user.sub);
    return reply.status(201).send(event);
}
async function putEvent(request, reply) {
    const event = await (0, events_service_1.editEvent)(request.params.id, request.body, request.user.sub);
    return reply.send(event);
}
async function deleteEventHandler(request, reply) {
    await (0, events_service_1.removeEvent)(request.params.id, request.user.sub);
    return reply.status(204).send();
}
//# sourceMappingURL=events.controller.js.map