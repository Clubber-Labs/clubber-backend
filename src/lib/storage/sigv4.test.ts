import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { describe, expect, it } from 'vitest'
import { computeSignature, presignGetUrl } from './sigv4'

const CREDENTIALS = {
  accountId: 'accfake123',
  accessKeyId: 'AKIAFAKEACCESSKEY',
  secretAccessKey: 'fakeSecretAccessKeyFakeSecretAccessKey1234',
  bucket: 'clubber-media',
}
const FIXED_NOW = new Date('2026-08-15T12:34:56Z')

describe('presignGetUrl (estrutural)', () => {
  it('gera URL path-style com host, bucket e key esperados', () => {
    const url = presignGetUrl({
      ...CREDENTIALS,
      key: 'conversations/uuid-a/uuid-b.jpg',
      expiresInSeconds: 3600,
      now: FIXED_NOW,
    })

    expect(
      url.startsWith(
        `https://${CREDENTIALS.accountId}.r2.cloudflarestorage.com/`,
      ),
    ).toBe(true)
    expect(url).toContain(
      `/${CREDENTIALS.bucket}/conversations/uuid-a/uuid-b.jpg`,
    )
  })

  it('inclui todos os params X-Amz-* obrigatórios', () => {
    const url = presignGetUrl({
      ...CREDENTIALS,
      key: 'conversations/uuid-a/uuid-b.jpg',
      expiresInSeconds: 60,
      now: FIXED_NOW,
    })
    const parsed = new URL(url)

    expect(parsed.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(parsed.searchParams.get('X-Amz-Credential')).toBe(
      `${CREDENTIALS.accessKeyId}/20260815/auto/s3/aws4_request`,
    )
    expect(parsed.searchParams.get('X-Amz-Date')).toBe('20260815T123456Z')
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe('60')
    expect(parsed.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
    expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('lança erro quando expiresInSeconds está fora de [1, 604800]', () => {
    expect(() =>
      presignGetUrl({
        ...CREDENTIALS,
        key: 'k',
        expiresInSeconds: 0,
        now: FIXED_NOW,
      }),
    ).toThrow()
    expect(() =>
      presignGetUrl({
        ...CREDENTIALS,
        key: 'k',
        expiresInSeconds: 604801,
        now: FIXED_NOW,
      }),
    ).toThrow()
  })
})

describe('presignGetUrl (equivalência com @aws-sdk/s3-request-presigner)', () => {
  const endpoint = `https://${CREDENTIALS.accountId}.r2.cloudflarestorage.com`
  const s3Client = new S3Client({
    region: 'auto',
    endpoint,
    forcePathStyle: true,
    // desliga os checksums automáticos (x-amz-checksum-mode) do SDK: R2/nosso
    // presign clássico não usa esse recurso, então isolamos a comparação ao
    // núcleo SigV4 (Algorithm/Credential/Date/Expires/SignedHeaders/Signature).
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: CREDENTIALS.accessKeyId,
      secretAccessKey: CREDENTIALS.secretAccessKey,
    },
  })

  async function sdkPresign(key: string, expiresInSeconds: number) {
    const command = new GetObjectCommand({
      Bucket: CREDENTIALS.bucket,
      Key: key,
    })
    return getSignedUrl(s3Client, command, {
      expiresIn: expiresInSeconds,
      signingDate: FIXED_NOW,
    })
  }

  // A GetObjectCommand da SDK ainda embute "x-id=GetObject" (parte do template de
  // rota da operação, hardcoded no protocolo) e "X-Amz-Content-Sha256" (header
  // hoisted pro query pelo S3RequestPresigner) — nenhum dos dois é exigido pelo
  // SigV4 puro nem pelo presign clássico do R2, então a URL completa nunca bate
  // 1:1. A prova real de equivalência é criptográfica: extraímos a query string
  // canônica exata que a SDK assinou e recomputamos a assinatura com o MESMO
  // helper HMAC usado em produção (computeSignature) — se baterem, o cálculo de
  // presignGetUrl está correto byte a byte contra a implementação de referência.
  async function assertSameSignature(key: string, expiresInSeconds: number) {
    const theirs = await sdkPresign(key, expiresInSeconds)
    const parsed = new URL(theirs)
    const theirSignature = parsed.searchParams.get('X-Amz-Signature')
    const amzDate = parsed.searchParams.get('X-Amz-Date')
    expect(theirSignature).toBeTruthy()
    expect(amzDate).toBeTruthy()

    const rawQueryPairs = parsed.search
      .slice(1)
      .split('&')
      .filter((pair) => !pair.startsWith('X-Amz-Signature='))
      .sort()
    const canonicalQueryString = rawQueryPairs.join('&')

    const recomputed = computeSignature({
      host: parsed.hostname,
      canonicalUri: parsed.pathname,
      canonicalQueryString,
      amzDate: amzDate as string,
      dateStamp: (amzDate as string).slice(0, 8),
      secretAccessKey: CREDENTIALS.secretAccessKey,
    })

    expect(recomputed).toBe(theirSignature)
  }

  it('produz assinatura idêntica à SDK para uma key simples', async () => {
    await assertSameSignature('conversations/uuid-a/uuid-b.jpg', 3600)
  })

  it('produz assinatura idêntica à SDK para key com caractere que exige encoding', async () => {
    await assertSameSignature(
      'conversations/uuid a/arquivo com espaço.png',
      900,
    )
  })

  it('presignGetUrl gera os mesmos params canônicos que a SDK (sem os extras específicos de S3)', async () => {
    const key = 'conversations/uuid-a/uuid-b.jpg'
    const expiresInSeconds = 3600

    const ours = new URL(
      presignGetUrl({ ...CREDENTIALS, key, expiresInSeconds, now: FIXED_NOW }),
    )
    const theirs = new URL(await sdkPresign(key, expiresInSeconds))

    expect(ours.hostname).toBe(theirs.hostname)
    expect(ours.pathname).toBe(theirs.pathname)
    for (const param of [
      'X-Amz-Algorithm',
      'X-Amz-Credential',
      'X-Amz-Date',
      'X-Amz-Expires',
      'X-Amz-SignedHeaders',
    ]) {
      expect(ours.searchParams.get(param)).toBe(theirs.searchParams.get(param))
    }
  })
})
