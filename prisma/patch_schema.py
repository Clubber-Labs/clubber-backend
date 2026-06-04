content = open(r'C:\Users\vitor\ConnectAI-Labs\connectai-backend\prisma\schema.prisma', encoding='utf-8').read()
old = '  messageReactions           MessageReaction[]         @relation("messageReactions")\n  @@map("users")\n}'
new = '  messageReactions           MessageReaction[]         @relation("messageReactions")\n\n  // LGPD\n  consent        UserConsent?\n  consentLogs    ConsentAuditLog[]\n\n  @@map("users")\n}'
assert old in content, 'STRING NOT FOUND: ' + repr(old[:50])
result = content.replace(old, new, 1)

# Append models at end
models = '''

// ── LGPD ────────────────────────────────────────────────────

model UserConsent {
  id                 String    @id @default(uuid())
  userId             String    @unique
  user               User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Essencial (sempre true, imutável)
  essentialAccepted  Boolean   @default(true)

  // Os 7 consentimentos granulares da Política de Privacidade v1.0
  locationPrecise    Boolean   @default(false)  // GPS em tempo real
  socialFeed         Boolean   @default(false)  // Feed personalizado por amigos
  socialVisibility   Boolean   @default(false)  // Visibilidade de atividades
  pushNotifications  Boolean   @default(false)  // Notificações push
  marketing          Boolean   @default(false)  // Comunicações de marketing
  analytics          Boolean   @default(false)  // Analytics e métricas de uso
  surveys            Boolean   @default(false)  // Participação em pesquisas

  consentVersion     String    @default("1.0")
  ipAddress          String?
  userAgent          String?
  collectedAt        DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  revokedAt          DateTime?

  @@index([userId])
  @@map("user_consents")
}

model ConsentAuditLog {
  id             String   @id @default(uuid())
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  action         String   // GRANTED | UPDATED | REVOKED | EXPORTED
  changedFields  Json     // { field: string, from: boolean|null, to: boolean }[]
  ipAddress      String?
  userAgent      String?
  consentVersion String

  createdAt      DateTime @default(now())

  @@index([userId])
  @@index([createdAt])
  @@map("consent_audit_logs")
}
'''
result += models
open(r'C:\Users\vitor\ConnectAI-Labs\connectai-backend\prisma\schema.prisma', 'w', encoding='utf-8').write(result)
print('OK')
