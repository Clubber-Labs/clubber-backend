import re, pathlib

# 1. Registrar consentRoutes no server.ts
server = pathlib.Path(r'C:\Users\vitor\ConnectAI-Labs\connectai-backend\src\server.ts')
content = server.read_text(encoding='utf-8')

# Adicionar import
old_import = "import { usersRoutes } from './modules/users/users.routes'"
new_import = "import { consentRoutes } from './modules/consent/consent.routes'\nimport { usersRoutes } from './modules/users/users.routes'"
assert old_import in content, 'import not found'
content = content.replace(old_import, new_import, 1)

# Registrar a rota após usersRoutes
old_register = "app.register(usersRoutes)"
new_register = "app.register(usersRoutes)\napp.register(consentRoutes)"
assert old_register in content, 'register not found'
content = content.replace(old_register, new_register, 1)

server.write_text(content, encoding='utf-8')
print('server.ts OK')

# 2. Adicionar getConsentSummary ao users.service.ts getMe
service = pathlib.Path(r'C:\Users\vitor\ConnectAI-Labs\connectai-backend\src\modules\users\users.service.ts')
content = service.read_text(encoding='utf-8')

# Adicionar import
old_import2 = "import {\n  createUser,"
new_import2 = "import { getConsentSummary } from '../consent/consent.service'\nimport {\n  createUser,"
assert old_import2 in content, 'users import not found'
content = content.replace(old_import2, new_import2, 1)

# Enriquecer o getMe com consent
old_getme = "export async function getMe(userId: string) {\n  const user = await findUserById(userId)\n  // Token válido cujo usuário não existe mais (ex.: conta deletada) = sessão\n  // inválida → 401, sinal inequívoco para o cliente deslogar (não 404, que\n  // confundiria com \"recurso ausente\").\n  if (!user) throw { statusCode: 401, message: 'Sessão inválida' }\n  const { _count, ...rest } = user\n  return { ...withPreferredCategories(rest), eventsCount: _count.events }\n}"
new_getme = """export async function getMe(userId: string) {
  const user = await findUserById(userId)
  // Token válido cujo usuário não existe mais (ex.: conta deletada) = sessão
  // inválida → 401, sinal inequívoco para o cliente deslogar (não 404, que
  // confundiria com \"recurso ausente\").
  if (!user) throw { statusCode: 401, message: 'Sessão inválida' }
  const { _count, ...rest } = user
  const consent = await getConsentSummary(userId)
  return { ...withPreferredCategories(rest), eventsCount: _count.events, consent }
}"""
assert old_getme in content, 'getMe not found: ' + repr(old_getme[:60])
content = content.replace(old_getme, new_getme, 1)

service.write_text(content, encoding='utf-8')
print('users.service.ts OK')
