import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { imageProcessorService } from './image-processor.service'

// Como a câmera de celular entrega uma foto de retrato: os pixels ficam na
// orientação do sensor (deitados) e a correção mora só na tag EXIF.
function portraitFromSensor() {
  return sharp({
    create: { width: 800, height: 400, channels: 3, background: '#334455' },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer()
}

describe('imageProcessorService', () => {
  // O WebP de saída não carrega a tag de orientação: ou ela vira pixel aqui, ou
  // a foto chega deitada em toda tela que a exibe.
  it('aplica a orientação EXIF antes de redimensionar', async () => {
    const processed = await imageProcessorService.processEventGallery(
      await portraitFromSensor(),
    )

    expect([processed.width, processed.height]).toEqual([400, 800])
  })

  it('recorta o avatar sobre a imagem já orientada', async () => {
    const processed = await imageProcessorService.processProfileAvatar(
      await portraitFromSensor(),
    )

    expect([processed.width, processed.height]).toEqual([300, 300])
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
