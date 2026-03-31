import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CreateEventBody, EventParams, UpdateEventBody } from './events.schema';
export declare function getEvents(_request: FastifyRequest, reply: FastifyReply): Promise<never>;
export declare function getEvent(request: FastifyRequest<{
    Params: EventParams;
}>, reply: FastifyReply): Promise<never>;
export declare function postEvent(request: FastifyRequest<{
    Body: CreateEventBody;
}>, reply: FastifyReply): Promise<never>;
export declare function putEvent(request: FastifyRequest<{
    Params: EventParams;
    Body: UpdateEventBody;
}>, reply: FastifyReply): Promise<never>;
export declare function deleteEventHandler(request: FastifyRequest<{
    Params: EventParams;
}>, reply: FastifyReply): Promise<never>;
//# sourceMappingURL=events.controller.d.ts.map