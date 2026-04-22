/**
 * @CLAUDE_CONTEXT
 * Package : apps/dashboard
 * File    : src/App.tsx
 * Role    : Root router. Protected routes redirect to /login when no token.
 * Exports : default App
 */
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/Login/LoginPage';
import { OnboardingPage } from './pages/Onboarding/OnboardingPage';
import { ProductsPage } from './pages/Products/ProductsPage';
import { OrdersPage } from './pages/Orders/OrdersPage';
import { ConversationsPage } from './pages/Conversations/ConversationsPage';
import { AnalyticsPage } from './pages/Analytics/AnalyticsPage';
import { BuyersPage } from './pages/Buyers/BuyersPage';

function isAuthenticated(): boolean {
  return !!localStorage.getItem('lynkbot_token');
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
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
  );
}
