import subprocess, sys

git = ['git']

def run(args, cwd):
    result = subprocess.run(git + args, cwd=cwd, capture_output=True, text=True)
    out = (result.stdout + result.stderr).strip()
    if out:
        print(out)
    return result.returncode

# ── Backend ───────────────────────────────────────────────────
backend = r'C:\Users\vitor\ConnectAI-Labs\connectai-backend'
print('=== BACKEND ===')

# Remover arquivos temporários de script
run(['rm', '-f',
     'prisma/patch_schema.py',
     'src/modules/consent/patch_server.py',
     'src/modules/consent/fix_service.py',
     'src/modules/consent/verify.py',
     'src/modules/consent/final_verify.py',
     'set_git_author.bat',
     'fix_gitconfig.py',
     'commit_push.py',
     ], backend)

run(['add', '-A'], backend)
run(['status', '--short'], backend)
rc = run(['commit', '-m',
    'feat(lgpd): implementa consentimento granular LGPD\n\n'
    '- Adiciona models UserConsent e ConsentAuditLog ao schema Prisma\n'
    '- Cria migration 20260604000000_add_lgpd_consent\n'
    '- Cria modulo src/modules/consent/ com schema, service, controller e routes\n'
    '- Adiciona 6 rotas: GET/POST/PATCH/DELETE /consent, /consent/export, /consent/audit\n'
    '- Inclui consent: { given, version, revokedAt } na resposta do GET /users/me\n'
    '- Registra consentRoutes no server.ts\n'
    '- Queries paralelas em getMe via Promise.all\n'
    '\n'
    'LGPD Art. 7 (bases legais), Art. 8 (consentimento granular), Art. 18 (direitos)'
], backend)

if rc == 0:
    print('Commit OK — publicando branch...')
    rc2 = run(['push', '-u', 'origin', 'feat/lgpd-privacy-consent'], backend)
    print('Push backend OK' if rc2 == 0 else f'Push backend ERROR (rc={rc2})')
else:
    print('Nada para commitar ou erro no commit')

# ── Mobile ────────────────────────────────────────────────────
mobile = r'C:\Users\vitor\ConnectAI-Labs\connectai-mobile'
print('\n=== MOBILE ===')

run(['rm', '-f',
     'src/app/(tabs)/profile/patch_profile.py',
     'src/app/patch_layout.py',
     'src/app/fix_layout.py',
     'set_git_author.bat',
     ], mobile)

run(['add', '-A'], mobile)
run(['status', '--short'], mobile)
rc = run(['commit', '-m',
    'feat(lgpd): implementa consentimento granular LGPD no app\n\n'
    '- Cria feature/privacy com consentService, consentStore (Zustand + AsyncStorage),\n'
    '  useConsent hook e ConsentToggleRow reutilizavel\n'
    '- Adiciona tela (auth)/consent.tsx para onboarding (accordions por categoria,\n'
    '  safe area, 3 opcoes de aceite, link para politica)\n'
    '- Adiciona tela profile/privacy.tsx com toggles granulares, exportar dados,\n'
    '  revogar consentimentos e link para DPO\n'
    '- Adiciona item "Privacidade" no ProfileDrawer\n'
    '- Gate no _layout.tsx: redireciona para consent se needsConsent ou needsVersionBump\n'
    '- Flag hydrated no store para evitar redirect prematuro no boot\n'
    '- Granular selectors no Zustand para evitar re-renders desnecessarios\n'
    '- useMemo em itemsByCategory nas duas telas\n'
    '\n'
    'LGPD Art. 7, Art. 8 e Art. 18 — politica v1.0'
], mobile)

if rc == 0:
    print('Commit OK — publicando branch...')
    rc2 = run(['push', '-u', 'origin', 'feat/lgpd-privacy-consent'], mobile)
    print('Push mobile OK' if rc2 == 0 else f'Push mobile ERROR (rc={rc2})')
else:
    print('Nada para commitar ou erro no commit')
