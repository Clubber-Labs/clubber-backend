import { prisma } from "../../lib/prisma";
import type { ReportStatus } from "@prisma/client";
import type { AdminBanBody, AdminListReportsQuery, AdminResolveReportBody } from "./admin.schema";
import { banUser, deleteEvent, findEventById, findReportById, findReports, findUserById, resolveReport, unbanUser } from "./admin.repository";

export async function banUserById(targetId: string, adminId: string, data: AdminBanBody = {})  {
    if(targetId === adminId) {
        throw {
            statusCode: 400,
            message: "Administrador não pode banir a si mesmo",
        }
    }
    const user = await findUserById(targetId)
    if(!user) {
        throw {
            statusCode: 404,
            message: "Usuário não encontrado",
        }
    }
    if(user.role === "ADMIN") {
        throw {
            statusCode: 403,
            message: "Administrador não pode banir outro administrador",
        }
    }
    if(user.isBanned) {
        throw {
            statusCode: 409,
            message: "Usuário já está banido",
        }
    }
    return banUser(targetId, new Date(), data.reason)
}

export async function unbanUserById(targetId: string) {
    const user = await findUserById(targetId)
    if(!user) {
        throw {
            statusCode: 404,
            message: "Usuário não encontrado",
        }
    }
    if(!user.isBanned) {
        throw {
            statusCode: 409,
            message: "Usuário não está banido",
        }
    }
    return unbanUser(targetId)
}

export async function removeEvent(eventId: string) {
    const event = await findEventById(eventId)
    if(!event) {
        throw {
            statusCode: 404,
            message: "Evento não encontrado",
        }
    }
    await deleteEvent(eventId)
}

export async function listReports(query: AdminListReportsQuery) {
    const reports = await findReports(query)
    const hasMore = reports.length > query.limit
    const items = hasMore ? reports.slice(0, -1) : reports
    return {
        reports: items,
        nextCursor: hasMore ? items[items.length - 1].id : null,
    }
}

export async function getReport(id: string) {
    const report = await findReportById(id)
    if(!report) {
        throw {
            statusCode: 404,
            message: "Denúncia não encontrada",
        }
    }
    return report
}

export async function reviewReport(id: string, adminId: string, data: AdminResolveReportBody) {
    const report = await findReportById(id)
    if(!report) {
        throw {
            statusCode: 404,
            message: "Denúncia não encontrada",
        }
    }
    if(report.status !== "PENDING") {
        throw {
            statusCode: 409,
            message: "Denúncia já foi resolvida",
        }
    }
    const resolved = await resolveReport(id, adminId, data) 
    if(data.status === "RESOLVED_REMOVED") {
        if(report.eventId) {
            await deleteEvent(report.eventId)
        }
    }
    return resolved
}