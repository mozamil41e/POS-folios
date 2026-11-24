import { useEffect, useState } from 'react';
import { Eye, EyeOff, Globe, KeyRound, Lock, Mail, Moon, Sun, User } from 'lucide-react';
import type { AuthUser, Language } from '../types';
import { translations } from '../i18n';

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
    setErrorMsg(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErrorMsg(
        isAr ? 'يرجى إدخال بريد إلكتروني صحيح' : 'Please enter a valid email address.'
      );
      return;
    }

    if (password.length < 6) {
      setErrorMsg(
        isAr
          ? 'يجب أن تتكون كلمة المرور من 6 أحرف على الأقل'
          : 'Password must be at least 6 characters.'
      );
      return;
    }

    if (mode === 'setup') {
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
      };

      if (!res.ok || !body.token || !body.user) {
        if (body.code === 'REGISTRATION_CLOSED') {
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
          setErrorMsg(
            isAr
              ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
              : 'Invalid email or password.'
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

          {/* Error Alert */}
          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs font-medium text-red-700 dark:text-red-300">
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
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {isAr ? 'البريد الإلكتروني' : 'Email Address'}
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
                <input
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
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {isAr ? 'كلمة المرور' : 'Password'}
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
                <input
                  required
                  type={showPassword ? 'text' : 'password'}
                  dir="ltr"
                  minLength={6}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  placeholder="••••••"
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
                    minLength={6}
                    autoComplete="new-password"
                    placeholder="••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full ps-9 pe-3 py-2.5 text-sm font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-700"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {submitting
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
