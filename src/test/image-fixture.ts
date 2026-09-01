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

export type MultipartPart =
  | { name: string; value: string }
  | { name: string; filename: string; mimetype: string; buffer: Buffer }

/** Corpo multipart com as partes NA ORDEM dada — campos e arquivos misturados,
 *  como um FormData real. Para endpoints que iteram request.parts(). */
export function multipartBody(parts: MultipartPart[]) {
  const boundary = `----TestBoundary${Math.random().toString(36).slice(2)}`
  const chunks: Buffer[] = []
  for (const part of parts) {
    if ('buffer' in part) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.mimetype}\r\n\r\n`,
        ),
      )
      chunks.push(part.buffer)
      chunks.push(Buffer.from('\r\n'))
      continue
    }
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`,
      ),
    )
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

export function multipartFormData(
  buffer: Buffer,
  field: string,
  filename: string,
  mimetype: string,
  fields?: Record<string, string>,
) {
  // Campos de texto vêm ANTES do arquivo: garante que estejam em data.fields
  // assim que request.file() resolve no handler.
  return multipartBody([
    ...Object.entries(fields ?? {}).map(([name, value]) => ({ name, value })),
    { name: field, filename, mimetype, buffer },
  ])
}
