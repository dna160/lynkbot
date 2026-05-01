/**
 * Full-bleed layout for canvas-style editor pages (Flow Editor, etc).
 * Unlike Layout.tsx, there is no max-width, padding, or scroll wrapper —
 * the Outlet fills exactly the remaining viewport after the sidebar.
 */
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function CanvasLayout() {
  return (
    <div className="h-screen overflow-hidden bg-bg text-primary font-sans flex">
      <Sidebar />
      <main className="ml-60 flex-1 overflow-hidden h-full">
        <Outlet />
      </main>
    </div>
  );
}
