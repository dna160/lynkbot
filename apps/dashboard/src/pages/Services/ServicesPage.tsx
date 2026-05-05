/**
 * @CLAUDE_CONTEXT
 * Package : apps/dashboard
 * File    : src/pages/Services/ServicesPage.tsx
 * Role    : Services management page — create and configure bookable services.
 *           Each service has a name, duration, and assigned staff members.
 * Exports : ServicesPage
 * DO NOT  : Import from apps/api or packages/db directly
 */
import { useState } from 'react';
import { useToast } from '@/components/ToastProvider';
import {
  useServices,
  useCreateService,
  useUpdateService,
  useStaff,
  type ServiceRow,
} from '@/hooks/useScheduling';

// ── Service Form Modal ────────────────────────────────────────────────────────

interface ServiceFormState {
  name: string;
  durationMinutes: number;
  staffIds: string[];
  isActive: boolean;
}

function ServiceModal({
  title,
  initial,
  onSubmit,
  onClose,
  isLoading,
}: {
  title: string;
  initial: ServiceFormState;
  onSubmit: (data: ServiceFormState) => void;
  onClose: () => void;
  isLoading: boolean;
}) {
  const { data: staffList = [] } = useStaff();
  const [form, setForm] = useState<ServiceFormState>(initial);

  function toggleStaff(id: string) {
    setForm(p => ({
      ...p,
      staffIds: p.staffIds.includes(id) ? p.staffIds.filter(s => s !== id) : [...p.staffIds, id],
    }));
  }

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
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Nama Layanan *</label>
            <input
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="Konsultasi Awal"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Durasi (menit) *</label>
            <input
              type="number"
              min={5}
              max={480}
              value={form.durationMinutes}
              onChange={e => setForm(p => ({ ...p, durationMinutes: parseInt(e.target.value, 10) || 60 }))}
              className="w-full bg-[#0F172A] border border-[#334155] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">Staf yang Menangani</label>
            {staffList.length === 0 ? (
              <p className="text-xs text-slate-500">Belum ada staf. Tambahkan staf di halaman Staf terlebih dahulu.</p>
            ) : (
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {staffList.filter(s => s.isActive).map(s => (
                  <label key={s.id} className="flex items-center gap-3 cursor-pointer group">
                    <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                      form.staffIds.includes(s.id) ? 'bg-indigo-600 border-indigo-600' : 'border-[#334155] bg-[#0F172A] group-hover:border-indigo-500'
                    }`}
                      onClick={() => toggleStaff(s.id)}
                    >
                      {form.staffIds.includes(s.id) && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <div className="text-sm text-slate-300 select-none" onClick={() => toggleStaff(s.id)}>
                      {s.name}
                      {s.role && <span className="text-slate-500 ml-1">· {s.role}</span>}
                    </div>
                  </label>
                ))}
              </div>
            )}
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
            disabled={!form.name || isLoading}
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

const EMPTY_FORM: ServiceFormState = { name: '', durationMinutes: 60, staffIds: [], isActive: true };

export function ServicesPage() {
  const { toast } = useToast();
  const { data: services = [], isLoading } = useServices();
  const createService = useCreateService();
  const updateService = useUpdateService();

  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<ServiceRow | null>(null);

  async function handleCreate(data: ServiceFormState) {
    try {
      await createService.mutateAsync(data);
      toast({ type: 'success', message: 'Layanan berhasil ditambahkan' });
      setShowCreate(false);
    } catch {
      toast({ type: 'error', message: 'Gagal menambahkan layanan' });
    }
  }

  async function handleUpdate(data: ServiceFormState) {
    if (!editTarget) return;
    try {
      await updateService.mutateAsync({ id: editTarget.id, ...data });
      toast({ type: 'success', message: 'Layanan berhasil diperbarui' });
      setEditTarget(null);
    } catch {
      toast({ type: 'error', message: 'Gagal memperbarui layanan' });
    }
  }

  function formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m} menit`;
    if (m === 0) return `${h} jam`;
    return `${h} jam ${m} menit`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Layanan</h1>
          <p className="text-slate-400 text-sm mt-0.5">Buat dan atur layanan yang bisa dibooking</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Tambah Layanan
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-[#1E293B] border border-[#334155] rounded-xl p-4 animate-pulse">
              <div className="h-4 bg-white/10 rounded w-2/3 mb-3" />
              <div className="h-3 bg-white/5 rounded w-1/3" />
            </div>
          ))
        ) : services.length === 0 ? (
          <div className="col-span-3 flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center">
              <svg className="w-6 h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-slate-400 text-sm">Belum ada layanan. Buat layanan pertama kamu.</p>
          </div>
        ) : (
          services.map(svc => (
            <div key={svc.id} className="bg-[#1E293B] border border-[#334155] rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-white">{svc.name}</h3>
                <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium border ${
                  svc.isActive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-slate-500/10 text-slate-500 border-slate-500/20'
                }`}>
                  {svc.isActive ? 'Aktif' : 'Nonaktif'}
                </span>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {formatDuration(svc.durationMinutes)}
              </div>

              {svc.staff && svc.staff.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {svc.staff.map(s => (
                    <span key={s.id} className="px-2 py-0.5 bg-indigo-600/10 text-indigo-400 rounded-full text-xs border border-indigo-600/20">
                      {s.name}
                    </span>
                  ))}
                </div>
              )}

              <button
                onClick={() => setEditTarget(svc)}
                className="w-full px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg text-xs font-medium transition-colors border border-white/10 mt-1"
              >
                Edit Layanan
              </button>
            </div>
          ))
        )}
      </div>

      {showCreate && (
        <ServiceModal
          title="Tambah Layanan Baru"
          initial={EMPTY_FORM}
          onSubmit={handleCreate}
          onClose={() => setShowCreate(false)}
          isLoading={createService.isPending}
        />
      )}

      {editTarget && (
        <ServiceModal
          title={`Edit ${editTarget.name}`}
          initial={{
            name: editTarget.name,
            durationMinutes: editTarget.durationMinutes,
            staffIds: editTarget.staff?.map(s => s.id) ?? [],
            isActive: editTarget.isActive,
          }}
          onSubmit={handleUpdate}
          onClose={() => setEditTarget(null)}
          isLoading={updateService.isPending}
        />
      )}
    </div>
  );
}
