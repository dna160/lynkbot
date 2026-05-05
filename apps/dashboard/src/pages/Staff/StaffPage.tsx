/**
 * @CLAUDE_CONTEXT
 * Package : apps/dashboard
 * File    : src/pages/Staff/StaffPage.tsx
 * Role    : Staff management page — CRUD for staff members and their weekly
 *           availability schedules. Uses modal forms inline.
 * Exports : StaffPage
 * DO NOT  : Import from apps/api or packages/db directly
 */
import { useState } from 'react';
import { useToast } from '@/components/ToastProvider';
import {
  useStaff,
  useCreateStaff,
  useUpdateStaff,
  useSetAvailability,
  type StaffRow,
  type AvailabilitySlot,
} from '@/hooks/useScheduling';

const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

// ── Availability Editor ───────────────────────────────────────────────────────

function AvailabilityEditor({
  staffId,
  staffName,
  initial,
  onClose,
}: {
  staffId: string;
  staffName: string;
  initial: AvailabilitySlot[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const setAvailability = useSetAvailability();

  // Build a slot-per-day structure (one slot per day max for simplicity)
  const [slots, setSlots] = useState<(AvailabilitySlot | null)[]>(
    Array.from({ length: 7 }, (_, i) => initial.find(s => s.dayOfWeek === i) ?? null),
  );

  function toggle(day: number) {
    setSlots(prev => {
      const next = [...prev];
      next[day] = next[day] ? null : { dayOfWeek: day, startTime: '09:00', endTime: '17:00' };
      return next;
    });
  }

  function updateTime(day: number, field: 'startTime' | 'endTime', value: string) {
    setSlots(prev => {
      const next = [...prev];
      if (next[day]) next[day] = { ...next[day]!, [field]: value };
      return next;
    });
  }

  async function save() {
    try {
      await setAvailability.mutateAsync({
        staffId,
        slots: slots.filter((s): s is AvailabilitySlot => s !== null),
      });
      toast({ type: 'success', message: `Jadwal ${staffName} disimpan` });
      onClose();
    } catch {
      toast({ type: 'error', message: 'Gagal menyimpan jadwal' });
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#1E293B] border border-[#334155] rounded-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#334155]">
          <h3 className="font-semibold text-white">Jadwal {staffName}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5 space-y-3">
          {DAYS.map((day, i) => (
            <div key={i} className="flex items-center gap-3">
              <button
                onClick={() => toggle(i)}
                className={`w-24 text-left px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  slots[i] ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-600/30' : 'bg-white/5 text-slate-500 border border-white/10'
                }`}
              >
                {day}
              </button>
              {slots[i] ? (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={slots[i]!.startTime}
                    onChange={e => updateTime(i, 'startTime', e.target.value)}
                    className="bg-[#0F172A] border border-[#334155] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <span className="text-slate-500 text-sm">–</span>
                  <input
                    type="time"
                    value={slots[i]!.endTime}
                    onChange={e => updateTime(i, 'endTime', e.target.value)}
                    className="bg-[#0F172A] border border-[#334155] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              ) : (
                <span className="text-slate-600 text-sm">Libur</span>
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-[#334155]">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-white/5">
            Batal
          </button>
          <button
            onClick={save}
            disabled={setAvailability.isPending}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {setAvailability.isPending ? 'Menyimpan...' : 'Simpan Jadwal'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Staff Form Modal ──────────────────────────────────────────────────────────

interface StaffFormState {
  name: string;
  phoneNumber: string;
  role: string;
  isActive: boolean;
}

function StaffModal({
  initial,
  onSubmit,
  onClose,
  isLoading,
  title,
}: {
  initial: StaffFormState;
  onSubmit: (data: StaffFormState) => void;
  onClose: () => void;
  isLoading: boolean;
  title: string;
}) {
  const [form, setForm] = useState<StaffFormState>(initial);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#1E293B] border border-[#334155] rounded-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#334155]">
          <h3 className="font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Nama *</label>
            <input
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="Dr. Sarah"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Nomor WhatsApp *</label>
            <input
              value={form.phoneNumber}
              onChange={e => setForm(p => ({ ...p, phoneNumber: e.target.value }))}
              className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="6281234567890"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Jabatan</label>
            <input
              value={form.role}
              onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
              className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="Dokter / Konsultan / dll"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setForm(p => ({ ...p, isActive: !p.isActive }))}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                form.isActive ? 'bg-indigo-600' : 'bg-white/10'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.isActive ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
            <span className="text-sm text-slate-300">Aktif</span>
          </div>
        </div>
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-[#334155]">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-white/5">
            Batal
          </button>
          <button
            onClick={() => onSubmit(form)}
            disabled={!form.name || !form.phoneNumber || isLoading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const EMPTY_FORM: StaffFormState = { name: '', phoneNumber: '', role: '', isActive: true };

export function StaffPage() {
  const { toast } = useToast();
  const { data: staffList = [], isLoading } = useStaff();
  const createStaff = useCreateStaff();
  const updateStaff = useUpdateStaff();

  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<StaffRow | null>(null);
  const [availTarget, setAvailTarget] = useState<StaffRow | null>(null);

  async function handleCreate(data: StaffFormState) {
    try {
      await createStaff.mutateAsync(data);
      toast({ type: 'success', message: 'Staf berhasil ditambahkan' });
      setShowCreate(false);
    } catch {
      toast({ type: 'error', message: 'Gagal menambahkan staf' });
    }
  }

  async function handleUpdate(data: StaffFormState) {
    if (!editTarget) return;
    try {
      await updateStaff.mutateAsync({ id: editTarget.id, ...data });
      toast({ type: 'success', message: 'Staf berhasil diperbarui' });
      setEditTarget(null);
    } catch {
      toast({ type: 'error', message: 'Gagal memperbarui staf' });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Manajemen Staf</h1>
          <p className="text-slate-400 text-sm mt-0.5">Tambah dan atur jadwal ketersediaan staf</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Tambah Staf
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-[#1E293B] border border-[#334155] rounded-xl p-4 animate-pulse">
              <div className="h-4 bg-white/10 rounded w-2/3 mb-3" />
              <div className="h-3 bg-white/5 rounded w-1/2" />
            </div>
          ))
        ) : staffList.length === 0 ? (
          <div className="col-span-3 flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center">
              <svg className="w-6 h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <p className="text-slate-400 text-sm">Belum ada staf. Tambahkan staf pertama kamu.</p>
          </div>
        ) : (
          staffList.map(s => (
            <div key={s.id} className="bg-[#1E293B] border border-[#334155] rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-indigo-600/20 flex items-center justify-center text-indigo-400 text-sm font-semibold">
                      {s.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{s.name}</p>
                      {s.role && <p className="text-xs text-slate-500">{s.role}</p>}
                    </div>
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                  s.isActive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-slate-500/10 text-slate-500 border-slate-500/20'
                }`}>
                  {s.isActive ? 'Aktif' : 'Nonaktif'}
                </span>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                {s.phoneNumber}
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setAvailTarget(s)}
                  className="flex-1 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg text-xs font-medium transition-colors border border-white/10"
                >
                  Atur Jadwal
                </button>
                <button
                  onClick={() => setEditTarget(s)}
                  className="flex-1 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg text-xs font-medium transition-colors border border-white/10"
                >
                  Edit
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {showCreate && (
        <StaffModal
          title="Tambah Staf Baru"
          initial={EMPTY_FORM}
          onSubmit={handleCreate}
          onClose={() => setShowCreate(false)}
          isLoading={createStaff.isPending}
        />
      )}

      {editTarget && (
        <StaffModal
          title={`Edit ${editTarget.name}`}
          initial={{ name: editTarget.name, phoneNumber: editTarget.phoneNumber, role: editTarget.role ?? '', isActive: editTarget.isActive }}
          onSubmit={handleUpdate}
          onClose={() => setEditTarget(null)}
          isLoading={updateStaff.isPending}
        />
      )}

      {availTarget && (
        <AvailabilityEditor
          staffId={availTarget.id}
          staffName={availTarget.name}
          initial={availTarget.availability ?? []}
          onClose={() => setAvailTarget(null)}
        />
      )}
    </div>
  );
}
