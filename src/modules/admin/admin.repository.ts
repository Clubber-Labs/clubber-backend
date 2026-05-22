import { prisma } from "../../lib/prisma";
import type { AdminResolveReportBody } from "./admin.schema";

export async function findUserById(id: string) {
    return prisma.user.findUnique({ where: { id } })
}

export async function banUser(id: string, bannedAt: Date, reason?: string) {
    return prisma.user.update({
        where: { id },
        data: { isBanned: true, bannedAt, banReason: reason ?? null},
    })
}

export async function unbanUser(id: string) {
    return prisma.user.update({
        where: { id },
        data: { isBanned: false, bannedAt: null },
    })
}

export async function findEventById(id: string) {
    return prisma.event.findUnique({ where: { id } })
}

export async function deleteEvent(id: string) {
    return prisma.event.delete({ where: { id } })
}

export async function findReports(params: { 
    status?: string
    limit: number
    cursor?: string
}) {
    return prisma.report.findMany({
        where: params.status ? { status: params.status as never } : undefined,
        take: params.limit + 1,
        cursor: params.cursor ? { id: params.cursor } : undefined,
        skip: params.cursor ? 1 : 0,
        orderBy: { createdAt: 'desc' },
        include: {
            reporter: { select: { id: true, username: true, name: true } },
            event: { select: { id: true, title: true, authorId: true } },
            comment: { select: { id: true, content: true, authorId: true } },
        },
    })
}

export async function findReportById(id: string) {
    return prisma.report.findUnique({
        where: { id },
        include: { 
            reporter: { select: { id: true, username: true, name: true } },
            event: { select: { id: true, title: true, authorId: true } },
            comment: { select: { id: true, content: true, authorId: true } },
            resolvedByAdmin: { select: { id: true, username: true } },
        },
    })
}

export async function resolveReport(
    id: string,
    adminId: string,
    data: AdminResolveReportBody,
) {
    return prisma.report.update({
        where: { id },
        data: {
            status: data.status,
            resolvedReason: data.resolvedReason,
            resolvedByAdminId: adminId,
            resolvedAt: new Date(),
        },
    })
}