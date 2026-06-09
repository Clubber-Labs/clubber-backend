import { v2 as cloudinary } from 'cloudinary'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '../logger'
import { CloudinaryStorageService } from './cloudinary-storage.service'

// Prova o CONTRATO de chamada ao SDK do Cloudinary — a única camada onde
// 'upload' (público) vs 'authenticated' (privado) e media_metadata importam. A
// suíte de integração roda contra o FakeStorageService (nunca toca o Cloudinary),
// então estes bugs de namespace só são verificáveis aqui, espionando o singleton
// real do SDK (o mesmo objeto que o serviço chama).
const creds = { cloudName: 'cloud', apiKey: 'key', apiSecret: 'secret' }

const resourceAsset = {
  public_id: 'conversations/abc/xyz',
  secure_url: 'https://res.cloudinary.com/cloud/video/authenticated/xyz.mp4',
  bytes: 1_234_567,
  format: 'mp4',
  asset_folder: 'conversations/abc',
  width: 1080,
  height: 1920,
}

describe('CloudinaryStorageService — contrato de namespace com o SDK', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // config/url são puro cálculo (sem rede); fixa para determinismo.
    vi.spyOn(cloudinary, 'config').mockReturnValue(undefined as never)
    vi.spyOn(cloudinary, 'url').mockReturnValue('https://signed.example/poster')
  })

  it('delete de mídia de chat mira o namespace authenticated + invalidate', async () => {
    const destroy = vi
      .spyOn(cloudinary.uploader, 'destroy')
      .mockResolvedValue({ result: 'ok' } as never)
    const svc = new CloudinaryStorageService(creds)

    await svc.delete('conversations/abc/xyz', 'video', 'authenticated')

    expect(destroy).toHaveBeenCalledWith('conversations/abc/xyz', {
      resource_type: 'video',
      type: 'authenticated',
      invalidate: true,
    })
  })

  it('delete sem deliveryType mira o namespace público (não regride avatar/evento)', async () => {
    const destroy = vi
      .spyOn(cloudinary.uploader, 'destroy')
      .mockResolvedValue({ result: 'ok' } as never)
    const svc = new CloudinaryStorageService(creds)

    await svc.delete('users/u1/avatar')

    expect(destroy).toHaveBeenCalledWith('users/u1/avatar', {
      resource_type: 'image',
      type: 'upload',
      invalidate: true,
    })
  })

  it('delete loga aviso quando o destroy retorna not found (namespace errado)', async () => {
    vi.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({
      result: 'not found',
    } as never)
    const warn = vi.spyOn(logger, 'warn').mockReturnValue(undefined as never)
    const svc = new CloudinaryStorageService(creds)

    await svc.delete('conversations/abc/xyz', 'video', 'authenticated')

    expect(warn).toHaveBeenCalledOnce()
  })

  it('getAsset busca no namespace authenticated com media_metadata', async () => {
    const resource = vi
      .spyOn(cloudinary.api, 'resource')
      .mockResolvedValue({ ...resourceAsset, duration: 4.035 } as never)
    const svc = new CloudinaryStorageService(creds)

    const asset = await svc.getAsset('conversations/abc/xyz', 'video')

    expect(resource).toHaveBeenCalledWith('conversations/abc/xyz', {
      resource_type: 'video',
      type: 'authenticated',
      media_metadata: true,
    })
    expect(asset?.durationMs).toBe(4035)
  })

  it('getAsset coage duration string ("4.035") para durationMs', async () => {
    vi.spyOn(cloudinary.api, 'resource').mockResolvedValue({
      ...resourceAsset,
      duration: '4.035',
    } as never)
    const svc = new CloudinaryStorageService(creds)

    const asset = await svc.getAsset('conversations/abc/xyz', 'video')

    expect(asset?.durationMs).toBe(4035)
  })

  it('getAsset mantém durationMs null quando o provider não reporta duration', async () => {
    vi.spyOn(cloudinary.api, 'resource').mockResolvedValue({
      ...resourceAsset,
    } as never)
    const svc = new CloudinaryStorageService(creds)

    const asset = await svc.getAsset('conversations/abc/xyz', 'video')

    expect(asset?.durationMs).toBeNull()
  })
})
