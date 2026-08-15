import type { StorageResourceType } from './storage.interface'

// Maior offset checado é o WEBP (byte 12 + 4 bytes) — o caller precisa acumular
// pelo menos isso antes de chamar sniffResourceType.
export const SNIFF_BYTES = 16

const JPEG = Buffer.from([0xff, 0xd8, 0xff])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3])

export function sniffResourceType(header: Buffer): StorageResourceType {
  // ftyp cobre toda a família ISO BMFF (MP4, M4A/AAC do iOS, MOV/QuickTime).
  if (
    header.length >= 8 &&
    header.subarray(4, 8).toString('ascii') === 'ftyp'
  ) {
    return 'video'
  }

  if (header.length >= 4 && header.subarray(0, 4).equals(EBML)) {
    return 'video'
  }

  if (header.length >= 3 && header.subarray(0, 3).equals(JPEG)) {
    return 'image'
  }

  if (header.length >= 8 && header.subarray(0, 8).equals(PNG)) {
    return 'image'
  }

  if (
    header.length >= 12 &&
    header.subarray(0, 4).toString('ascii') === 'RIFF' &&
    header.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image'
  }

  if (
    header.length >= 6 &&
    (header.subarray(0, 6).toString('ascii') === 'GIF87a' ||
      header.subarray(0, 6).toString('ascii') === 'GIF89a')
  ) {
    return 'image'
  }

  return 'raw'
}
