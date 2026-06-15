import { env } from './env'

// Fonte única do config.rateLimit das rotas. Aplica o fator e a janela globais
// (env) sobre o limite "de projeto" de cada rota, preservando a diferenciação
// entre elas (ex.: login=10 vs mapa=240) — só escala proporcionalmente.
//
// `baseMax` é o teto base da rota (o número que ficava hardcoded). Com os
// defaults (RATE_LIMIT_MAX_FACTOR=1, RATE_LIMIT_WINDOW='1 minute') o resultado
// é idêntico ao anterior.
export function rateLimit(baseMax: number) {
  return {
    max: Math.max(1, Math.ceil(baseMax * env.RATE_LIMIT_MAX_FACTOR)),
    timeWindow: env.RATE_LIMIT_WINDOW,
  }
}
