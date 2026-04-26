import { useState, Fragment } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { ResiModal } from './ResiModal';
import { SearchInput } from '../../components/SearchInput';
import { useToast } from '../../components/ToastProvider';

type OrderStatus = 'pending_payment' | 'paid' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';

interface Order {
  id: string; orderCode: string; status: OrderStatus; totalAmountIdr: number;
  shippingCostIdr: number; resiNumber?: string; courierCode?: string; createdAt: string;
  buyer?: { waPhone: string; displayName?: string };
  product?: { name: string };
}

interface OrdersResponse { items: Order[]; total: number; }

const STATUS_TABS: { key: OrderStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending_payment', label: 'Pending Payment' },
  { key: 'paid', label: 'Paid' },
  { key: 'processing', label: 'Processing' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
];

const STATUS_STYLE: Record<OrderStatus, string> = {
  pending_payment: 'bg-yellow-600/20 text-yellow-400',
  paid: 'bg-blue-600/20 text-blue-400',
  processing: 'bg-purple-600/20 text-purple-400',
  shipped: 'bg-indigo-600/20 text-indigo-400',
  delivered: 'bg-green-600/20 text-green-400',
  cancelled: 'bg-red-600/20 text-red-400',
  refunded: 'bg-slate-600/20 text-slate-400',
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: 'Pending Payment', paid: 'Paid', processing: 'Processing', shipped: 'Shipped',
  delivered: 'Delivered', cancelled: 'Cancelled', refunded: 'Refunded',
};

function fmtIdr(n: number) { return `Rp ${n.toLocaleString('id-ID')}`; }
function fmtDate(s: string) { return new Date(s).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }); }

const PAGE_SIZE = 20;

export function OrdersPage() {
  const qc = useQueryClient();
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<OrderStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resiOrder, setResiOrder] = useState<Order | null>(null);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery<OrdersResponse>({
    queryKey: ['orders', activeTab, page],
    queryFn: () => api.get('/orders', {
      params: { ...(activeTab !== 'all' ? { status: activeTab } : {}), page, limit: PAGE_SIZE },
    }).then(r => r.data),
  });

  const allOrders = data?.items ?? [];
  const totalAll = data?.total ?? 0;
  const orders = search.trim() ? allOrders.filter(o =>
    o.orderCode.toLowerCase().includes(search.toLowerCase()) ||
    o.buyer?.displayName?.toLowerCase().includes(search.toLowerCase()) ||
    o.buyer?.waPhone?.toLowerCase().includes(search.toLowerCase()) ||
    o.product?.name?.toLowerCase().includes(search.toLowerCase())
  ) : allOrders;
  const total = search.trim() ? orders.length : totalAll;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  function handleTabChange(tab: OrderStatus | 'all') { setActiveTab(tab); setPage(1); }
  function toggleExpand(id: string) { setExpanded(e => e === id ? null : id); }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Orders</h1>
          <p className="text-slate-400 text-sm mt-1">{totalAll} order{totalAll !== 1 ? 's' : ''} total</p>
        </div>
        <SearchInput placeholder="Search by order code, buyer, or product..." value={search} onChange={setSearch} className="w-72" />
      </div>

      <div className="flex gap-1 mb-6 bg-[#1E293B] border border-[#334155] rounded-lg p-1 overflow-x-auto">
        {STATUS_TABS.map(tab => (
          <button key={tab.key} onClick={() => handleTabChange(tab.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${activeTab === tab.key ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? <div className="space-y-2">{[...Array(8)].map((_, i) => <div key={i} className="h-14 bg-[#1E293B] rounded-lg animate-pulse" />)}</div> : orders.length === 0 ? (
        <div className="text-center py-20 text-slate-500"><p className="text-4xl mb-3">🛒</p><p>No orders found{activeTab !== 'all' ? ` with status "${activeTab}"` : ''}.</p></div>
      ) : (
        <div className="bg-[#1E293B] border border-[#334155] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#334155] text-slate-400 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-left">Order</th>
                <th className="px-4 py-3 text-left">Buyer</th>
                <th className="px-4 py-3 text-left">Product</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(order => (
                <Fragment key={order.id}>
                  <tr className="border-b border-[#334155]/50 hover:bg-[#334155]/20 cursor-pointer transition-colors" onClick={() => toggleExpand(order.id)}>
                    <td className="px-4 py-3 font-mono text-xs text-indigo-400">{order.orderCode}</td>
                    <td className="px-4 py-3 text-slate-300">{order.buyer?.displayName || order.buyer?.waPhone || '—'}</td>
                    <td className="px-4 py-3 text-slate-300 max-w-[200px] truncate">{order.product?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-white font-medium">{fmtIdr(order.totalAmountIdr)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_STYLE[order.status]}`}>{STATUS_LABEL[order.status]}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{fmtDate(order.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {(order.status === 'paid' || order.status === 'processing') && !order.resiNumber && (
                        <button onClick={e => { e.stopPropagation(); setResiOrder(order); }}
                          className="text-xs bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30 px-2.5 py-1 rounded transition-colors">+ Resi</button>
                      )}
                      {order.resiNumber && <span className="text-xs text-slate-400 font-mono">{order.resiNumber}</span>}
                    </td>
                  </tr>
                  {expanded === order.id && (
                    <tr key={`${order.id}-detail`} className="bg-[#0F172A]/50">
                      <td colSpan={7} className="px-6 py-4">
                        <div className="grid grid-cols-3 gap-6 text-xs">
                          <div>
                            <p className="text-slate-500 mb-1 uppercase tracking-wider">Buyer</p>
                            <p className="text-white">{order.buyer?.displayName || 'Unknown'}</p>
                            <p className="text-slate-400">{order.buyer?.waPhone}</p>
                          </div>
                          <div>
                            <p className="text-slate-500 mb-1 uppercase tracking-wider">Shipping</p>
                            <p className="text-white">{order.courierCode?.toUpperCase() ?? '—'}</p>
                            <p className="text-slate-400">{fmtIdr(order.shippingCostIdr)}</p>
                            {order.resiNumber && <p className="text-indigo-400 font-mono mt-1">{order.resiNumber}</p>}
                          </div>
                          <div>
                            <p className="text-slate-500 mb-1 uppercase tracking-wider">Payment</p>
                            <p className="text-white">{fmtIdr(order.totalAmountIdr)}</p>
                            <p className="text-slate-400 mt-1">{fmtDate(order.createdAt)}</p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-slate-400">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 bg-[#1E293B] border border-[#334155] text-slate-300 rounded-lg disabled:opacity-40 hover:bg-[#334155] transition-colors">← Prev</button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-3 py-1.5 bg-[#1E293B] border border-[#334155] text-slate-300 rounded-lg disabled:opacity-40 hover:bg-[#334155] transition-colors">Next →</button>
          </div>
        </div>
      )}

      <ResiModal order={resiOrder} open={!!resiOrder} onClose={() => setResiOrder(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['orders'] }); addToast('Tracking number updated', 'success'); }} />
    </div>
  );
}
