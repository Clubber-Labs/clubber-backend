import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { imageProcessorService } from './image-processor.service'

// Retrato como a câmera entrega: pixels deitados no sensor (metade esquerda
// vermelha) e a correção só na tag EXIF, que ao exibir joga essa metade pro topo.
function portraitFromSensor() {
  return sharp({
    create: { width: 800, height: 400, channels: 3, background: '#ff0000' },
  })
    .composite([
      {
        input: {
          create: {
            width: 400,
            height: 400,
            channels: 3,
            background: '#0000ff',
          },
        },
        left: 400,
        top: 0,
      },
    ])
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer()
}

async function pixelAt(image: Buffer, x: number, y: number) {
  const { data, info } = await sharp(image)
    .raw()
    .toBuffer({ resolveWithObject: true })
  const offset = (y * info.width + x) * info.channels
  return { r: data[offset], b: data[offset + 2] }
}

describe('imageProcessorService', () => {
  it('aplica a orientação EXIF antes de redimensionar', async () => {
    const processed = await imageProcessorService.processEventGallery(
      await portraitFromSensor(),
    )

    expect([processed.width, processed.height]).toEqual([400, 800])
  })

  // O recorte 1:1 do avatar é sempre 300x300: só o conteúdo denuncia se ele saiu
  // do lado certo da foto.
  it('recorta o avatar sobre a imagem já orientada', async () => {
    const processed = await imageProcessorService.processProfileAvatar(
      await portraitFromSensor(),
    )
    const top = await pixelAt(processed.buffer, 80, 20)
    const bottom = await pixelAt(processed.buffer, 80, 280)

    expect([processed.width, processed.height]).toEqual([300, 300])
    // Orientada, a divisão de cor é horizontal. Sem orientar ela seria vertical,
    // e os dois pontos — mesma coluna — teriam a mesma cor.
    expect(top.r).toBeGreaterThan(top.b)
    expect(bottom.b).toBeGreaterThan(bottom.r)
  })

  it('não mexe em imagem sem orientação declarada', async () => {
    const landscape = await sharp({
      create: { width: 1200, height: 600, channels: 3, background: '#334455' },
    })
      .jpeg()
      .toBuffer()

    const processed = await imageProcessorService.processEventGallery(landscape)

    expect([processed.width, processed.height]).toEqual([1200, 600])
  })

  it('recusa arquivo que não é imagem', async () => {
    await expect(
      imageProcessorService.processEventGallery(Buffer.from('nao sou imagem')),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_IMAGE' })
  })
})
