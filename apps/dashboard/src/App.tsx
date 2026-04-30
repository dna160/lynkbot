import { Routes, Route, Navigate } from 'react-router-dom';
import { Component, type ReactNode } from 'react';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/Login/LoginPage';
import { OnboardingPage } from './pages/Onboarding/OnboardingPage';
import { ProductsPage } from './pages/Products/ProductsPage';
import { OrdersPage } from './pages/Orders/OrdersPage';
import { ConversationsPage } from './pages/Conversations/ConversationsPage';
import { AnalyticsPage } from './pages/Analytics/AnalyticsPage';
import { BuyersPage } from './pages/Buyers/BuyersPage';
import { OverviewPage } from './pages/Overview/OverviewPage';
import { TemplateListPage } from './pages/Templates/TemplateListPage';
import { TemplateEditorPage } from './pages/Templates/TemplateEditorPage';
import { FlowsListPage } from './pages/Flows/FlowsListPage';
import { FlowEditorPage } from './pages/Flows/FlowEditorPage';
import { getTenantIdFromToken } from './lib/api';

interface EBState {
  crashed: boolean;
  error: string;
  stack: string;
  ts: string;
}

class ErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { crashed: false, error: '', stack: '', ts: '' };

  static getDerivedStateFromError(e: Error): EBState {
    return {
      crashed: true,
      error: e.message,
      stack: e.stack ?? '',
      ts: new Date().toISOString(),
    };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[LynkBot ErrorBoundary]', error, info);
  }

  render() {
    const { crashed, error, stack, ts } = this.state;
    if (!crashed) return this.props.children;

    const full = `Error: ${error}\n\nStack:\n${stack}\n\nCaptured at: ${ts}`;

    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-6 text-white">
        <div className="w-full max-w-2xl space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-600/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-red-400">Dashboard crashed</h1>
              <p className="text-slate-400 text-sm">An unhandled error was caught by the error boundary.</p>
            </div>
          </div>

          <div className="bg-red-950/40 border border-red-800/50 rounded-xl px-4 py-3">
            <p className="text-red-300 font-mono text-sm break-all">{error}</p>
          </div>

          <div className="bg-[#1E293B] border border-[#334155] rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#334155]">
              <span className="text-xs text-slate-400 font-mono">Stack trace · {ts}</span>
              <button
                onClick={() => navigator.clipboard?.writeText(full)}
                className="text-xs text-slate-400 hover:text-white transition-colors px-2 py-1 rounded bg-white/5 hover:bg-white/10"
              >Copy</button>
            </div>
            <pre className="px-4 py-3 text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-64 overflow-y-auto leading-relaxed">
              {stack || '(no stack available)'}
            </pre>
          </div>

          <div className="flex gap-3">
            <button onClick={() => this.setState({ crashed: false, error: '', stack: '', ts: '' })}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors">Try again</button>
            <button onClick={() => window.location.reload()}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium transition-colors">Reload page</button>
            <button onClick={() => { localStorage.removeItem('lynkbot_token'); window.location.href = '/login'; }}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium text-slate-400 transition-colors">Clear session &amp; login</button>
          </div>

          <p className="text-slate-500 text-xs">
            Check the browser console and{' '}
            <code className="bg-white/10 px-1 rounded">cat /tmp/lynkbot-api.log | tail -50</code>{' '}
            for API errors.
          </p>
        </div>
      </div>
    );
  }
}

function isAuthenticated(): boolean {
  return !!getTenantIdFromToken();
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/onboarding" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<OverviewPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="conversations" element={<ConversationsPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="buyers" element={<BuyersPage />} />
          <Route path="templates" element={<TemplateListPage />} />
          <Route path="templates/new" element={<TemplateEditorPage />} />
          <Route path="templates/:id/edit" element={<TemplateEditorPage />} />
          <Route path="flows" element={<FlowsListPage />} />
          <Route path="flows/new" element={<FlowEditorPage />} />
          <Route path="flows/:id/edit" element={<FlowEditorPage />} />
        </Route>
        <Route path="/" element={<Navigate to={isAuthenticated() ? '/dashboard' : '/login'} replace />} />
        <Route path="*" element={<Navigate to={isAuthenticated() ? '/dashboard' : '/login'} replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
