// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import {
  Eye, EyeOff, Mail, Lock, Globe, ChevronDown,
  ShieldCheck, Zap, Info,
  Sun, Moon, Monitor,
} from 'lucide-react';
import {
  Button, Input, Logo, LogoWithText, CountryFlag,
} from '@/shared/ui';
import { readRememberChoice, saveRememberChoice, useAuthStore } from '@/stores/useAuthStore';
import { useBrandingStore } from '@/stores/useBrandingStore';
import { extractErrorMessageFromBody } from '@/shared/lib/api';
import { isTauri } from '@/shared/lib/desktop';
import { APP_VERSION } from '@/shared/lib/version';
import { loginFailureKindFromResponse } from './loginError';
import { AuthBackground } from './AuthBackground';
import { AuthBrandPanel } from './AuthBrandPanel';
import {
  shouldAttemptDesktopBootstrap,
  shouldQueryFirstRun,
  type FirstRunStatus,
} from './desktopBootstrap';
import { safeNextPath } from './nextPath';
import { SUPPORTED_LANGUAGES } from '@/app/i18n';
import { sortLanguagesByName } from '@/shared/lib/languageOrder';
import { useThemeStore } from '@/stores/useThemeStore';

/* Segmented theme switch (Light / Dark / System) for the login page. */
function ThemeSwitch() {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const opts = [
    { mode: 'light' as const, icon: Sun, label: t('theme.light', { defaultValue: 'Light' }) },
    { mode: 'dark' as const, icon: Moon, label: t('theme.dark', { defaultValue: 'Dark' }) },
    { mode: 'system' as const, icon: Monitor, label: t('theme.system', { defaultValue: 'System' }) },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={t('theme.label', { defaultValue: 'Theme' })}
      className="flex items-center gap-0.5 rounded-xl border border-border-light bg-surface-elevated/85 backdrop-blur-sm p-0.5 shadow-sm"
    >
      {opts.map(({ mode, icon: Icon, label }) => {
        const active = theme === mode;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={active}
            title={label}
            aria-label={label}
            onClick={() => setTheme(mode)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
              active
                ? 'bg-oe-blue text-white shadow-sm'
                : 'text-content-tertiary hover:text-content-secondary hover:bg-surface-secondary'
            }`}
          >
            <Icon size={15} strokeWidth={2} />
          </button>
        );
      })}
    </div>
  );
}

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const setTokens = useAuthStore((s) => s.setTokens);
  // White-label brand (same localStorage store the in-app sidebar editor
  // writes to). When a tenant has set a logo / company name we show it
  // on the login card instead of the default CesCons wordmark.
  const { mode: brandMode, logoDataUrl: brandLogo, companyName: brandName } =
    useBrandingStore();
  const brandCustomised = brandMode === 'logo' || brandMode === 'text';
  // Pull the workspace brand from the server so an invited user sees it on this
  // very first (pre-auth) screen, not just the browser that set it (issue #272).
  // Public endpoint, best-effort: the card paints instantly from localStorage
  // and this reconciles to whatever the workspace admin saved.
  useEffect(() => {
    void useBrandingStore.getState().hydrateFromServer();
  }, []);
  // `?next=/path` lets guarded routes send the user back to where they wanted
  // to go after login. Falls back to `/` for direct visits. Shared with the
  // authenticated-route guard (AuthedHome) so a redirect race between the two
  // cannot silently drop the `next` (the demo deep-link bug).
  const nextPath = safeNextPath(location.search);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Checked unless the user unchecked it last time they signed in here.
  const [rememberMe, setRememberMe] = useState(readRememberChoice);
  const [langOpen, setLangOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(true);
  const [demoHint, setDemoHint] = useState(false);
  const [demoLoading, setDemoLoading] = useState<string | null>(null);
  // The demo sign-in is shown by DEFAULT and only hidden when the server
  // explicitly reports demo is off (SEED_DEMO=false, or an admin turned it off
  // in Settings). Starting true means a probe that fails or races the ~60s
  // first-boot demo seeding can never leave the block hidden (see the effect
  // below). This is deliberate: demo access is a headline feature of the open
  // platform, so it should always be there on a fresh install.
  const [demoEnabled, setDemoEnabled] = useState<boolean>(true);
  const langRef = useRef<HTMLDivElement>(null);

  // Desktop first-run: when running inside the Tauri shell with no stored
  // token and no deliberate manual logout this session, we silently auto-sign
  // in to the local workspace owner. Seed the pending flag synchronously so the
  // very first paint shows "Preparing your workspace..." rather than flashing
  // the login form before the bootstrap effect runs.
  const [bootstrapping, setBootstrapping] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored =
      localStorage.getItem('oe_access_token') || sessionStorage.getItem('oe_access_token');
    const manual = sessionStorage.getItem('oe_manual_login');
    return shouldQueryFirstRun(isTauri, Boolean(stored), manual);
  });

  const currentLang =
    SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language) ?? SUPPORTED_LANGUAGES[0]!;

  // Clear form on mount (prevents pre-fill after logout)
  useEffect(() => {
    setEmail('');
    setPassword('');
    setError('');
  }, []);

  // Probe whether this server has demo turned OFF (public, no auth). The block
  // is shown by default (see the state above); this effect only ever HIDES it,
  // and only when the server explicitly reports `demo_enabled: false` - a
  // production install with SEED_DEMO=false, or an admin who turned demo off in
  // Settings. Older servers omit the field, which keeps the block shown. The
  // very first probe on a fresh install can race the ~60s demo seeding, so a
  // failed probe is retried a few times and NEVER hides the block on its own.
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const probe = async (): Promise<void> => {
      attempts += 1;
      try {
        const res = await fetch('/api/v1/auth/first-run', {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`first-run probe HTTP ${res.status}`);
        const status = (await res.json()) as FirstRunStatus;
        if (!cancelled) setDemoEnabled(status.demo_enabled !== false);
      } catch {
        // Transient failure (server still booting / seeding). Retry, but leave
        // the optimistic default in place so demo never vanishes on a hiccup.
        if (!cancelled && attempts < 6) {
          window.setTimeout(() => void probe(), 1500);
        }
      }
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

  // Desktop auto-bootstrap. Runs once on mount. On ANY failure it silently
  // falls back to the normal login form (clears `bootstrapping`); it never
  // surfaces an error to the user because manual login is always a valid path.
  useEffect(() => {
    if (!bootstrapping) return;
    let cancelled = false;

    const run = async () => {
      try {
        const res = await fetch('/api/v1/auth/first-run', {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error('first-run probe failed');
        const status = (await res.json()) as FirstRunStatus;

        const manual = sessionStorage.getItem('oe_manual_login');
        if (!shouldAttemptDesktopBootstrap(status, false, manual)) {
          throw new Error('bootstrap not applicable');
        }

        const bootRes = await fetch('/api/v1/auth/desktop-bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!bootRes.ok) throw new Error('desktop bootstrap failed');
        const data = (await bootRes.json()) as {
          access_token?: string;
          refresh_token?: string;
          user?: { email?: string };
        };
        if (!data.access_token || !data.refresh_token) {
          throw new Error('bootstrap response missing tokens');
        }
        if (cancelled) return;

        // Persist through the existing auth store path with remember=true so the
        // desktop owner stays signed in across launches.
        setTokens(data.access_token, data.refresh_token, true, data.user?.email);
        navigate(status.onboarding_completed === true ? '/dashboard' : '/onboarding', {
          replace: true,
        });
      } catch {
        // Silent fallback to the manual login form.
        if (!cancelled) setBootstrapping(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
    // Mount-only: the gate inputs are read fresh inside `run`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // OIDC configuration (fetched once on mount)
  const [oidcConfig, setOidcConfig] = useState<{
    enabled: boolean;
    issuer_url: string;
    client_id: string;
    scopes: string;
  } | null>(null);
  useEffect(() => {
    fetch('/api/v1/users/auth/oidc/config/')
      .then((r) => r.json())
      .then((d) => setOidcConfig(d))
      .catch(() => setOidcConfig(null));
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/v1/users/auth/login/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        // A proxy answering 502 for a backend that is down is a response, not
        // a network error, so the catch below never sees it. Without this the
        // outage lands on the credentials wording and the person is told the
        // one thing we know is untrue: nothing read their password. A 4xx
        // carrying no message we can read is that same outage told by whatever
        // stands in front of us, so the body decides alongside the status.
        const data = await res.json().catch(() => null);
        const parsed = extractErrorMessageFromBody(data);
        if (loginFailureKindFromResponse(res.status, parsed) === 'unavailable') {
          setError(
            t('auth.server_unavailable', {
              defaultValue:
                'The server did not answer, so your details were never checked. Try again in a moment.',
            }),
          );
          return;
        }
        setError(parsed || t('auth.invalid_credentials', 'Invalid email or password'));
        return;
      }
      const data = await res.json();
      saveRememberChoice(rememberMe);
      setTokens(data.access_token, data.refresh_token, rememberMe, email);
      navigate(nextPath, { replace: true });
    } catch {
      setError(t('auth.connection_error', 'Unable to connect to server. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  // Mirrors the seeded demo accounts in backend/app/main.py::_seed_demo_account:
  // every email here has to be one that seeder creates, and each name has to
  // match that account's full_name. The admin tile shows the role word instead
  // of the seeded person on purpose - that is what a first-time visitor scans
  // for. No password is listed on purpose either: the seeder generates a fresh
  // random one per install, so any literal printed here would be wrong on every
  // install. The tiles sign in through /auth/demo-login/ instead.
  const demoAccounts = [
    { email: 'demo@openconstructionerp.com', name: 'Admin', role: t('auth.demo_role_admin', 'Administrator'), color: 'bg-blue-500', letter: 'A' },
    { email: 'manager@openconstructionerp.com', name: 'Michael Carter', role: t('auth.demo_role_manager', 'Manager'), color: 'bg-[#7cd0ff]', letter: 'M' },
  ];

  const handleDemoLogin = async (demoEmail: string) => {
    setDemoLoading(demoEmail);
    setError('');
    setEmail('');
    setPassword('');
    try {
      // Password-less demo sign-in for the seeded showcase accounts. The
      // backend seeder generates a fresh random password per install (BUG-D01)
      // that the frontend cannot read, so this dedicated endpoint mints tokens
      // from the demo email alone. When demo seeding is disabled the server
      // returns 404 and we surface that message - we never fall back to
      // registering the account, so a demo click cannot create one in
      // production. The demo block is also hidden entirely in that config.
      const res = await fetch('/api/v1/users/auth/demo-login/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: demoEmail }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        // A real administrator exists, so the server no longer opens the
        // demo administrator without a password (app.core.demo_admin).
        if (data?.detail?.error === 'demo_admin_superseded') {
          setError(t('auth.demo_admin_superseded', 'This installation has an administrator. Please sign in with your own account.'));
          return;
        }
        const parsed = extractErrorMessageFromBody(data);
        setError(parsed || t('auth.demo_login_failed', 'Demo login failed. Please try again.'));
        return;
      }
      const data = await res.json();
      setTokens(data.access_token, data.refresh_token, false, demoEmail);
      navigate(nextPath, { replace: true });
    } catch {
      setError(t('auth.connection_error', 'Unable to connect to server. Please try again.'));
    } finally {
      setDemoLoading(null);
    }
  };


  // Desktop first-run: clean centered pending state while we silently sign in
  // to the local workspace. Falls back to the form on any failure (see effect).
  if (bootstrapping) {
    return (
      <div className="relative flex h-screen flex-col items-center justify-center bg-surface-secondary overflow-hidden">
        <AuthBackground />
        <div className="relative z-10 flex flex-col items-center gap-5 px-6 text-center">
          <Logo size="lg" animate />
          <svg
            className="h-7 w-7 animate-spin text-oe-blue"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <p className="text-sm font-medium text-content-secondary">
            {t('auth.preparing_workspace', { defaultValue: 'Preparing your workspace...' })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative grid min-h-screen grid-cols-1 bg-surface-primary lg:h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* Brand column; lg:order-2 keeps the form on the left as the primary action. */}
      <AuthBrandPanel className="lg:order-2" />

      <div className="relative z-10 flex flex-col px-5 py-5 sm:px-10 lg:order-1 lg:overflow-y-auto">
        {/* Top bar: brand on the left, theme and language on the right. */}
        <div className="flex items-center justify-between gap-3">
          {brandCustomised ? (
            <div className="flex min-w-0 flex-col">
              {brandMode === 'logo' && brandLogo ? (
                <img
                  src={brandLogo}
                  alt={brandName || 'Custom logo'}
                  className="block max-h-10 w-auto max-w-[200px] object-contain"
                  draggable={false}
                />
              ) : (
                <span className="block max-w-full truncate text-xl font-bold text-content-primary leading-none" title={brandName}>
                  {brandName}
                </span>
              )}
              {/* Subordinate attribution that stays visible (AGPL-3.0). Mirrors CustomBranding.tsx. */}
              <span className="mt-1.5 block text-[11px] leading-none text-content-tertiary">
                by <span className="font-semibold">OpenConstructionERP</span>
              </span>
            </div>
          ) : (
            <LogoWithText size="md" />
          )}
          <div className="flex items-center gap-2">
            <ThemeSwitch />
            <div className="relative" ref={langRef}>
              <button
                type="button"
                onClick={() => setLangOpen(!langOpen)}
                aria-expanded={langOpen}
                className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface-primary px-3 text-sm font-medium text-content-secondary transition-colors hover:border-content-quaternary hover:text-content-primary"
              >
                <Globe size={15} className="text-content-tertiary" />
                <CountryFlag code={currentLang.country} size={18} />
                <span className="hidden sm:inline">{currentLang.name}</span>
                <ChevronDown size={14} className={`text-content-tertiary transition-transform ${langOpen ? 'rotate-180' : ''}`} />
              </button>
              {langOpen && (
                <div className="absolute right-0 z-30 mt-1.5 w-64 max-h-80 overflow-y-auto rounded-md border border-border bg-surface-elevated py-1 shadow-md">
                  {sortLanguagesByName(SUPPORTED_LANGUAGES).map((lang) => {
                    const isActive = i18n.language === lang.code;
                    const english = 'english' in lang ? (lang as { english?: string }).english : undefined;
                    return (
                      <button
                        key={lang.code}
                        type="button"
                        onClick={() => { i18n.changeLanguage(lang.code); setLangOpen(false); }}
                        className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors ${isActive ? 'bg-oe-blue-subtle text-oe-blue-text font-medium' : 'text-content-primary hover:bg-surface-secondary'}`}
                      >
                        <CountryFlag code={lang.country} size={18} />
                        <span className="truncate">
                          {lang.name}
                          {english && (
                            <span className="ml-1 text-2xs text-content-tertiary">({english})</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[380px]">
            <h1 className="text-2xl font-semibold text-content-primary">{t('auth.login', 'Sign in')}</h1>
            <p className="mt-1.5 text-sm text-content-secondary">
              {t('auth.login_subtitle', 'Enter your credentials to access your workspace')}
            </p>

            <form onSubmit={handleSubmit} className="mt-7 space-y-4" aria-label={t('auth.login', 'Sign in')}>
              <Input id="login-email" name="email" label={t('auth.email', 'Email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" required aria-required="true" autoFocus icon={<Mail size={15} />} />

              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label htmlFor="login-password" className="text-sm font-medium text-content-primary">{t('auth.password', 'Password')}</label>
                  <Link to="/forgot-password" className="text-xs font-medium text-oe-blue-text hover:underline">{t('auth.forgot_password', 'Forgot password?')}</Link>
                </div>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-content-tertiary"><Lock size={15} /></div>
                  <input id="login-password" name="password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('auth.password_placeholder', 'Enter your password')} autoComplete="current-password" required aria-required="true" minLength={8} className="h-10 w-full rounded-md border border-border bg-surface-primary pl-9 pr-10 text-sm text-content-primary placeholder:text-content-tertiary transition-colors duration-fast ease-oe focus:outline-none focus:ring-2 focus:ring-oe-blue focus:border-transparent hover:border-content-quaternary" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? t('auth.hide_password', 'Hide password') : t('auth.show_password', 'Show password')} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-content-tertiary hover:text-content-secondary transition-colors" tabIndex={-1}>
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="h-4 w-4 rounded border-border text-oe-blue focus:ring-oe-blue accent-oe-blue" />
                <span className="text-sm text-content-secondary">{t('auth.remember_me', 'Remember me for 30 days')}</span>
              </label>

              {error && (
                <div
                  data-testid="login-error"
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-semantic-error/30 bg-semantic-error-bg px-3 py-2 text-sm text-semantic-error"
                >
                  <span className="shrink-0 font-semibold">!</span><span>{error}</span>
                </div>
              )}

              <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">{t('auth.login', 'Sign in')}</Button>
            </form>

            {/* OIDC / SSO login - shown when the server has OIDC enabled */}
            {oidcConfig?.enabled && (
              <div className="mt-4">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 border-t border-border-light" />
                  <span className="text-xs text-content-tertiary">{t('auth.or', { defaultValue: 'or' })}</span>
                  <div className="flex-1 border-t border-border-light" />
                </div>
                <Button
                  variant="secondary"
                  size="lg"
                  className="w-full"
                  icon={<ShieldCheck size={16} />}
                  onClick={() => {
                    const params = new URLSearchParams({
                      client_id: oidcConfig.client_id,
                      response_type: 'code',
                      scope: oidcConfig.scopes,
                      redirect_uri: `${window.location.origin}/auth/oidc/callback`,
                    });
                    window.location.href = `${oidcConfig.issuer_url}/protocol/openid-connect/auth?${params}`;
                  }}
                >
                  {t('auth.sso_login', { defaultValue: 'Sign in with SSO' })}
                </Button>
              </div>
            )}

            <p className="mt-6 text-sm text-content-secondary">
              {t('auth.no_account', "Don't have an account?")}{' '}
              <Link to="/register" className="font-medium text-oe-blue-text hover:underline">{t('auth.create_account', 'Create account')}</Link>
            </p>

            {/* Demo Access - shown by default. Hidden only when the server
                reports demo is off (SEED_DEMO=false, or an admin turned it off in
                Settings), which flips demoEnabled to false in the effect above. */}
            {demoEnabled && (
              <div className="relative mt-6 rounded-md border border-border">
                <div className="flex w-full items-center">
                  <button
                    type="button"
                    onClick={() => setDemoOpen(!demoOpen)}
                    aria-expanded={demoOpen}
                    className="flex flex-1 items-center gap-2 px-4 py-2.5 text-sm font-medium text-content-primary hover:bg-surface-secondary transition-colors"
                  >
                    <Zap size={14} className="text-oe-blue-text" />
                    <span>{t('auth.try_demo', { defaultValue: 'Try demo (no signup)' })}</span>
                    <ChevronDown size={14} className={`ms-auto text-content-tertiary transition-transform duration-150 ${demoOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {/* Info affordance. Hover reveals it; click pins it (touch / keyboard). */}
                  <div className="group relative me-1.5">
                    <button
                      type="button"
                      aria-label={t('auth.demo_hint_aria', { defaultValue: 'About the demo sign-in block' })}
                      onClick={() => setDemoHint((v) => !v)}
                      className="flex h-7 w-7 items-center justify-center rounded text-content-tertiary hover:text-content-primary hover:bg-surface-secondary transition-colors"
                    >
                      <Info size={14} />
                    </button>
                    <div
                      role="tooltip"
                      className={`pointer-events-none absolute right-0 top-full z-40 mt-1.5 w-64 rounded-md border border-border bg-surface-elevated px-3 py-2 text-left text-xs leading-relaxed text-content-primary shadow-md transition-opacity duration-150 ${demoHint ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    >
                      {t('auth.demo_hint', {
                        defaultValue:
                          'Optional demo sign-in. It only appears while demo accounts are enabled, so an administrator can turn it off.',
                      })}
                    </div>
                  </div>
                </div>

                {demoOpen && (
                  <div className="divide-y divide-border-light border-t border-border-light">
                    {demoAccounts.map((acct) => (
                      <button
                        key={acct.email}
                        type="button"
                        onClick={() => handleDemoLogin(acct.email)}
                        disabled={demoLoading !== null}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-secondary disabled:opacity-50 group"
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-tertiary border border-border text-xs font-semibold text-content-secondary">
                          {demoLoading === acct.email ? (
                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                          ) : (
                            acct.letter
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-content-primary">{acct.name}</div>
                          <div className="text-xs text-content-tertiary truncate">{acct.email} · {acct.role}</div>
                        </div>
                        <ChevronDown size={15} className="text-content-quaternary -rotate-90 group-hover:text-oe-blue-text transition-colors shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Running build version - always visible so it's obvious which
            version is live on a fresh open. Matches the Sidebar / About
            treatment (v{APP_VERSION}). */}
        <div className="text-xs text-content-tertiary tabular-nums">
          {t('login.workspace_tagline', { defaultValue: 'Professional construction project workspace' })} · v{APP_VERSION}
        </div>
      </div>
    </div>
  );
}
