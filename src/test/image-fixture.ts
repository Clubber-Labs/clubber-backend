import sharp from 'sharp'

let cached: Buffer | null = null

/** PNG 32×32 vermelho — válido para o sharp processar. */
export async function tinyPngBuffer(): Promise<Buffer> {
  if (cached) return cached
  cached = await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer()
  return cached
}

/** Buffer simulando um áudio — o storage de teste só mede o tamanho, então
 *  não precisa ser um m4a válido (a allowlist valida o mimetype, não os bytes). */
export function tinyM4aBuffer(): Buffer {
  return Buffer.from('fake-m4a-audio-bytes-for-testing')
}

export function multipartFormData(
  buffer: Buffer,
  field: string,
  filename: string,
  mimetype: string,
  fields?: Record<string, string>,
) {
  const boundary = `----TestBoundary${Math.random().toString(36).slice(2)}`
  const parts: Buffer[] = []
  // Campos de texto vêm ANTES do arquivo: garante que estejam em data.fields
  // assim que request.file() resolve no handler.
  for (const [name, value] of Object.entries(fields ?? {})) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    )
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${mimetype}\r\n\r\n`,
    ),
  )
  parts.push(buffer)
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}
