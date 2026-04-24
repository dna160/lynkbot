/**
 * @CLAUDE_CONTEXT
 * Package : apps/dashboard
 * File    : src/App.tsx
 * Role    : Root router. Protected routes redirect to /login when no token.
 * Exports : default App
 */
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

class ErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean; error: string }> {
  state = { crashed: false, error: '' };
  static getDerivedStateFromError(e: Error) { return { crashed: true, error: e.message }; }
  render() {
    if (this.state.crashed) return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center text-white">
        <div className="text-center space-y-4">
          <p className="text-red-400 text-lg font-semibold">Something went wrong</p>
          <p className="text-slate-400 text-sm">{this.state.error}</p>
          <button onClick={() => { this.setState({ crashed: false }); window.location.reload(); }}
            className="px-4 py-2 bg-blue-600 rounded-lg text-sm hover:bg-blue-500">
            Reload
          </button>
        </div>
      </div>
    );
    return this.props.children;
  }
}

function isAuthenticated(): boolean {
  return !!localStorage.getItem('lynkbot_token');
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
      <Route path="/onboarding" element={
        <ProtectedRoute><OnboardingPage /></ProtectedRoute>
      } />
      <Route path="/dashboard" element={
        <ProtectedRoute><Layout /></ProtectedRoute>
      }>
        <Route index element={<Navigate to="orders" replace />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="conversations" element={<ConversationsPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="buyers" element={<BuyersPage />} />
      </Route>
      <Route path="/" element={<Navigate to={isAuthenticated() ? '/dashboard' : '/login'} replace />} />
    </Routes>
    </ErrorBoundary>
  );
}
