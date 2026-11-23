import { useEffect, useState } from 'react';
import {
  Eye,
  EyeOff,
  Globe,
  Lock,
  LogIn,
  Mail,
  Moon,
  Sun,
  User,
  UserPlus,
} from 'lucide-react';
import type { AuthUser, Language } from '../types';
import { translations } from '../i18n';

interface AuthViewProps {
  lang: Language;
  darkMode: boolean;
  onToggleLang: () => void;
  onToggleDarkMode: () => void;
  onAuthSuccess: (token: string, user: AuthUser) => void;
}

type AuthMode = 'login' | 'register';

export function AuthView({
  lang,
  darkMode,
  onToggleLang,
  onToggleDarkMode,
  onAuthSuccess,
}: AuthViewProps) {
  const t = translations[lang];
  const isAr = lang === 'ar';

  const initialModeFromPath: AuthMode =
    typeof window !== 'undefined' && window.location.pathname === '/register'
      ? 'register'
      : 'login';

  const [mode, setMode] = useState<AuthMode>(initialModeFromPath);
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
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
      .then((body: { hasUsers?: boolean }) => {
        if (!active) return;
        const exists = Boolean(body.hasUsers);
        setHasUsers(exists);
        if (!exists) {
          setMode('register');
        }
      })
      .catch(() => {
        if (active) setHasUsers(true);
      });

    return () => {
      active = false;
    };
  }, []);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setErrorMsg(null);
    if (typeof window !== 'undefined') {
      const targetPath = nextMode === 'register' ? '/register' : '/login';
      if (window.location.pathname !== targetPath) {
        window.history.replaceState({}, '', targetPath);
      }
    }
  };

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

    if (mode === 'register') {
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
      const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const payload =
        mode === 'register'
          ? { full_name: fullName.trim(), email: cleanEmail, password }
          : { email: cleanEmail, password };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        token?: string;
        user?: AuthUser;
      };

      if (!res.ok || !body.token || !body.user) {
        if (res.status === 409) {
          setErrorMsg(
            isAr
              ? 'هذا البريد الإلكتروني مسجل مسبقاً، يمكنك تسجيل الدخول'
              : 'An account with this email already exists.'
          );
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
                  ? 'إنشاء حساب جديد'
                  : 'Create an Account'}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {mode === 'login'
                  ? isAr
                    ? 'أدخل بيانات حسابك للوصول إلى نقطة البيع والمخزون والمشتريات'
                    : 'Enter your credentials to access POS, inventory, and purchases'
                  : isAr
                  ? 'أنشئ حساباً جديداً للبدء في إدارة المبيعات والمخزون'
                  : 'Register your account to start managing sales and inventory'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-xl border border-slate-200/70 dark:border-slate-800">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={`py-2 px-3 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
                  mode === 'login'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <LogIn className="w-3.5 h-3.5" />
                {isAr ? 'تسجيل الدخول' : 'Sign In'}
              </button>
              <button
                type="button"
                onClick={() => switchMode('register')}
                className={`py-2 px-3 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
                  mode === 'register'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5" />
                {isAr ? 'تسجيل جديد' : 'Register'}
              </button>
            </div>
          </div>

          {/* First-time setup info */}
          {hasUsers === false && mode === 'register' && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-300 leading-relaxed">
              {isAr
                ? 'مرحباً بك! لم يتم تسجيل أي مستخدم بعد — أول حساب يتم إنشاؤه سيحصل تلقائياً على صلاحيات مدير النظام.'
                : 'Welcome! No users exist yet — the first registered account will be assigned Administrator privileges.'}
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
            {mode === 'register' && (
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

            {mode === 'register' && (
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
                ? 'إنشاء الحساب والدخول'
                : 'Create Account'}
            </button>
          </form>

          {/* Footer Switch Link */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
            {mode === 'login' ? (
              <span>
                {isAr ? 'ليس لديك حساب؟ ' : "Don't have an account? "}
                <button
                  type="button"
                  onClick={() => switchMode('register')}
                  className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                >
                  {isAr ? 'سجل حساباً جديداً' : 'Create one'}
                </button>
              </span>
            ) : (
              <span>
                {isAr ? 'لديك حساب بالفعل؟ ' : 'Already have an account? '}
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                >
                  {isAr ? 'تسجيل الدخول' : 'Sign in'}
                </button>
              </span>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
