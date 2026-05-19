import { OAuth2Client, type TokenPayload } from 'google-auth-library'
import { env } from '../../lib/env'
import type { VerifiedSocialProfile } from './social-auth.schema'

const googleClient = new OAuth2Client()

export async function verifyGoogleToken(
  idToken: string,
): Promise<VerifiedSocialProfile> {
  if (!env.GOOGLE_CLIENT_ID) {
    throw { statusCode: 500, message: 'GOOGLE_CLIENT_ID não configurado' }
  }

  let payload: TokenPayload | undefined
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_ID,
    })
    payload = ticket.getPayload()
  } catch {
    throw { statusCode: 401, message: 'Token Google inválido' }
  }

  if (!payload?.sub) {
    throw { statusCode: 401, message: 'Token Google inválido' }
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

type FacebookDebugTokenResponse = {
  data?: {
    is_valid?: boolean
    app_id?: string
    user_id?: string
  }
}

type FacebookMeResponse = {
  id?: string
  email?: string
  first_name?: string
  last_name?: string
  picture?: { data?: { url?: string } }
}

async function fetchJson<T>(
  url: string,
  init: RequestInit,
  providerLabel: string,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    throw {
      statusCode: 502,
      message: `Falha ao validar com o ${providerLabel}`,
    }
  }
  if (!response.ok) {
    throw { statusCode: 401, message: `Token ${providerLabel} inválido` }
  }
  return (await response.json()) as T
}

export async function verifyFacebookToken(
  accessToken: string,
): Promise<VerifiedSocialProfile> {
  if (!env.FACEBOOK_APP_ID || !env.FACEBOOK_APP_SECRET) {
    throw {
      statusCode: 500,
      message: 'FACEBOOK_APP_ID/FACEBOOK_APP_SECRET não configurado',
    }
  }

  const appToken = `${env.FACEBOOK_APP_ID}|${env.FACEBOOK_APP_SECRET}`

  // Tokens são enviados via body (POST) e header (Bearer) ao invés de query string
  // pra evitar vazamento em logs de proxy, access logs e error reporters.
  const debug = await fetchJson<FacebookDebugTokenResponse>(
    'https://graph.facebook.com/debug_token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        input_token: accessToken,
        access_token: appToken,
      }).toString(),
    },
    'Facebook',
  )
  if (
    !debug.data?.is_valid ||
    debug.data.app_id !== env.FACEBOOK_APP_ID ||
    !debug.data.user_id
  ) {
    throw { statusCode: 401, message: 'Token Facebook inválido' }
  }

  const me = await fetchJson<FacebookMeResponse>(
    'https://graph.facebook.com/me?fields=id,email,first_name,last_name,picture',
    { headers: { Authorization: `Bearer ${accessToken}` } },
    'Facebook',
  )

  // O Facebook não expõe email_verified separadamente — o email retornado
  // já é o confirmado na conta. Tratamos a presença do email como verificação.
  const email = me.email ?? null

  return {
    provider: 'FACEBOOK',
    providerUserId: debug.data.user_id,
    email,
    emailVerified: email != null,
    firstName: me.first_name ?? null,
    lastName: me.last_name ?? null,
    pictureUrl: me.picture?.data?.url ?? null,
  }
}
