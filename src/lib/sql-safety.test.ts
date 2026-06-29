import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guard-rail contra SQL injection.
 *
 * O projeto usa SQL cru em vários módulos (PostGIS, advisory locks, feed,
 * proximidade, spots). Todo esse SQL é parametrizado via tagged template
 * `Prisma.sql` — cada `${valor}` vira um placeholder bindado, nunca texto
 * interpolado. As únicas APIs do Prisma que aceitam string concatenada (e
 * portanto abrem porta para injection) são proibidas:
 *
 *   - $queryRawUnsafe / $executeRawUnsafe → recebem a query como string
 *   - Prisma.raw → injeta um fragmento SEM parametrizar
 *
 * Se você precisa de SQL dinâmico, componha com `Prisma.sql`, `Prisma.join`
 * e `Prisma.empty` — todos preservam a parametrização. Este teste falha se
 * alguém introduzir uma das APIs inseguras em qualquer lugar de src/ ou
 * prisma/, antes que o código chegue ao banco.
 */

const FORBIDDEN: { pattern: RegExp; api: string }[] = [
  { pattern: /\$queryRawUnsafe/, api: '$queryRawUnsafe' },
  { pattern: /\$executeRawUnsafe/, api: '$executeRawUnsafe' },
  { pattern: /\bPrisma\.raw\b/, api: 'Prisma.raw' },
]

// Exclui o próprio scanner do scan: ele contém os padrões proibidos como
// strings/regex e dispararia falso-positivo em si mesmo. Caminho relativo
// completo (não só o nome) pra não excluir um homônimo em outro diretório.
const SELF = join('src', 'lib', 'sql-safety.test.ts')
// Raiz do repo = cwd ao rodar `pnpm test`/`pnpm build`. Evita import.meta
// (proibido sob module:CommonJS no tsconfig) e __dirname.
const ROOT = process.cwd()
const SCAN_DIRS = ['src', 'prisma']

function collectTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      out.push(...collectTsFiles(full))
    } else if (
      entry.name.endsWith('.ts') &&
      !relative(ROOT, full).endsWith(SELF)
    ) {
      out.push(full)
    }
  }
  return out
}

describe('segurança de SQL — nenhuma API de SQL cru insegura', () => {
  const files = SCAN_DIRS.flatMap((d) => collectTsFiles(join(ROOT, d)))

  it('encontra arquivos para varrer (sanity check do scanner)', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('não usa $queryRawUnsafe, $executeRawUnsafe nem Prisma.raw', () => {
    const offenders: string[] = []

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const lines = source.split('\n')
      lines.forEach((line, i) => {
        // Pula linhas de comentário: o scanner busca USO das APIs no código, não
        // menções em `// ...` ou JSDoc (`*` / `/*`). Sem isto, documentar a regra
        // num .ts (ex.: "// nunca use $queryRawUnsafe") viraria falso-positivo.
        const trimmed = line.trimStart()
        if (
          trimmed.startsWith('//') ||
          trimmed.startsWith('*') ||
          trimmed.startsWith('/*')
        ) {
          return
        }
        for (const { pattern, api } of FORBIDDEN) {
          if (pattern.test(line)) {
            offenders.push(`${relative(ROOT, file)}:${i + 1} → ${api}`)
          }
        }
      })
    }

    expect(
      offenders,
      offenders.length > 0
        ? `SQL cru inseguro detectado. Use Prisma.sql/Prisma.join/Prisma.empty (parametrizados):\n${offenders.join('\n')}`
        : '',
    ).toEqual([])
  })
})
