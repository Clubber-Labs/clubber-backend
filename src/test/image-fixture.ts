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

export function multipartFormData(
  buffer: Buffer,
  field: string,
  filename: string,
  mimetype: string,
) {
  const boundary = '----TestBoundary' + Math.random().toString(36).slice(2)
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${mimetype}\r\n\r\n`,
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return {
    body: Buffer.concat([head, buffer, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}
