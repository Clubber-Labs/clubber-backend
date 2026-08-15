import { createHash, createHmac } from 'node:crypto'

interface PresignParams {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  key: string
  expiresInSeconds: number
  now?: Date
}

interface PresignPutParams extends PresignParams {
  contentType: string
}

const REGION = 'auto'
const SERVICE = 's3'
const ALGORITHM = 'AWS4-HMAC-SHA256'
const MIN_EXPIRES_SECONDS = 1
const MAX_EXPIRES_SECONDS = 604800

// SigV4 exige encoding RFC 3986 estrito: encodeURIComponent deixa !'()* sem escapar.
function uriEncode(input: string, encodeSlash: boolean): string {
  return Array.from(Buffer.from(input, 'utf8'))
    .map((byte) => {
      const char = String.fromCharCode(byte)
      if (/[A-Za-z0-9\-._~]/.test(char)) return char
      if (char === '/') return encodeSlash ? '%2F' : '/'
      return `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
    })
    .join('')
}

function encodePath(bucket: string, key: string): string {
  const segments = `${bucket}/${key}`.split('/')
  return `/${segments.map((segment) => uriEncode(segment, false)).join('/')}`
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

function toAmzDate(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { amzDate: iso, dateStamp: iso.slice(0, 8) }
}

interface CanonicalRequestParams {
  method?: string
  host: string
  canonicalUri: string
  canonicalQueryString: string
  canonicalHeaders?: string
  signedHeaders?: string
  amzDate: string
  dateStamp: string
  secretAccessKey: string
}

// Isolado do presign "clássico" pra ser reaproveitado no teste de equivalência
// com a AWS SDK, cuja URL carrega query params extras (x-id, content-sha256)
// que o presign de R2 não usa — mas o cálculo HMAC por trás é o mesmo.
function computeSignature(params: CanonicalRequestParams): string {
  const {
    method = 'GET',
    host,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders = `host:${host}\n`,
    signedHeaders = 'host',
    amzDate,
    dateStamp,
    secretAccessKey,
  } = params
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp)
  const kRegion = hmac(kDate, REGION)
  const kService = hmac(kRegion, SERVICE)
  const kSigning = hmac(kService, 'aws4_request')
  return hmac(kSigning, stringToSign).toString('hex')
}

function presignGetUrl(params: PresignParams): string {
  const {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    key,
    expiresInSeconds,
  } = params

  if (
    expiresInSeconds < MIN_EXPIRES_SECONDS ||
    expiresInSeconds > MAX_EXPIRES_SECONDS
  ) {
    throw new Error(
      `expiresInSeconds deve estar entre ${MIN_EXPIRES_SECONDS} e ${MAX_EXPIRES_SECONDS}`,
    )
  }

  const now = params.now ?? new Date()
  const { amzDate, dateStamp } = toAmzDate(now)
  const host = `${accountId}.r2.cloudflarestorage.com`
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`

  const queryParams: Array<[string, string]> = [
    ['X-Amz-Algorithm', ALGORITHM],
    ['X-Amz-Credential', `${accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresInSeconds)],
    ['X-Amz-SignedHeaders', 'host'],
  ]
  // Ordem canônica byte a byte dos params — exigência do SigV4.
  queryParams.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  const canonicalQueryString = queryParams
    .map(([k, v]) => `${uriEncode(k, true)}=${uriEncode(v, true)}`)
    .join('&')

  const canonicalUri = encodePath(bucket, key)
  const signature = computeSignature({
    host,
    canonicalUri,
    canonicalQueryString,
    amzDate,
    dateStamp,
    secretAccessKey,
  })

  return `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`
}

function presignPutUrl(params: PresignPutParams): string {
  const {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    key,
    expiresInSeconds,
    contentType,
  } = params

  if (
    expiresInSeconds < MIN_EXPIRES_SECONDS ||
    expiresInSeconds > MAX_EXPIRES_SECONDS
  ) {
    throw new Error(
      `expiresInSeconds deve estar entre ${MIN_EXPIRES_SECONDS} e ${MAX_EXPIRES_SECONDS}`,
    )
  }

  const now = params.now ?? new Date()
  const { amzDate, dateStamp } = toAmzDate(now)
  const host = `${accountId}.r2.cloudflarestorage.com`
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`
  const signedHeaders = 'content-type;host'

  const queryParams: Array<[string, string]> = [
    ['X-Amz-Algorithm', ALGORITHM],
    ['X-Amz-Credential', `${accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresInSeconds)],
    ['X-Amz-SignedHeaders', signedHeaders],
  ]
  queryParams.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  const canonicalQueryString = queryParams
    .map(([k, v]) => `${uriEncode(k, true)}=${uriEncode(v, true)}`)
    .join('&')

  const canonicalUri = encodePath(bucket, key)
  // assinar o Content-Type força o cliente a enviar exatamente esse header no PUT (R2 rejeita se divergir)
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`
  const signature = computeSignature({
    method: 'PUT',
    host,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    amzDate,
    dateStamp,
    secretAccessKey,
  })

  return `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`
}

export type { PresignParams, PresignPutParams }
export { computeSignature, presignGetUrl, presignPutUrl }
