import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login, loginPending } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await login({ email, password });
      navigate('/dashboard');
    } catch (err: unknown) {
      const axiosMsg =
        (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data?.error ??
        (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data?.message;
      setError(axiosMsg ?? (err instanceof Error ? err.message : 'Login failed'));
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-2xl font-bold text-primary">LynkBot</span>
          </div>
          <p className="text-secondary text-sm">WhatsApp AI Commerce Automation</p>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-8 shadow-2xl">
          <h1 className="text-xl font-semibold text-primary mb-6">Sign in to your store</h1>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-secondary mb-1.5" htmlFor="email">Lynk User ID / Email</label>
              <input id="email" type="text" autoComplete="username" required value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="your-lynk-user-id"
                className="w-full bg-bg border border-border rounded-lg px-4 py-2.5 text-sm text-primary placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition" />
            </div>
            <div>
              <label className="block text-sm font-medium text-secondary mb-1.5" htmlFor="password">Password</label>
              <input id="password" type="password" autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="(not required in dev)"
                className="w-full bg-bg border border-border rounded-lg px-4 py-2.5 text-sm text-primary placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition" />
            </div>
            {error && <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">{error}</div>}
            <button type="submit" disabled={loginPending}
              className="w-full bg-accent hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg transition-colors">
              {loginPending ? <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>Signing in…
              </span> : 'Sign in'}
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-secondary mt-6">&copy; {new Date().getFullYear()} LynkBot. All rights reserved.</p>
      </div>
    </div>
  );
}
