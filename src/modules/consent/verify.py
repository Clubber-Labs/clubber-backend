import pathlib

checks = [
    (r'C:\Users\vitor\ConnectAI-Labs\connectai-backend\src\server.ts', 'consentRoutes'),
    (r'C:\Users\vitor\ConnectAI-Labs\connectai-backend\src\modules\users\users.service.ts', 'getConsentSummary'),
    (r'C:\Users\vitor\ConnectAI-Labs\connectai-mobile\src\app\_layout.tsx', 'needsConsent'),
    (r'C:\Users\vitor\ConnectAI-Labs\connectai-mobile\src\app\(tabs)\profile\index.tsx', 'Privacidade'),
    (r'C:\Users\vitor\ConnectAI-Labs\connectai-mobile\src\app\(auth)\_layout.tsx', 'consent'),
    (r'C:\Users\vitor\ConnectAI-Labs\connectai-backend\prisma\schema.prisma', 'UserConsent'),
    (r'C:\Users\vitor\ConnectAI-Labs\connectai-backend\prisma\schema.prisma', 'ConsentAuditLog'),
]

all_ok = True
for path, keyword in checks:
    content = pathlib.Path(path).read_text(encoding='utf-8')
    ok = keyword in content
    if not ok:
        all_ok = False
    print(f"{'OK' if ok else 'MISSING'}: {keyword!r} in {pathlib.Path(path).name}")

print()
print('ALL OK' if all_ok else 'SOME MISSING')
