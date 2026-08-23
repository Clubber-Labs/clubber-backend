import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppError } from './app-error'

/**
 * Guard-rail do contrato de erro por código.
 *
 * Erro de negócio é `throw new AppError(status, code)` — o cliente traduz o
 * `code`; texto de exibição nunca nasce no servidor. Um objeto de erro cru
 * reintroduziria mensagem hardcoded fora do contrato, então este teste falha se
 * ele reaparecer em src/ — lançado inline ou montado numa const antes.
 */

const FORBIDDEN = [
  /throw\s+\{[^}]*statusCode/s,
  // Montar o objeto numa const e lançar depois escapa do padrão acima — foi
  // como uma mensagem em PT sobreviveu à migração para AppError. O par
  // (statusCode, message) num literal só existe para virar erro de negócio.
  /\{[^{}]*\bstatusCode\s*:[^{}]*\bmessage\s*:[^{}]*\}/s,
  /\{[^{}]*\bmessage\s*:[^{}]*\bstatusCode\s*:[^{}]*\}/s,
]

const SELF = join('src', 'lib', 'errors', 'app-error.test.ts')
const ROOT = process.cwd()

function collectTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      out.push(...collectTsFiles(full))
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.includes('.test.') &&
      !relative(ROOT, full).endsWith(SELF)
    ) {
      out.push(full)
    }
  }
  return out
}

describe('contrato de erro — nenhum throw de objeto cru', () => {
  const files = collectTsFiles(join(ROOT, 'src'))

  it('encontra arquivos para varrer (sanity check do scanner)', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('não monta objeto de erro com statusCode/message fora do AppError', () => {
    const offenders: string[] = []

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      // Remove comentários de linha antes do match: mencionar o padrão em
      // doc/comentário não é uso.
      const withoutLineComments = source
        .split('\n')
        .filter((line) => {
          const trimmed = line.trimStart()
          return (
            !trimmed.startsWith('//') &&
            !trimmed.startsWith('*') &&
            !trimmed.startsWith('/*')
          )
        })
        .join('\n')
      if (FORBIDDEN.some((pattern) => pattern.test(withoutLineComments))) {
        offenders.push(relative(ROOT, file))
      }
    }

    expect(
      offenders,
      offenders.length > 0
        ? `throw de objeto cru detectado. Use \`throw new AppError(status, code)\`:\n${offenders.join('\n')}`
        : '',
    ).toEqual([])
  })
})

describe('AppError', () => {
  it('carrega status, code, field e params; message espelha o code', () => {
    const err = new AppError(409, 'USERNAME_TAKEN', 'username', { max: 5 })
    expect(err).toBeInstanceOf(Error)
    expect(err.statusCode).toBe(409)
    expect(err.code).toBe('USERNAME_TAKEN')
    expect(err.field).toBe('username')
    expect(err.params).toEqual({ max: 5 })
    expect(err.message).toBe('USERNAME_TAKEN')
  })
})
