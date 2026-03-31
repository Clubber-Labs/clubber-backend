"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventsRoutes = eventsRoutes;
const events_controller_1 = require("./events.controller");
const events_schema_1 = require("./events.schema");
const fastify_type_provider_zod_1 = require("fastify-type-provider-zod");
async function eventsRoutes(app) {
    app.setValidatorCompiler(fastify_type_provider_zod_1.validatorCompiler);
    app.setSerializerCompiler(fastify_type_provider_zod_1.serializerCompiler);
    const api = app.withTypeProvider();
    api.get('/events', events_controller_1.getEvents);
    api.get('/events/:id', { schema: { params: events_schema_1.eventParamSchema } }, events_controller_1.getEvent);
    api.post('/events', { schema: { body: events_schema_1.createEventSchema } }, events_controller_1.postEvent);
    api.put('/events/:id', { schema: { params: events_schema_1.eventParamSchema, body: events_schema_1.updateEventSchema } }, events_controller_1.putEvent);
    api.delete('/events/:id', { schema: { params: events_schema_1.eventParamSchema } }, events_controller_1.deleteEventHandler);
}
//# sourceMappingURL=events.routes.js.map