/**
 * @CLAUDE_CONTEXT
 * Package : apps/dashboard
 * File    : src/pages/Products/ProductsPage.tsx
 * Role    : Product list with inventory columns, edit modal, add form. Full CRUD.
 * Exports : ProductsPage
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, aiApi, type ProductCopy } from '../../lib/api';
import { Badge } from '../../components/Badge';
import { Modal } from '../../components/Modal';

interface Product {
  id: string; name: string; sku?: string; priceIdr: number; weightGrams: number;
  isActive: boolean; knowledgeStatus: 'pending' | 'processing' | 'ready' | 'failed';
  description?: string; coverImageUrl?: string; createdAt: string;
}
interface InventoryItem {
  productId: string; quantityAvailable: number; quantityReserved: number;
  quantitySold: number; lowStockThreshold: number;
}

const ksBadge: Record<Product['knowledgeStatus'], { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-slate-600 text-slate-200' },
  processing: { label: 'Processing', color: 'bg-yellow-600/30 text-yellow-300 animate-pulse' },
  ready: { label: 'Ready', color: 'bg-green-600/30 text-green-400' },
  failed: { label: 'Failed', color: 'bg-red-600/30 text-red-400' },
};

function fmtIdr(n: number) { return `Rp ${n.toLocaleString('id-ID')}`; }

function StockCell({ inv, threshold }: { inv?: InventoryItem; threshold?: number }) {
  if (!inv) return <span className="text-slate-500">—</span>;
  const avail = inv.quantityAvailable - inv.quantityReserved;
  const low = threshold ?? inv.lowStockThreshold;
  const color = avail === 0 ? 'text-red-400' : avail <= low * 2 ? 'text-yellow-400' : 'text-green-400';
  return <span className={`font-mono font-medium ${color}`}>{avail}</span>;
}

// ─── AI Generate Modal ────────────────────────────────────────────────────────

interface AiGenerateModalProps {
  product: Product;
  onApply: (copy: ProductCopy) => void;
  onClose: () => void;
}

function AiGenerateModal({ product, onApply, onClose }: AiGenerateModalProps) {
  const [brief, setBrief] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProductCopy | null>(null);
  const [error, setError] = useState('');

  async function generate() {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await aiApi.generateProductCopy({
        name: product.name,
        brief: brief || undefined,
        existingDescription: product.description || undefined,
        language: 'id',
      });
      setResult(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Generation failed');
    } finally {
      setLoading(false);
    }
  }

  const inp = 'w-full bg-[#0F172A] border border-[#334155] rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-sm';

  return (
    <Modal open onClose={onClose} title={`✨ AI Generate — ${product.name}`}>
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        {!result ? (
          <>
            <p className="text-sm text-slate-400">
              Grok will generate a full product description, tagline, FAQ, key outcomes, and a sales bot persona for this product.
            </p>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Brief / Additional context <span className="text-slate-600">(optional)</span></label>
              <textarea
                className={`${inp} resize-none`}
                rows={3}
                value={brief}
                onChange={e => setBrief(e.target.value)}
                placeholder="e.g. Buku digital panduan UMKM untuk pemula, cocok untuk ibu rumah tangga yang ingin mulai bisnis online..."
              />
            </div>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
              <button
                onClick={generate}
                disabled={loading}
                className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    Generating…
                  </>
                ) : '✨ Generate'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-3">
              <div className="bg-[#0F172A] rounded-lg p-3 border border-[#334155]">
                <div className="text-xs text-indigo-400 font-semibold mb-1 uppercase tracking-wider">Tagline</div>
                <div className="text-white text-sm">{result.tagline}</div>
              </div>
              <div className="bg-[#0F172A] rounded-lg p-3 border border-[#334155]">
                <div className="text-xs text-indigo-400 font-semibold mb-1 uppercase tracking-wider">Description</div>
                <div className="text-slate-300 text-sm whitespace-pre-wrap">{result.description}</div>
              </div>
              <div className="bg-[#0F172A] rounded-lg p-3 border border-[#334155]">
                <div className="text-xs text-indigo-400 font-semibold mb-1 uppercase tracking-wider">Key Outcomes</div>
                <ul className="space-y-1">
                  {result.keyOutcomes.map((o, i) => <li key={i} className="text-slate-300 text-sm">✓ {o}</li>)}
                </ul>
              </div>
              <div className="bg-[#0F172A] rounded-lg p-3 border border-[#334155]">
                <div className="text-xs text-indigo-400 font-semibold mb-1 uppercase tracking-wider">FAQ ({result.faqPairs.length})</div>
                <div className="space-y-2">
                  {result.faqPairs.map((p, i) => (
                    <div key={i}>
                      <div className="text-white text-xs font-medium">Q: {p.q}</div>
                      <div className="text-slate-400 text-xs mt-0.5">A: {p.a}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-[#0F172A] rounded-lg p-3 border border-[#334155]">
                <div className="text-xs text-indigo-400 font-semibold mb-1 uppercase tracking-wider">AI Sales Persona</div>
                <div className="text-slate-300 text-xs whitespace-pre-wrap">{result.bookPersonaPrompt}</div>
              </div>
              {result._meta && (
                <div className="text-xs text-slate-600 text-right">
                  {result._meta.modelId} · {result._meta.tokensUsed} tokens · {result._meta.latencyMs}ms
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-[#334155] sticky bottom-0 bg-[#1E293B] pb-1">
              <button onClick={() => setResult(null)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Regenerate</button>
              <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Discard</button>
              <button
                onClick={() => { onApply(result); onClose(); }}
                className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg"
              >
                Apply to Product
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ─── Add Product Modal ────────────────────────────────────────────────────────

function AddProductModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', sku: '', priceIdr: '', weightGrams: '', description: '', quantity: '0' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function submit() {
    if (!form.name.trim() || !form.priceIdr || !form.weightGrams) { setError('Name, price, and weight required.'); return; }
    setLoading(true); setError('');
    try {
      const p = await api.post<Product>('/products', {
        name: form.name.trim(), sku: form.sku || undefined,
        priceIdr: parseInt(form.priceIdr), weightGrams: parseInt(form.weightGrams),
        description: form.description || undefined,
      });
      if (parseInt(form.quantity) > 0) {
        await api.patch(`/inventory/${p.data.id}`, { quantityAvailable: parseInt(form.quantity) });
      }
      onSaved(); onClose();
    } catch { setError('Failed to create product.'); }
    finally { setLoading(false); }
  }

  const inp = 'w-full bg-[#0F172A] border border-[#334155] rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-sm';

  return (
    <Modal open={open} onClose={onClose} title="Add Product">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-slate-400 mb-1 block">Name *</label><input className={inp} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Product name" /></div>
          <div><label className="text-xs text-slate-400 mb-1 block">SKU</label><input className={inp} value={form.sku} onChange={e => set('sku', e.target.value)} placeholder="SKU-001" /></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="text-xs text-slate-400 mb-1 block">Price (IDR) *</label><input type="number" className={inp} value={form.priceIdr} onChange={e => set('priceIdr', e.target.value)} placeholder="150000" /></div>
          <div><label className="text-xs text-slate-400 mb-1 block">Weight (g) *</label><input type="number" className={inp} value={form.weightGrams} onChange={e => set('weightGrams', e.target.value)} placeholder="300" /></div>
          <div><label className="text-xs text-slate-400 mb-1 block">Initial Stock</label><input type="number" className={inp} value={form.quantity} onChange={e => set('quantity', e.target.value)} placeholder="0" /></div>
        </div>
        <div><label className="text-xs text-slate-400 mb-1 block">Description</label><textarea className={`${inp} resize-none`} rows={3} value={form.description} onChange={e => set('description', e.target.value)} placeholder="What makes this product special..." /></div>
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
          <button onClick={submit} disabled={loading} className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-50">
            {loading ? 'Creating...' : 'Create Product'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EditProductModal({ product, inv, open, onClose, onSaved }: {
  product: Product; inv?: InventoryItem; open: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: product.name, sku: product.sku ?? '', priceIdr: String(product.priceIdr),
    weightGrams: String(product.weightGrams), description: product.description ?? '',
  });
  const [invForm, setInvForm] = useState({
    quantityAvailable: String(inv?.quantityAvailable ?? 0),
    lowStockThreshold: String(inv?.lowStockThreshold ?? 10),
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }
  function setI(k: string, v: string) { setInvForm(f => ({ ...f, [k]: v })); }

  async function submit() {
    setLoading(true); setError('');
    try {
      await Promise.all([
        api.patch(`/products/${product.id}`, {
          name: form.name.trim(), sku: form.sku || undefined,
          priceIdr: parseInt(form.priceIdr), weightGrams: parseInt(form.weightGrams),
          description: form.description || undefined,
        }),
        api.patch(`/inventory/${product.id}`, {
          quantityAvailable: parseInt(invForm.quantityAvailable),
          lowStockThreshold: parseInt(invForm.lowStockThreshold),
        }),
      ]);
      onSaved(); onClose();
    } catch { setError('Failed to save changes.'); }
    finally { setLoading(false); }
  }

  const inp = 'w-full bg-[#0F172A] border border-[#334155] rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-sm';

  return (
    <Modal open={open} onClose={onClose} title={`Edit: ${product.name}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-slate-400 mb-1 block">Name</label><input className={inp} value={form.name} onChange={e => set('name', e.target.value)} /></div>
          <div><label className="text-xs text-slate-400 mb-1 block">SKU</label><input className={inp} value={form.sku} onChange={e => set('sku', e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-slate-400 mb-1 block">Price (IDR)</label><input type="number" className={inp} value={form.priceIdr} onChange={e => set('priceIdr', e.target.value)} /></div>
          <div><label className="text-xs text-slate-400 mb-1 block">Weight (g)</label><input type="number" className={inp} value={form.weightGrams} onChange={e => set('weightGrams', e.target.value)} /></div>
        </div>
        <div><label className="text-xs text-slate-400 mb-1 block">Description</label><textarea className={`${inp} resize-none`} rows={3} value={form.description} onChange={e => set('description', e.target.value)} /></div>

        <div className="border-t border-[#334155] pt-4">
          <p className="text-xs text-slate-400 mb-3 font-semibold uppercase tracking-wider">Inventory</p>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="text-xs text-slate-400 mb-1 block">Available</label><input type="number" className={inp} value={invForm.quantityAvailable} onChange={e => setI('quantityAvailable', e.target.value)} /></div>
            <div><label className="text-xs text-slate-400 mb-1 block">Reserved</label><input type="number" className={`${inp} opacity-50 cursor-not-allowed`} value={inv?.quantityReserved ?? 0} readOnly /></div>
            <div><label className="text-xs text-slate-400 mb-1 block">Low Stock Alert</label><input type="number" className={inp} value={invForm.lowStockThreshold} onChange={e => setI('lowStockThreshold', e.target.value)} /></div>
          </div>
        </div>

        {error && <p className="text-red-400 text-xs">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
          <button onClick={submit} disabled={loading} className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-50">
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function ProductsPage() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [aiProduct, setAiProduct] = useState<Product | null>(null);

  const { data: products = [], isLoading: pLoading } = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: () => api.get('/products').then(r => r.data),
  });

  const { data: inventory = [] } = useQuery<InventoryItem[]>({
    queryKey: ['inventory'],
    queryFn: () => api.get('/inventory').then(r => r.data),
  });

  const invMap = Object.fromEntries(inventory.map(i => [i.productId, i]));

  const toggleActive = useMutation({
    mutationFn: (p: Product) => api.patch(`/products/${p.id}`, { isActive: !p.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });

  const deleteProduct = useMutation({
    mutationFn: (id: string) => api.delete(`/products/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });

  function refetch() { qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['inventory'] }); }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Products</h1>
          <p className="text-slate-400 text-sm mt-1">{products.length} product{products.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setAddOpen(true)} className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
          + Add Product
        </button>
      </div>

      {pLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-[#1E293B] rounded-lg animate-pulse" />)}
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <p className="text-4xl mb-3">📦</p>
          <p>No products yet. Add your first product to get started.</p>
        </div>
      ) : (
        <div className="bg-[#1E293B] border border-[#334155] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#334155] text-slate-400 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-left">Product</th>
                <th className="px-4 py-3 text-left">SKU</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-right">Stock</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">AI Knowledge</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => {
                const inv = invMap[p.id];
                const ks = ksBadge[p.knowledgeStatus];
                return (
                  <tr key={p.id} className="border-b border-[#334155]/50 hover:bg-[#334155]/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{p.name}</div>
                      {p.description && <div className="text-slate-500 text-xs truncate max-w-xs">{p.description}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{p.sku ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{fmtIdr(p.priceIdr)}</td>
                    <td className="px-4 py-3 text-right"><StockCell inv={inv} /></td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => toggleActive.mutate(p)} className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${p.isActive ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30' : 'bg-slate-600/20 text-slate-400 hover:bg-slate-600/30'}`}>
                        {p.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${ks.color}`}>{ks.label}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setAiProduct(p)} className="text-xs text-indigo-400 hover:text-indigo-300 px-2 py-1 rounded" title="Generate AI copy">✨ AI</button>
                        <button onClick={() => setEditProduct(p)} className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded">Edit</button>
                        <button onClick={() => { if (confirm(`Delete "${p.name}"?`)) deleteProduct.mutate(p.id); }} className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded">Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AddProductModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={refetch} />
      {editProduct && (
        <EditProductModal
          product={editProduct}
          inv={invMap[editProduct.id]}
          open={!!editProduct}
          onClose={() => setEditProduct(null)}
          onSaved={refetch}
        />
      )}
      {aiProduct && (
        <AiGenerateModal
          product={aiProduct}
          onClose={() => setAiProduct(null)}
          onApply={async (copy) => {
            await api.patch(`/products/${aiProduct.id}`, {
              description: copy.description,
              tagline: copy.tagline,
              keyOutcomes: copy.keyOutcomes,
              problemsSolved: copy.problemsSolved,
              faqPairs: copy.faqPairs,
              bookPersonaPrompt: copy.bookPersonaPrompt,
            });
            refetch();
          }}
        />
      )}
    </div>
  );
}
