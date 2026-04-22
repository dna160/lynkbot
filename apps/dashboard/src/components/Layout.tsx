/*
 * @CLAUDE_CONTEXT
 * package: @lynkbot/dashboard
 * file: src/components/Layout.tsx
 * role: App shell — sidebar + scrollable main content area for authenticated pages
 * exports: Layout
 */
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function Layout() {
  return (
    <div className="min-h-screen bg-bg text-primary font-sans">
      <Sidebar />
      <main className="ml-60 min-h-screen">
        <div className="max-w-[1280px] mx-auto px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
