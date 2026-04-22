/**
 * @CLAUDE_CONTEXT
 * Package : apps/dashboard
 * File    : src/pages/Orders/ResiModal.tsx
 * Role    : Modal for entering shipping resi number + courier. PUTs to /orders/:id/resi.
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { Modal } from '../../components/Modal';

interface Order { id: string; orderCode: string; product?: { name: string }; }

const COURIERS = [
  { code: 'jne', name: 'JNE' },
  { code: 'jnt', name: 'J&T Express' },
  { code: 'sicepat', name: 'SiCepat' },
  { code: 'pos', name: 'Pos Indonesia' },
  { code: 'anteraja', name: 'AnterAja' },
  { code: 'tiki', name: 'TIKI' },
  { code: 'ninja', name: 'Ninja Express' },
];

interface Props { order: Order | null; open: boolean; onClose: () => void; onSaved: () => void; }

export function ResiModal({ order, open, onClose, onSaved }: Props) {
  const [resi, setResi] = useState('');
  const [courier, setCourier] = useState('jne');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!resi.trim()) { setError('Resi number is required.'); return; }
    if (!order) return;
    setLoading(true); setError('');
    try {
      await api.put(`/orders/${order.id}/resi`, { resi_number: resi.trim(), courier_code: courier });
      setResi(''); setCourier('jne');
      onSaved(); onClose();
    } catch { setError('Failed to save. Please try again.'); }
    finally { setLoading(false); }
  }

  const inp = 'w-full bg-[#0F172A] border border-[#334155] rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-sm';

  return (
    <Modal open={open} onClose={onClose} title="Enter Shipping Number">
      {order && (
        <div className="mb-4 bg-[#0F172A] rounded-lg px-3 py-2">
          <p className="text-xs text-slate-400">Order</p>
          <p className="text-white font-mono text-sm">{order.orderCode}</p>
          {order.product && <p className="text-slate-400 text-xs mt-0.5">{order.product.name}</p>}
        </div>
      )}
      <div className="space-y-3">
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Courier</label>
          <select value={courier} onChange={e => setCourier(e.target.value)} className={inp}>
            {COURIERS.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Resi / Tracking Number</label>
          <input
            type="text"
            value={resi}
            onChange={e => setResi(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="1234567890123456"
            className={`${inp} font-mono`}
          />
        </div>
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
          <button onClick={submit} disabled={loading} className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-50">
            {loading ? 'Saving...' : 'Save & Notify Buyer'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
