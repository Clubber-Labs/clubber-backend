import type { FastifyInstance, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import { DEFAULT_LOCALE, resolveLocale } from '../lib/i18n/locale'

// Preserva Vary já setado por outro plugin (ex.: CORS com Origin).
function appendVaryAcceptLanguage(reply: FastifyReply) {
  const current = reply.getHeader('vary')
  const value = Array.isArray(current)
    ? current.join(', ')
    : current == null
      ? ''
      : String(current)
  if (value.includes('*') || /\baccept-language\b/i.test(value)) return
  reply.header('vary', value ? `${value}, Accept-Language` : 'Accept-Language')
}

// Negocia o idioma da request e o expõe em request.locale — SÓ pelo header, por
// decisão: o app espelha a escolha explícita do usuário no próprio
// Accept-Language (interceptor), então consultar user.localePreference aqui
// custaria uma query por request para chegar ao mesmo resultado. A preferência
// persistida existe para os canais SEM request — push/e-mail — via
// effectiveLocale (lib/i18n/user-locale).
async function localePluginFn(app: FastifyInstance) {
  app.decorateRequest('locale', DEFAULT_LOCALE)

  app.addHook('onRequest', async (request) => {
    request.locale = resolveLocale(request.headers['accept-language'])
  })

  // Sem Vary, um cache/CDN no caminho serviria a resposta de um locale a
  // usuários de outro.
  app.addHook('onSend', async (_request, reply, payload) => {
    appendVaryAcceptLanguage(reply)
    return payload
  })
}

export const localePlugin = fp(localePluginFn, {
  name: 'locale-plugin',
})
