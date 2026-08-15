import { describe, expect, it } from 'vitest'
import { sniffResourceType } from './content-sniffer'

function ftypBuffer(brand: string) {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftyp'),
    Buffer.from(brand),
  ])
}

describe('sniffResourceType', () => {
  it('detecta m4a (brand M4A ) como video', () => {
    expect(sniffResourceType(ftypBuffer('M4A '))).toBe('video')
  })

  it('detecta mp4 (brand isom) como video', () => {
    expect(sniffResourceType(ftypBuffer('isom'))).toBe('video')
  })

  it('detecta mov (brand qt  ) como video', () => {
    expect(sniffResourceType(ftypBuffer('qt  '))).toBe('video')
  })

  it('detecta webm (EBML) como video', () => {
    const buffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04])
    expect(sniffResourceType(buffer)).toBe('video')
  })

  it('detecta jpeg como image', () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    expect(sniffResourceType(buffer)).toBe('image')
  })

  it('detecta png como image', () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(sniffResourceType(buffer)).toBe('image')
  })

  it('detecta webp como image', () => {
    const buffer = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP'),
    ])
    expect(sniffResourceType(buffer)).toBe('image')
  })

  it('detecta gif como image', () => {
    expect(sniffResourceType(Buffer.from('GIF89a'))).toBe('image')
  })

  it('retorna raw para texto ASCII (html)', () => {
    expect(sniffResourceType(Buffer.from('<html><body></body></html>'))).toBe(
      'raw',
    )
  })

  it('retorna raw para texto ASCII comum', () => {
    expect(sniffResourceType(Buffer.from('hello world'))).toBe('raw')
  })

  it('retorna raw para buffer vazio', () => {
    expect(sniffResourceType(Buffer.alloc(0))).toBe('raw')
  })

  it('retorna raw para buffer curto demais (3 bytes)', () => {
    expect(sniffResourceType(Buffer.from([0x01, 0x02, 0x03]))).toBe('raw')
  })

  it('retorna raw para RIFF sem WEBP (ex.: WAV)', () => {
    const buffer = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WAVE'),
    ])
    expect(sniffResourceType(buffer)).toBe('raw')
  })
})
