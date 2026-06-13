import { prisma } from '../../lib/prisma'

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
  })
}

const mfaSelect = {
  id: true,
  email: true,
  role: true,
  mfaEnabled: true,
  mfaSecret: true,
  mfaRecoveryCodes: true,
} as const

export async function findUserMfaById(id: string) {
  return prisma.user.findUnique({ where: { id }, select: mfaSelect })
}

export async function updateUserMfa(
  id: string,
  data: {
    mfaEnabled?: boolean
    mfaSecret?: string | null
    mfaRecoveryCodes?: string[]
  },
) {
  return prisma.user.update({
    where: { id },
    data,
    select: { id: true, mfaEnabled: true },
  })
}
