import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CreateUserBody } from './users.schema';
export declare function postUser(request: FastifyRequest<{
    Body: CreateUserBody;
}>, reply: FastifyReply): Promise<never>;
//# sourceMappingURL=users.controller.d.ts.map