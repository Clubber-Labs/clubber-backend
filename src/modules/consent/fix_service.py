import pathlib

# Fix 1: users.service.ts — getMe sequential → parallel
service = pathlib.Path(r'C:\Users\vitor\ConnectAI-Labs\connectai-backend\src\modules\users\users.service.ts')
content = service.read_text(encoding='utf-8')

old = '''  if (!user) throw { statusCode: 401, message: 'Sessão inválida' }
  const { _count, ...rest } = user
  const consent = await getConsentSummary(userId)
  return { ...withPreferredCategories(rest), eventsCount: _count.events, consent }'''

new = '''  if (!user) throw { statusCode: 401, message: 'Sessão inválida' }
  const { _count, ...rest } = user
  // Paralelo: evita round-trip sequencial ao banco
  const [preferredUser, consent] = await Promise.all([
    Promise.resolve(withPreferredCategories(rest)),
    getConsentSummary(userId),
  ])
  return { ...preferredUser, eventsCount: _count.events, consent }'''

assert old in content, 'getMe pattern not found'
content = content.replace(old, new, 1)
service.write_text(content, encoding='utf-8')
print('users.service.ts OK')

# Fix 2: consent.service.ts — skip audit log when body is empty in updateConsent
consent_svc = pathlib.Path(r'C:\Users\vitor\ConnectAI-Labs\connectai-backend\src\modules\consent\consent.service.ts')
content2 = consent_svc.read_text(encoding='utf-8')

old2 = '''export async function updateConsent(
  userId: string,
  body: UpdateConsentBody,
  meta: RequestMeta,
) {
  const existing = await prisma.userConsent.findUnique({ where: { userId } })
  if (!existing) {
    throw { statusCode: 404, message: 'Consentimento não encontrado. Use POST para criar.' }
  }

  const [updated] = await prisma.$transaction(['''

new2 = '''export async function updateConsent(
  userId: string,
  body: UpdateConsentBody,
  meta: RequestMeta,
) {
  const existing = await prisma.userConsent.findUnique({ where: { userId } })
  if (!existing) {
    throw { statusCode: 404, message: 'Consentimento não encontrado. Use POST para criar.' }
  }

  // Nada para atualizar → retorna o estado atual sem tocar no banco
  if (Object.keys(body).length === 0) return existing

  const [updated] = await prisma.$transaction(['''

assert old2 in content2, 'updateConsent pattern not found'
content2 = content2.replace(old2, new2, 1)

# Fix 3: extractMeta no controller — garantir string | null (nunca undefined)
consent_ctrl = pathlib.Path(r'C:\Users\vitor\ConnectAI-Labs\connectai-backend\src\modules\consent\consent.controller.ts')
content3 = consent_ctrl.read_text(encoding='utf-8')

old3 = '''function extractMeta(req: FastifyRequest) {
  return {
    ipAddress:
      ((req.headers['x-forwarded-for'] as string) ?? '').split(',')[0]?.trim() ||
      req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
  }
}'''

new3 = '''function extractMeta(req: FastifyRequest) {
  const forwarded = ((req.headers['x-forwarded-for'] as string | undefined) ?? '')
    .split(',')[0]
    ?.trim() || null
  return {
    ipAddress: forwarded ?? req.socket?.remoteAddress ?? null,
    userAgent: req.headers['user-agent'],
  }
}'''

assert old3 in content3, 'extractMeta not found'
content3 = content3.replace(old3, new3, 1)

consent_svc.write_text(content2, encoding='utf-8')
print('consent.service.ts OK')
consent_ctrl.write_text(content3, encoding='utf-8')
print('consent.controller.ts OK')
