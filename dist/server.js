"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = require("@fastify/cors");
const jwt_1 = __importDefault(require("@fastify/jwt"));
const swagger_1 = require("@fastify/swagger");
const fastify_api_reference_1 = __importDefault(require("@scalar/fastify-api-reference"));
const fastify_1 = require("fastify");
const fastify_type_provider_zod_1 = require("fastify-type-provider-zod");
const auth_routes_1 = require("./modules/auth/auth.routes");
const events_routes_1 = require("./modules/events/events.routes");
const app = (0, fastify_1.fastify)().withTypeProvider();
app.setValidatorCompiler(fastify_type_provider_zod_1.validatorCompiler);
app.setSerializerCompiler(fastify_type_provider_zod_1.serializerCompiler);
app.register(cors_1.fastifyCors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
});
app.register(jwt_1.default, {
    secret: process.env.JWT_SECRET ?? 'fallback_secret',
});
app.decorate('authenticate', async (request, reply) => {
    try {
        await request.jwtVerify();
    }
    catch {
        reply.status(401).send({ message: 'Unauthorized' });
    }
});
app.register(swagger_1.fastifySwagger, {
    openapi: {
        info: {
            title: 'ConnectAI API',
            description: 'API documentation for ConnectAI backend',
            version: '1.0.0',
        },
    },
    transform: fastify_type_provider_zod_1.jsonSchemaTransform,
});
app.register(fastify_api_reference_1.default, {
    routePrefix: '/docs',
});
app.register(auth_routes_1.authRoutes);
app.register(events_routes_1.eventsRoutes);
app.listen({ port: 3333, host: '0.0.0.0' }).then(() => {
    console.log('Server is running on http://localhost:3333');
});
//# sourceMappingURL=server.js.map