/**
 * @CLAUDE_CONTEXT
 * Package : apps/dashboard
 * File    : src/pages/Appointments/AppointmentsPage.tsx
 * Role    : Appointments list view — filterable table with status management.
 *           Shows all appointments for the tenant with ability to confirm/cancel.
 *           Links to AppointmentsCalendarPage for the calendar view.
 * Exports : AppointmentsPage
 * DO NOT  : Import from apps/api or packages/db directly
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '@/components/ToastProvider';
import {
  useAppointments,
  useUpdateAppointmentStatus,
  type AppointmentStatus,
  type AppointmentFilters,
} from '@/hooks/useScheduling';

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  negotiating: 'Negotiating',
  pending_doctor: 'Pending Confirmation',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
};

const STATUS_COLORS: Record<AppointmentStatus, string> = {
  negotiating: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  pending_doctor: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  confirmed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  cancelled: 'bg-red-500/10 text-red-400 border-red-500/20',
};

function formatWIB(utcIso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(utcIso)) + ' WIB';
}

export function AppointmentsPage() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | ''>('');
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; action: 'confirmed' | 'cancelled' } | null>(null);

  const filters: AppointmentFilters = statusFilter ? { status: statusFilter } : {};
  const { data: appointments = [], isLoading } = useAppointments(filters);
  const updateStatus = useUpdateAppointmentStatus();

  async function handleStatusChange() {
    if (!confirmTarget) return;
    try {
      await updateStatus.mutateAsync({ id: confirmTarget.id, status: confirmTarget.action });
      toast({ type: 'success', message: confirmTarget.action === 'confirmed' ? 'Appointment confirmed' : 'Appointment cancelled' });
    } catch {
      toast({ type: 'error', message: 'Failed to update status' });
    } finally {
      setConfirmTarget(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Appointments</h1>
          <p className="text-slate-400 text-sm mt-0.5">Manage all consultation schedules</p>
        </div>
        <Link
          to="/dashboard/appointments/calendar"
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Calendar
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {(['', 'negotiating', 'pending_doctor', 'confirmed', 'cancelled'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              statusFilter === s
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
            }`}
          >
            {s === '' ? 'All' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-[#1E293B] border border-[#334155] rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Loading...</div>
        ) : appointments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center">
              <svg className="w-6 h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-slate-400 text-sm">No appointments yet</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#334155]">
                {['Time', 'Service', 'Staff', 'Buyer', 'Status', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#334155]">
              {appointments.map((appt) => (
                <tr key={appt.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <div className="text-sm text-white">{formatWIB(appt.startTime)}</div>
                    <div className="text-xs text-slate-500">→ {formatWIB(appt.endTime)}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-300">{appt.serviceName ?? appt.serviceId.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-sm text-slate-300">{appt.staffName ?? appt.staffId.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-sm text-slate-300">{appt.buyerName ?? appt.buyerPhone ?? appt.buyerId.slice(0, 8)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[appt.status]}`}>
                      {STATUS_LABELS[appt.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {(appt.status === 'pending_doctor' || appt.status === 'negotiating') && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setConfirmTarget({ id: appt.id, action: 'confirmed' })}
                          className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 rounded text-xs font-medium transition-colors border border-emerald-600/30"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmTarget({ id: appt.id, action: 'cancelled' })}
                          className="px-2.5 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded text-xs font-medium transition-colors border border-red-600/30"
                        >
                          Decline
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Confirm Dialog */}
      {confirmTarget && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setConfirmTarget(null)}>
          <div className="bg-[#1E293B] border border-[#334155] rounded-xl p-6 w-full max-w-sm space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white font-semibold">
              {confirmTarget.action === 'confirmed' ? 'Confirm Appointment?' : 'Cancel Appointment?'}
            </h3>
            <p className="text-slate-400 text-sm">
              {confirmTarget.action === 'confirmed'
                ? 'The buyer will be notified that the appointment has been confirmed.'
                : 'The buyer will be notified that the appointment has been cancelled.'}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmTarget(null)}
                className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-white/5"
              >
                Back
              </button>
              <button
                onClick={handleStatusChange}
                disabled={updateStatus.isPending}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
                  confirmTarget.action === 'confirmed'
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : 'bg-red-600 hover:bg-red-500 text-white'
                }`}
              >
                {updateStatus.isPending ? 'Processing...' : confirmTarget.action === 'confirmed' ? 'Yes, Confirm' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
