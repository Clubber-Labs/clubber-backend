import { afterEach, describe, expect, it, vi } from 'vitest'

const fakeTimer = () => ({ unref: () => {} }) as unknown as NodeJS.Timeout

/**
 * Testa o contrato comum de timer de um reconciler — guarda de singleton, unref
 * e re-arme após stop — num único describe. Todos os reconcilers do projeto
 * seguem o mesmo padrão (`if (timer) return; timer = setInterval(...); timer.unref()`),
 * então centralizar evita repetir o boilerplate em cada módulo.
 *
 * Cobre só a GERÊNCIA do timer: o setInterval é mockado e o tick não dispara — o
 * processamento de cada reconciler é testado à parte, chamando a função pura
 * direto (sem depender do intervalo real de produção).
 */
export function describeReconcilerTimer(
  name: string,
  opts: { start: () => void; stop: () => void; intervalMs: number },
) {
  const { start, stop, intervalMs } = opts

  describe(`${name} — gerência de timer`, () => {
    afterEach(() => {
      stop() // libera o singleton do módulo entre os testes
      vi.restoreAllMocks()
    })

    it('agenda um único intervalo e ignora start duplicado (guarda de singleton)', () => {
      const setSpy = vi
        .spyOn(globalThis, 'setInterval')
        .mockReturnValue(fakeTimer())

      start()
      start() // já rodando → não pode reagendar (senão dois ticks concorrentes)

      expect(setSpy).toHaveBeenCalledTimes(1)
      expect(setSpy.mock.calls[0][1]).toBe(intervalMs)
    })

    it('desarma o event loop com unref (não segura o processo vivo)', () => {
      const unref = vi.fn()
      vi.spyOn(globalThis, 'setInterval').mockReturnValue({
        unref,
      } as unknown as NodeJS.Timeout)

      start()

      expect(unref).toHaveBeenCalledTimes(1)
    })

    it('stop limpa o timer e permite reagendar depois', () => {
      const setSpy = vi
        .spyOn(globalThis, 'setInterval')
        .mockReturnValue(fakeTimer())
      const clearSpy = vi
        .spyOn(globalThis, 'clearInterval')
        .mockImplementation(() => {})

      start()
      stop()
      expect(clearSpy).toHaveBeenCalledTimes(1)

      start() // singleton liberado → reagenda
      expect(setSpy).toHaveBeenCalledTimes(2)
    })
  })
}
