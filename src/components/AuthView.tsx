import { useEffect, useState } from 'react';
import { Eye, EyeOff, Globe, KeyRound, Lock, Mail, Moon, Sun, User } from 'lucide-react';
import type { AuthUser, Language } from '../types';
import { translations } from '../i18n';
import { PASSWORD_MIN_LENGTH } from '../validation';

/** A pause imposed by the server (R1.9): 'account' = this email, 'network' = this IP. */
interface SignInPause {
  until: number;
  scope: 'account' | 'network';
  email: string;
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

interface AuthViewProps {
  lang: Language;
  darkMode: boolean;
  onToggleLang: () => void;
  onToggleDarkMode: () => void;
  onAuthSuccess: (token: string, user: AuthUser) => void;
}

// 'setup' is only available while the system has no users (first-run setup).
// After that, accounts are created by an administrator — there is no self-registration.
type AuthMode = 'login' | 'setup';

export function AuthView({
  lang,
  darkMode,
  onToggleLang,
  onToggleDarkMode,
  onAuthSuccess,
}: AuthViewProps) {
  const t = translations[lang];
  const isAr = lang === 'ar';

  const [mode, setMode] = useState<AuthMode>('login');
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  const [setupTokenRequired, setSetupTokenRequired] = useState(false);
  const [setupToken, setSetupToken] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pause, setPause] = useState<SignInPause | null>(null);
  const [now, setNow] = useState(0);

  // Ticks the countdown once a second while a pause is active.
  useEffect(() => {
    if (!pause) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= pause.until) setPause(null);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pause]);

  const pauseSecondsLeft = pause ? Math.max(0, Math.ceil((pause.until - now) / 1000)) : 0;
  // An account pause only blocks that email; a network pause blocks every attempt.
  const isPaused =
    pause !== null &&
    pauseSecondsLeft > 0 &&
    (pause.scope === 'network' || pause.email === email.trim().toLowerCase());

  useEffect(() => {
    let active = true;
    fetch('/api/auth/status')
      .then((res) => res.json())
      .then((body: { hasUsers?: boolean; setupTokenRequired?: boolean }) => {
        if (!active) return;
        const exists = Boolean(body.hasUsers);
        setHasUsers(exists);
        setSetupTokenRequired(Boolean(body.setupTokenRequired));
        setMode(exists ? 'login' : 'setup');
      })
      .catch(() => {
        if (active) setHasUsers(true);
      });

    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPaused) return;
    setErrorMsg(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErrorMsg(
        isAr ? 'يرجى إدخال بريد إلكتروني صحيح' : 'Please enter a valid email address.'
      );
      return;
    }

    if (!password) {
      setErrorMsg(isAr ? 'يرجى إدخال كلمة المرور' : 'Please enter your password.');
      return;
    }

    if (mode === 'setup') {
      // The length rule applies to new passwords only: accounts created before
      // R1.9 may still sign in with a shorter one.
      if (password.length < PASSWORD_MIN_LENGTH) {
        setErrorMsg(
          isAr
            ? `يجب أن تتكون كلمة المرور من ${PASSWORD_MIN_LENGTH} أحرف على الأقل`
            : `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
        );
        return;
      }
      if (setupTokenRequired && !setupToken.trim()) {
        setErrorMsg(isAr ? 'يرجى إدخال رمز الإعداد' : 'Please enter the setup token.');
        return;
      }
      if (fullName.trim().length < 2) {
        setErrorMsg(
          isAr ? 'يرجى إدخال الاسم الكامل' : 'Please enter your full name.'
        );
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg(
          isAr
            ? 'كلمة المرور وتأكيد كلمة المرور غير متطابقتين'
            : 'Passwords do not match.'
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      const endpoint = mode === 'setup' ? '/api/auth/register' : '/api/auth/login';
      const payload =
        mode === 'setup'
          ? { full_name: fullName.trim(), email: cleanEmail, password, setup_token: setupToken.trim() }
          : { email: cleanEmail, password };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        token?: string;
        user?: AuthUser;
        attemptsLeft?: number;
        retryAfterSeconds?: number;
      };

      if (!res.ok || !body.token || !body.user) {
        if (res.status === 429) {
          // LOGIN_LOCKED (this email) or RATE_LIMITED (this network): show a countdown.
          const seconds = Math.max(1, Number(body.retryAfterSeconds) || 60);
          const current = Date.now();
          setNow(current);
          setPause({
            until: current + seconds * 1000,
            scope: body.code === 'LOGIN_LOCKED' ? 'account' : 'network',
            email: cleanEmail,
          });
          setErrorMsg(null);
        } else if (body.code === 'REGISTRATION_CLOSED') {
          // Someone completed setup in the meantime — only sign-in remains.
          setHasUsers(true);
          setMode('login');
          setErrorMsg(
            isAr
              ? 'تم إعداد النظام مسبقاً. سجّل الدخول، أو اطلب من مدير النظام إنشاء حسابك.'
              : 'The system is already set up. Sign in, or ask an administrator to create your account.'
          );
        } else if (body.code === 'INVALID_SETUP_TOKEN') {
          setErrorMsg(isAr ? 'رمز الإعداد غير صحيح' : 'The setup token is incorrect.');
        } else if (res.status === 401) {
          const left = typeof body.attemptsLeft === 'number' ? body.attemptsLeft : null;
          setErrorMsg(
            isAr
              ? `البريد الإلكتروني أو كلمة المرور غير صحيحة${
                  left !== null ? `. المحاولات المتبقية قبل الإيقاف المؤقت: ${left}` : ''
                }`
              : `Invalid email or password.${
                  left !== null ? ` Attempts left before a temporary pause: ${left}` : ''
                }`
          );
        } else {
          setErrorMsg(
            body.error ||
              (isAr ? 'تعذر إتمام الطلب، حاول مرة أخرى' : 'Authentication failed.')
          );
        }
        return;
      }

      if (typeof window !== 'undefined') {
        window.history.replaceState({}, '', '/');
      }
      onAuthSuccess(body.token, body.user);
    } catch {
      setErrorMsg(
        isAr ? 'تعذر الاتصال بالخادم، حاول مرة أخرى' : 'Unable to reach server.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Top Bar */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
            {t.brand}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleLang}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <Globe className="w-3.5 h-3.5" />
              {t.langToggle}
            </button>
            <button
              type="button"
              onClick={onToggleDarkMode}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              {darkMode ? t.themeLight : t.themeDark}
            </button>
          </div>
        </div>
      </header>

      {/* Main Centered Auth Container */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-7 space-y-6">
          {/* Heading & Mode Switch */}
          <div className="space-y-4">
            <div className="space-y-1 text-center">
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                {mode === 'login'
                  ? isAr
                    ? 'تسجيل الدخول إلى ميزان POS'
                    : 'Sign in to Mizan POS'
                  : isAr
                  ? 'إعداد النظام — إنشاء حساب المدير'
                  : 'System setup — create the administrator'}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {mode === 'login'
                  ? isAr
                    ? 'أدخل بيانات حسابك للوصول إلى نقطة البيع والمخزون والمشتريات'
                    : 'Enter your credentials to access POS, inventory, and purchases'
                  : isAr
                  ? 'خطوة لمرة واحدة لإنشاء أول حساب مدير للنظام'
                  : 'A one-time step to create the first administrator account'}
              </p>
            </div>
          </div>

          {/* First-time setup info */}
          {hasUsers === false && mode === 'setup' && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-300 leading-relaxed">
              {isAr
                ? 'لا يوجد أي مستخدم بعد. هذا الحساب سيكون مدير النظام، وبعد إنشائه يُغلق التسجيل ويُنشئ المدير حسابات الموظفين من شاشة المستخدمين والصلاحيات.'
                : 'No users exist yet. This account becomes the system administrator; afterwards registration closes and the administrator creates staff accounts from Users & Permissions.'}
            </div>
          )}

          {/* Temporary sign-in pause (R1.9) */}
          {isPaused && pause && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs font-medium text-amber-800 dark:text-amber-300 leading-relaxed"
            >
              {pause.scope === 'account'
                ? isAr
                  ? `تم إيقاف تسجيل الدخول لهذا الحساب مؤقتاً بسبب محاولات خاطئة متكررة. حاول بعد ${formatCountdown(pauseSecondsLeft)} دقيقة، أو اطلب من مدير النظام تعيين كلمة مرور جديدة.`
                  : `Sign-in for this account is paused after repeated wrong passwords. Try again in ${formatCountdown(pauseSecondsLeft)}, or ask an administrator to set a new password.`
                : isAr
                ? `محاولات دخول فاشلة كثيرة من هذه الشبكة. حاول بعد ${formatCountdown(pauseSecondsLeft)} دقيقة.`
                : `Too many failed sign-in attempts from this network. Try again in ${formatCountdown(pauseSecondsLeft)}.`}
            </div>
          )}

          {/* Error Alert */}
          {errorMsg && !isPaused && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs font-medium text-red-700 dark:text-red-300"
            >
              {errorMsg}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'setup' && setupTokenRequired && (
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {isAr ? 'رمز الإعداد' : 'Setup Token'}
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
                  <input
                    required
                    type="password"
                    dir="ltr"
                    autoComplete="off"
                    value={setupToken}
                    onChange={(e) => setSetupToken(e.target.value)}
                    className="w-full ps-9 pe-3 py-2.5 text-sm font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-700"
                  />
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {isAr
                    ? 'القيمة المضبوطة في متغير البيئة SETUP_TOKEN على الخادم'
                    : 'The value configured in the SETUP_TOKEN environment variable on the server'}
                </p>
              </div>
            )}

            {mode === 'setup' && (
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {isAr ? 'الاسم الكامل' : 'Full Name'}
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
                  <input
                    required
                    type="text"
                    autoComplete="name"
                    placeholder={isAr ? 'مثال: محمد العتيبي' : 'e.g. Mohammed Al-Otaibi'}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full ps-9 pe-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-700"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="auth-email"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {isAr ? 'البريد الإلكتروني' : 'Email Address'}
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
                <input
                  id="auth-email"
                  required
                  type="email"
                  dir="ltr"
                  autoComplete="email"
                  placeholder="name@store.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full ps-9 pe-3 py-2.5 text-sm font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-700"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="auth-password"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {isAr ? 'كلمة المرور' : 'Password'}
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
                <input
                  id="auth-password"
                  required
                  type={showPassword ? 'text' : 'password'}
                  dir="ltr"
                  minLength={mode === 'setup' ? PASSWORD_MIN_LENGTH : undefined}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full ps-9 pe-10 py-2.5 text-sm font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-700"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute top-1/2 -translate-y-1/2 end-3 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {mode === 'setup' && (
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {isAr ? 'تأكيد كلمة المرور' : 'Confirm Password'}
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
                  <input
                    required
                    type={showPassword ? 'text' : 'password'}
                    dir="ltr"
                    minLength={PASSWORD_MIN_LENGTH}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full ps-9 pe-3 py-2.5 text-sm font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-700"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || isPaused}
              className="w-full py-3 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {isPaused
                ? isAr
                  ? `حاول بعد ${formatCountdown(pauseSecondsLeft)}`
                  : `Try again in ${formatCountdown(pauseSecondsLeft)}`
                : submitting
                ? isAr
                  ? 'جاري التحقق...'
                  : 'Please wait...'
                : mode === 'login'
                ? isAr
                  ? 'تسجيل الدخول'
                  : 'Sign In'
                : isAr
                ? 'إنشاء حساب المدير والدخول'
                : 'Create Administrator & Sign In'}
            </button>
          </form>

          {/* Footer note — no self-registration */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
            {mode === 'login'
              ? isAr
                ? 'ليس لديك حساب؟ يُنشئ مدير النظام حسابات الموظفين من شاشة المستخدمين والصلاحيات.'
                : "Don't have an account? The administrator creates staff accounts from Users & Permissions."
              : isAr
              ? 'بعد إنشاء حساب المدير يُغلق التسجيل تلقائياً.'
              : 'Registration closes automatically once the administrator account exists.'}
          </div>
        </div>
      </main>
    </div>
  );
}
