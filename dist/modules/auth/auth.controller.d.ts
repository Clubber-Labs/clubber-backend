import type { FastifyReply, FastifyRequest } from 'fastify';
import type { LoginBody } from './auth.schema';
export declare function login(request: FastifyRequest<{
    Body: LoginBody;
}>, reply: FastifyReply): Promise<never>;
export declare function me(request: FastifyRequest, reply: FastifyReply): Promise<never>;
//# sourceMappingURL=auth.controller.d.ts.map