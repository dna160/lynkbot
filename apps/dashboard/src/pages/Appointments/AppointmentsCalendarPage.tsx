/**
 * @CLAUDE_CONTEXT
 * Package : apps/dashboard
 * File    : src/pages/Appointments/AppointmentsCalendarPage.tsx
 * Role    : Calendar view of appointments using react-big-calendar.
 *           Uses date-fns localizer. Shows appointments colour-coded by status.
 *           Allows navigating between month/week/day views.
 * Exports : AppointmentsCalendarPage
 * DO NOT  : Import from apps/api or packages/db directly
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, dateFnsLocalizer, type View } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { useAppointments, type AppointmentRow } from '@/hooks/useScheduling';

// ── date-fns localizer (Indonesian locale) ────────────────────────────────────
const locales = { 'id': idLocale };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }), // Monday start
  getDay,
  locales,
});

// ── Colour mapping ────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  negotiating:   '#EAB308',
  pending_doctor: '#3B82F6',
  confirmed:     '#10B981',
  cancelled:     '#EF4444',
};

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: AppointmentRow;
}

export function AppointmentsCalendarPage() {
  const [view, setView] = useState<View>('week');
  const [date, setDate] = useState(new Date());

  const { data: appointments = [], isLoading } = useAppointments();

  // Convert appointments to react-big-calendar events
  const events = useMemo<CalendarEvent[]>(() =>
    appointments
      .filter(a => a.status !== 'cancelled')
      .map(a => ({
        id: a.id,
        title: `${a.serviceName ?? 'Layanan'} — ${a.staffName ?? 'Staf'}`,
        start: new Date(a.startTime),
        end: new Date(a.endTime),
        resource: a,
      })),
    [appointments],
  );

  // Custom event style based on status
  function eventPropGetter(event: CalendarEvent) {
    const color = STATUS_COLORS[event.resource.status] ?? '#6366F1';
    return {
      style: {
        backgroundColor: color + '22',
        borderLeft: `3px solid ${color}`,
        color: '#F1F5F9',
        borderRadius: '4px',
        fontSize: '11px',
        padding: '2px 4px',
      },
    };
  }

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-white">Kalender Appointment</h1>
          <p className="text-slate-400 text-sm mt-0.5">Lihat jadwal dalam tampilan kalender</p>
        </div>
        <Link
          to="/dashboard/appointments"
          className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg text-sm font-medium transition-colors border border-white/10"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
          Tampilan List
        </Link>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 flex-shrink-0">
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          status !== 'cancelled' && (
            <div key={status} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
              <span className="text-xs text-slate-400">
                {status === 'negotiating' ? 'Negosiasi' : status === 'pending_doctor' ? 'Menunggu' : 'Dikonfirmasi'}
              </span>
            </div>
          )
        ))}
      </div>

      {/* Calendar wrapper — override RBC dark styles */}
      <div className="flex-1 min-h-0 bg-[#1E293B] rounded-xl border border-[#334155] overflow-hidden p-4" style={{ minHeight: '600px' }}>
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">Memuat...</div>
        ) : (
          <style>{`
            .rbc-calendar { background: transparent; color: #CBD5E1; font-family: inherit; height: 100%; }
            .rbc-header { background: #0F172A; border-color: #334155; padding: 8px 4px; font-size: 12px; color: #94A3B8; font-weight: 500; }
            .rbc-toolbar { margin-bottom: 16px; }
            .rbc-toolbar button { color: #CBD5E1; background: #0F172A; border: 1px solid #334155; border-radius: 6px; padding: 4px 12px; font-size: 13px; transition: all .15s; }
            .rbc-toolbar button:hover { background: #1E293B; color: white; }
            .rbc-toolbar button.rbc-active { background: #4F46E5; border-color: #4F46E5; color: white; }
            .rbc-toolbar-label { font-size: 15px; font-weight: 600; color: white; }
            .rbc-month-view, .rbc-time-view, .rbc-agenda-view { border-color: #334155; }
            .rbc-day-bg + .rbc-day-bg, .rbc-month-row + .rbc-month-row { border-color: #334155; }
            .rbc-off-range-bg { background: #0F172A55; }
            .rbc-today { background: #4F46E511; }
            .rbc-time-content, .rbc-time-header-content { border-color: #334155; }
            .rbc-timeslot-group { border-color: #334155; }
            .rbc-time-slot { border-color: #1E293B; }
            .rbc-time-gutter .rbc-label { color: #64748B; font-size: 11px; }
            .rbc-current-time-indicator { background: #6366F1; }
            .rbc-event { cursor: pointer; }
            .rbc-event:focus { outline: 2px solid #6366F1; }
            .rbc-selected { box-shadow: 0 0 0 2px #6366F1; }
            .rbc-show-more { color: #6366F1; font-size: 11px; }
          `}</style>
        )}
        <Calendar
          localizer={localizer}
          events={events}
          view={view}
          onView={setView}
          date={date}
          onNavigate={setDate}
          eventPropGetter={eventPropGetter}
          tooltipAccessor={(e: CalendarEvent) =>
            `${e.resource.serviceName ?? 'Layanan'}\nStaf: ${e.resource.staffName ?? '—'}\nBuyer: ${e.resource.buyerName ?? e.resource.buyerPhone ?? '—'}\nStatus: ${e.resource.status}`
          }
          culture="id"
          messages={{
            today: 'Hari ini',
            previous: '‹',
            next: '›',
            month: 'Bulan',
            week: 'Minggu',
            day: 'Hari',
            agenda: 'Agenda',
            noEventsInRange: 'Tidak ada appointment di rentang ini',
          }}
          style={{ height: '100%' }}
        />
      </div>
    </div>
  );
}
