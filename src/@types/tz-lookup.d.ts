declare module 'tz-lookup' {
  /** Nome IANA do fuso do ponto. Lança para coordenada fora de faixa. */
  export default function tzLookup(latitude: number, longitude: number): string
}
