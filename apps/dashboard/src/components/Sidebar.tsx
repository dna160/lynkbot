import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '@/hooks/useAuth';
import { usePendingOrdersCount, useEscalatedConversationsCount, useLowStockCount } from '@/hooks/useOverview';

function NavIcon({ d }: { d: string }) {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={d} />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={clsx('w-3.5 h-3.5 text-secondary/40 transition-transform duration-150', open && 'rotate-180')}
      fill="none" viewBox="0 0 24 24" stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

interface NavGroup {
  label: string;
  icon: React.ReactNode;
  items: NavItem[];
}

function NavGroupSection({ group, defaultOpen = true }: { group: NavGroup; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const location = useLocation();
  const isAnyChildActive = group.items.some(item =>
    item.to === '/dashboard' ? location.pathname === '/dashboard' : location.pathname.startsWith(item.to)
  );

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className={clsx(
          'w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors',
          isAnyChildActive ? 'text-accent/80' : 'text-secondary/50 hover:text-secondary/80'
        )}
      >
        <div className="flex items-center gap-2">
          {group.icon}
          {group.label}
        </div>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="mt-0.5 ml-2 space-y-0.5">
          {group.items.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/dashboard'}
              className={({ isActive }) =>
                clsx(
                  'flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all',
                  isActive
                    ? 'bg-accent/15 text-accent'
                    : 'text-secondary hover:text-primary hover:bg-white/5'
                )
              }
            >
              <div className="flex items-center gap-2.5">
                {item.icon}
                {item.label}
              </div>
              {item.badge ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-600/30 text-red-400 font-semibold min-w-[1.25rem] text-center">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              ) : null}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function StandaloneNavLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/dashboard'}
      className={({ isActive }) =>
        clsx(
          'flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all',
          isActive
            ? 'bg-accent/15 text-accent'
            : 'text-secondary hover:text-primary hover:bg-white/5'
        )
      }
    >
      <div className="flex items-center gap-2.5">
        {item.icon}
        {item.label}
      </div>
      {item.badge ? (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-600/30 text-red-400 font-semibold min-w-[1.25rem] text-center">
          {item.badge > 99 ? '99+' : item.badge}
        </span>
      ) : null}
    </NavLink>
  );
}

export function Sidebar() {
  const { tenant, logout } = useAuth();
  const { data: pendingOrders } = usePendingOrdersCount();
  const { data: escalatedConvos } = useEscalatedConversationsCount();
  const { data: lowStock } = useLowStockCount();

  const isAdmin = () => {
    const token = localStorage.getItem('lynkbot_token');
    if (!token) return false;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.role === 'admin' || payload.role === 'admin_impersonate';
    } catch {
      return false;
    }
  };

  const groups: NavGroup[] = [
    {
      label: 'Store',
      icon: <NavIcon d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />,
      items: [
        {
          to: '/dashboard/orders',
          label: 'Orders',
          icon: <NavIcon d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
          badge: pendingOrders?.count,
        },
        {
          to: '/dashboard/products',
          label: 'Products',
          icon: <NavIcon d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />,
          badge: lowStock?.count,
        },
        {
          to: '/dashboard/analytics',
          label: 'Analytics',
          icon: <NavIcon d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
        },
        {
          to: '/dashboard/buyers',
          label: 'Buyers',
          icon: <NavIcon d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />,
        },
      ],
    },
    {
      label: 'Chat',
      icon: <NavIcon d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />,
      items: [
        {
          to: '/dashboard/conversations',
          label: 'Conversations',
          icon: <NavIcon d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />,
          badge: escalatedConvos?.count,
        },
        {
          to: '/dashboard/templates',
          label: 'Templates',
          icon: <NavIcon d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />,
        },
        {
          to: '/dashboard/playbooks',
          label: 'AI Playbooks',
          icon: <NavIcon d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />,
        },
        {
          to: '/dashboard/automations',
          label: 'Automations',
          icon: <NavIcon d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />,
        },
      ],
    },
    {
      label: 'Services',
      icon: <NavIcon d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />,
      items: [
        {
          to: '/dashboard/appointments',
          label: 'Appointments',
          icon: <NavIcon d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />,
        },
        {
          to: '/dashboard/staff',
          label: 'Staff',
          icon: <NavIcon d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />,
        },
        {
          to: '/dashboard/services',
          label: 'Services',
          icon: <NavIcon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />,
        },
        {
          to: '/dashboard/compliance',
          label: 'Compliance',
          icon: <NavIcon d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />,
        },
        {
          to: '/dashboard/scheduling/setup',
          label: 'Scheduling Setup',
          icon: <NavIcon d="M12 6v6m0 0v6m0-6h6m-6 0H6" />,
        },
      ],
    },
  ];

  return (
    <aside className="fixed left-0 top-0 h-screen w-56 bg-surface border-r border-border flex flex-col z-40">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-base font-bold text-primary">LynkBot</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
        {/* Dashboard — standalone */}
        <StandaloneNavLink item={{
          to: '/dashboard',
          label: 'Dashboard',
          icon: <NavIcon d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />,
        }} />

        <div className="pt-1 space-y-1">
          {groups.map(group => (
            <NavGroupSection key={group.label} group={group} />
          ))}
        </div>

        {/* Settings group */}
        <div className="pt-1">
          <NavGroupSection defaultOpen={false} group={{
            label: 'Settings',
            icon: <NavIcon d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />,
            items: [
              {
                to: '/dashboard/settings',
                label: 'WhatsApp',
                icon: <NavIcon d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
              },
              {
                to: '/dashboard/settings/persona',
                label: 'Bot Persona',
                icon: <NavIcon d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />,
              },
            ],
          }} />
        </div>

        {/* Admin — only for admin users */}
        {isAdmin() && (
          <StandaloneNavLink item={{
            to: '/dashboard/admin',
            label: 'Admin',
            icon: <NavIcon d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />,
          }} />
        )}
      </nav>

      {/* Footer */}
      <div className="px-2 py-3 border-t border-border space-y-1 shrink-0">
        {tenant && (
          <div className="px-3 py-1.5">
            <div className="text-[10px] text-secondary/40 uppercase tracking-wider">Workspace</div>
            <div className="text-xs font-medium text-secondary truncate mt-0.5">
              {tenant.storeName || 'My Store'}
            </div>
          </div>
        )}
        <button
          onClick={logout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-secondary hover:text-red-400 hover:bg-red-900/20 transition-all"
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Logout
        </button>
      </div>
    </aside>
  );
}
