import { describe, expect, it } from 'vitest'
import { sanitizeLogUrl } from './logger'

describe('sanitizeLogUrl', () => {
  it('redige o token do handshake do WebSocket', () => {
    expect(sanitizeLogUrl('/ws/chat?token=eyJhbGc.SECRET.sig')).toBe(
      '/ws/chat?token=[REDACTED]',
    )
  })

  it('preserva params não sensíveis', () => {
    expect(sanitizeLogUrl('/ws/chat?token=abc&foo=bar')).toBe(
      '/ws/chat?token=[REDACTED]&foo=bar',
    )
    expect(sanitizeLogUrl('/feed?cursor=xyz&limit=20')).toBe(
      '/feed?cursor=xyz&limit=20',
    )
  })

  it('redige token no meio da query, mantendo os demais', () => {
    expect(sanitizeLogUrl('/x?a=1&token=abc&b=2')).toBe(
      '/x?a=1&token=[REDACTED]&b=2',
    )
  })

  it('redige ticket e access_token também', () => {
    expect(sanitizeLogUrl('/x?ticket=abc')).toBe('/x?ticket=[REDACTED]')
    expect(sanitizeLogUrl('/x?access_token=abc')).toBe(
      '/x?access_token=[REDACTED]',
    )
  })

  it('não confunde params parecidos (mytoken)', () => {
    expect(sanitizeLogUrl('/x?mytoken=abc')).toBe('/x?mytoken=abc')
  })

  it('não altera URL sem query', () => {
    expect(sanitizeLogUrl('/conversations')).toBe('/conversations')
  })
})
