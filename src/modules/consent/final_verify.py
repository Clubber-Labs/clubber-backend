import pathlib, sys

checks = [
    (r'C:\Users\vitor\ConnectAI-Labs\connectai-backend\src\modules\consent\consent.service.ts',
     'Object.keys(body).length === 0', 'skip empty update'),
    (r'C:\Users\vitor\ConnectAI-Labs\connectai-backend\src\modules\consent\consent.controller.ts',
     'req.socket?.remoteAddress ?? null', 'safe socket access'),
    (r'C:\Users\vitor\ConnectAI-Labs\connectai-backend\src\modules\users\users.service.ts',
     'Promise.all', 'parallel getMe'),
    (r'C:\Users\vitor\ConnectAI-Labs\connectai-mobile\src\features\privacy\store\consentStore.ts',
     'onRehydrateStorage', 'hydrated flag'),
    (r'C:\Users\vitor\ConnectAI-Labs\connectai-mobile\src\features\privacy\store\consentStore.ts',
     's.hydrated &&', 'hydrated guard in selector'),
    (r'C:\Users\vitor\ConnectAI-Labs\connectai-mobile\src\features\privacy\hooks\useConsent.ts',
     'useConsentStore.getState()', 'getState in sync effect'),
    (r'C:\Users\vitor\ConnectAI-Labs\connectai-mobile\src\features\privacy\hooks\useConsent.ts',
     'hydrate, markPending', 'stable action refs in useCallback'),
    (r'C:\Users\vitor\ConnectAI-Labs\connectai-mobile\src\app\(auth)\consent.tsx',
     'useSafeAreaInsets', 'safe area insets'),
    (r'C:\Users\vitor\ConnectAI-Labs\connectai-mobile\src\app\(auth)\consent.tsx',
     'useMemo', 'useMemo consent.tsx'),
    (r'C:\Users\vitor\ConnectAI-Labs\connectai-mobile\src\app\profile\privacy.tsx',
     'useMemo', 'useMemo privacy.tsx'),
    (r'C:\Users\vitor\ConnectAI-Labs\connectai-mobile\src\app\profile\privacy.tsx',
     'useConsentStore(s => s.locationPrecise)', 'granular selectors privacy.tsx'),
    (r'C:\Users\vitor\ConnectAI-Labs\connectai-mobile\src\app\_layout.tsx',
     'selectConsentHydrated', 'hydrated guard in layout'),
]

all_ok = True
for path, keyword, label in checks:
    try:
        content = pathlib.Path(path).read_text(encoding='utf-8')
        ok = keyword in content
        if not ok:
            all_ok = False
        status = 'OK' if ok else 'MISSING'
        print(f"{status}: {label} ({pathlib.Path(path).name})")
    except FileNotFoundError:
        print(f"FILE MISSING: {path}")
        all_ok = False

print()
print('ALL OK' if all_ok else 'ISSUES FOUND')
sys.exit(0 if all_ok else 1)
