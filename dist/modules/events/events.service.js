"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listPublicEvents = listPublicEvents;
exports.getEventById = getEventById;
exports.addEvent = addEvent;
exports.editEvent = editEvent;
exports.removeEvent = removeEvent;
const events_repository_1 = require("./events.repository");
async function listPublicEvents() {
    return (0, events_repository_1.findAllPublicEvents)();
}
async function getEventById(id) {
    const event = await (0, events_repository_1.findEventById)(id);
    if (!event) {
        throw { statusCode: 404, message: 'Event not found' };
    }
    return event;
}
async function addEvent(data, authorId) {
    return (0, events_repository_1.createEvent)({ ...data, authorId });
}
async function editEvent(id, data, requesterId) {
    const event = await (0, events_repository_1.findEventById)(id);
    if (!event) {
        throw { statusCode: 404, message: 'Event not found' };
    }
    if (event.authorId !== requesterId) {
        throw { statusCode: 403, message: 'Forbidden' };
    }
    return (0, events_repository_1.updateEvent)(id, data);
}
async function removeEvent(id, requesterId) {
    const event = await (0, events_repository_1.findEventById)(id);
    if (!event) {
        throw { statusCode: 404, message: 'Event not found' };
    }
    if (event.authorId !== requesterId) {
        throw { statusCode: 403, message: 'Forbidden' };
    }
    return (0, events_repository_1.deleteEvent)(id);
}
//# sourceMappingURL=events.service.js.map