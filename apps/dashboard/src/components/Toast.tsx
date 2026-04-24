/*
 * package: @lynkbot/dashboard
 * file: src/components/Toast.tsx
 * role: Individual toast notification item
 * exports: Toast
 */
import { useEffect } from 'react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastProps {
  toast: ToastItem;
  onRemove: (id: string) => void;
}

const typeStyles: Record<ToastType, string> = {
  success: 'bg-green-900/80 border-green-700 text-green-100',
  error: 'bg-red-900/80 border-red-700 text-red-100',
  info: 'bg-indigo-900/80 border-indigo-700 text-indigo-100',
};

const iconMap: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
};

export function Toast({ toast, onRemove }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), 4000);
    return () => clearTimeout(timer);
  }, [toast.id, onRemove]);

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-sm transform transition-all duration-300 animate-in slide-in-from-right ${typeStyles[toast.type]}`}
      role="alert"
    >
      <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-white/10 text-sm">
        {iconMap[toast.type]}
      </span>
      <span className="text-sm font-medium">{toast.message}</span>
      <button
        onClick={() => onRemove(toast.id)}
        className="ml-2 text-white/60 hover:text-white transition-colors"
        aria-label="Dismiss"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
