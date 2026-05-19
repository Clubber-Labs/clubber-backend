import type { SocialProvider } from '@prisma/client'
import { prisma } from '../../lib/prisma'

export async function findSocialAccount(
  provider: SocialProvider,
  providerUserId: string,
) {
  return prisma.socialAccount.findUnique({
    where: { provider_providerUserId: { provider, providerUserId } },
  })
}

export async function createSocialAccount(data: {
  userId: string
  provider: SocialProvider
  providerUserId: string
  email: string | null
}) {
  return prisma.socialAccount.create({ data })
}

export type CreateSocialUserInput = {
  user: {
    name: string
    lastname: string
    username: string
    email: string
    avatarUrl: string | null
  }
  social: {
    provider: SocialProvider
    providerUserId: string
    email: string | null
  }
}

export async function createUserWithSocialAccount(
  input: CreateSocialUserInput,
) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        ...input.user,
        password: null,
        phone: null,
        birthdate: null,
      },
    })
    await tx.socialAccount.create({
      data: { userId: user.id, ...input.social },
    })
    return user
  })
}
