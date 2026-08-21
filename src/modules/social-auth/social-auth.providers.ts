import { OAuth2Client, type TokenPayload } from 'google-auth-library'
import {
  createRemoteJWKSet,
  type JWTPayload,
  errors as joseErrors,
  jwtVerify,
} from 'jose'
import { env } from '../../lib/env'
import { AppError } from '../../lib/errors/app-error'
import type {
  SocialLoginBody,
  VerifiedSocialProfile,
} from './social-auth.schema'

const googleClient = new OAuth2Client()

export async function verifyGoogleToken(
  idToken: string,
): Promise<VerifiedSocialProfile> {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new AppError(500, 'SOCIAL_PROVIDER_MISCONFIGURED')
  }

  let payload: TokenPayload | undefined
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_ID,
    })
    payload = ticket.getPayload()
  } catch {
    throw new AppError(401, 'INVALID_PROVIDER_TOKEN')
  }

  if (!payload?.sub) {
    throw new AppError(401, 'INVALID_PROVIDER_TOKEN')
  }

  return {
    provider: 'GOOGLE',
    providerUserId: payload.sub,
    email: payload.email ?? null,
    emailVerified: payload.email_verified === true,
    firstName: payload.given_name ?? null,
    lastName: payload.family_name ?? null,
    pictureUrl: payload.picture ?? null,
  }
}

// Escopo de módulo: o jose cacheia as chaves entre requests e só refaz o
// fetch quando aparece um kid desconhecido (rotação de chave da Apple).
const appleJwks = createRemoteJWKSet(
  new URL('https://appleid.apple.com/auth/keys'),
)

export async function verifyAppleToken(
  identityToken: string,
  fullName?: SocialLoginBody['fullName'],
): Promise<VerifiedSocialProfile> {
  let payload: JWTPayload
  try {
    ;({ payload } = await jwtVerify(identityToken, appleJwks, {
      issuer: 'https://appleid.apple.com',
      audience: env.APPLE_BUNDLE_ID,
    }))
  } catch (err) {
    // Erro fora do jose (fetch do JWKS falhou) ou timeout = indisponibilidade
    // da Apple, não token ruim.
    if (
      !(err instanceof joseErrors.JOSEError) ||
      err instanceof joseErrors.JWKSTimeout
    ) {
      throw new AppError(502, 'SOCIAL_PROVIDER_UNAVAILABLE', undefined, {
        provider: 'Apple',
      })
    }
    throw new AppError(401, 'INVALID_PROVIDER_TOKEN')
  }

  if (!payload.sub) {
    throw new AppError(401, 'INVALID_PROVIDER_TOKEN')
  }

  // email_verified chega como boolean ou string 'true' dependendo do fluxo.
  // Email de private relay (@privaterelay.appleid.com) é tratado como normal.
  return {
    provider: 'APPLE',
    providerUserId: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    emailVerified:
      payload.email_verified === true || payload.email_verified === 'true',
    firstName: fullName?.givenName ?? null,
    lastName: fullName?.familyName ?? null,
    pictureUrl: null,
  }
}
