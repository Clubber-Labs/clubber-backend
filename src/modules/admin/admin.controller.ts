import type { FastifyReply, FastifyRequest } from "fastify";
import type { AdminBanBody, AdminListReportsQuery, AdminResolveReportBody } from "./admin.schema";
import { 
    banUserById,
    getReport,
    listReports,
    removeEvent,
    reviewReport,
    unbanUserById,
} from "./admin.service";

export async function patchBanUser(request: FastifyRequest<{Params: {id: string}, Body: AdminBanBody}>, reply: FastifyReply) {
    await banUserById(request.params.id, request.user.sub, request.body)
    return reply.status(204).send()
}

export async function patchUnbanUser(request: FastifyRequest<{Params: {id: string}}>, reply: FastifyReply) {
    await unbanUserById(request.params.id)
    return reply.status(204).send()
}

export async function deleteEventHandler(request: FastifyRequest<{Params: {id: string}}>, reply: FastifyReply) {
    await removeEvent(request.params.id)
    return reply.status(204).send()
}

export async function getReports(request: FastifyRequest<{Querystring: AdminListReportsQuery}>, reply: FastifyReply) {
    const report = await listReports(request.query)
    return reply.send(report)
}

export async function getReportById(request: FastifyRequest<{Params: {id: string}}>, reply: FastifyReply) {
    const report = await getReport(request.params.id)
    return reply.send(report)
}

export async function patchReport(request: FastifyRequest<{Params: {id: string}, Body: AdminResolveReportBody}>, reply: FastifyReply) {
    const report = await reviewReport(request.params.id, request.user.sub, request.body)
    return reply.send(report)
}