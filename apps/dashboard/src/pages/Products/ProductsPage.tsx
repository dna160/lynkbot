import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, aiApi, productsApi, type ProductCopy } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { SearchInput } from '../../components/SearchInput';
import { useToast } from '../../components/ToastProvider';

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

// ─── Knowledge Upload Modal ──────────────────────────────────────────────────

type UploadStep = 'idle' | 'signing' | 'uploading' | 'ingesting' | 'done' | 'error';

function KnowledgeUploadModal({ product, onClose, onDone }: {
  product: Product; onClose: () => void; onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<UploadStep>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  const alreadyHasKnowledge = product.knowledgeStatus === 'ready' || product.knowledgeStatus === 'processing';

  async function handleUpload() {
    if (!file) return;
    setStep('signing'); setError('');
    try {
      // 1. Get presigned URL
      const { data: { uploadUrl } } = await productsApi.getUploadUrl(product.id, 'pdf');

      // 2. Upload to S3
      setStep('uploading'); setProgress(0);
      await productsApi.uploadToS3(uploadUrl, file, setProgress);

      // 3. Trigger ingest
      setStep('ingesting');
      await productsApi.triggerIngest(product.id);

      setStep('done');
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? 'Upload failed');
      setStep('error');
    }
  }

  const stepLabel: Record<UploadStep, string> = {
    idle: '', signing: 'Getting upload URL…', uploading: `Uploading PDF… ${progress}%`,
    ingesting: 'AI is processing…', done: 'Done!', error: '',
  };

  return (
    <Modal open onClose={step === 'uploading' || step === 'ingesting' ? undefined : onClose}
      title={`📄 Upload Knowledge — ${product.name}`}>
      <div className="space-y-4">
        {/* Current status */}
        <div className="flex items-center gap-3 bg-[#0F172A] rounded-lg px-4 py-3 border border-[#334155]">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
            product.knowledgeStatus === 'ready' ? 'bg-green-400' :
            product.knowledgeStatus === 'processing' ? 'bg-yellow-400 animate-pulse' :
            product.knowledgeStatus === 'failed' ? 'bg-red-400' : 'bg-slate-500'
          }`} />
          <div>
            <p className="text-xs text-slate-400">Current AI knowledge status</p>
            <p className="text-sm text-white font-medium capitalize">{product.knowledgeStatus}</p>
          </div>
          {alreadyHasKnowledge && (
            <span className="ml-auto text-xs text-slate-500 italic">Uploading a new file will replace existing knowledge</span>
          )}
        </div>

        {step === 'done' ? (
          <div className="text-center py-6">
            <div className="text-4xl mb-3">🎉</div>
            <p className="text-white font-semibold mb-1">Upload complete!</p>
            <p className="text-slate-400 text-sm">The AI is now processing your PDF. Knowledge status will update to <span className="text-yellow-400">Processing</span> then <span className="text-green-400">Ready</span> in a few minutes.</p>
            <button onClick={onClose} className="mt-5 px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg">Close</button>
          </div>
        ) : (
          <>
            <div>
              <label className="text-xs text-slate-400 mb-2 block font-medium">Product knowledge PDF</label>
              <div
                onClick={() => fileRef.current?.click()}
                className={`relative border-2 border-dashed rounded-xl px-6 py-8 text-center cursor-pointer transition-colors ${
                  file ? 'border-indigo-500 bg-indigo-600/10' : 'border-[#334155] hover:border-indigo-500/50 hover:bg-[#334155]/20'
                }`}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); }}
                  disabled={step !== 'idle' && step !== 'error'}
                />
                {file ? (
                  <>
                    <div className="text-3xl mb-2">📄</div>
                    <p className="text-white font-medium text-sm">{file.name}</p>
                    <p className="text-slate-400 text-xs mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB · Click to change</p>
                  </>
                ) : (
                  <>
                    <div className="text-3xl mb-2">☁️</div>
                    <p className="text-slate-300 text-sm font-medium">Click to select PDF</p>
                    <p className="text-slate-500 text-xs mt-1">Upload your product book, manual, or sales guide · Max 5 MB</p>
                  </>
                )}
              </div>
            </div>

            {/* Progress bar */}
            {(step === 'uploading' || step === 'signing' || step === 'ingesting') && (
              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                  <span>{stepLabel[step]}</span>
                  {step === 'uploading' && <span>{progress}%</span>}
                </div>
                <div className="h-1.5 bg-[#0F172A] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 transition-all duration-300 rounded-full"
                    style={{ width: step === 'signing' ? '10%' : step === 'uploading' ? `${progress}%` : '100%' }}
                  />
                </div>
              </div>
            )}

            {error && (
              <p className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                disabled={step === 'uploading' || step === 'ingesting'}
                className="px-4 py-2 text-sm text-slate-400 hover:text-white disabled:opacity-40"
              >Cancel</button>
              <button
                onClick={handleUpload}
                disabled={!file || (step !== 'idle' && step !== 'error')}
                className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-40 flex items-center gap-2"
              >
                {step !== 'idle' && step !== 'error' ? (
                  <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>{stepLabel[step] || 'Working…'}</>
                ) : '📤 Upload & Train AI'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function AiGenerateModal({ product, onApply, onClose }: { product: Product; onApply: (copy: ProductCopy) => void; onClose: () => void }) {
  const [brief, setBrief] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProductCopy | null>(null);
  const [error, setError] = useState('');

  async function generate() {
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await aiApi.generateProductCopy({ name: product.name, brief: brief || undefined, existingDescription: product.description || undefined, language: 'id' });
      setResult(res.data);
    } catch (err: any) { setError(err?.response?.data?.error ?? 'Generation failed'); }
    finally { setLoading(false); }
  }

  const inp = 'w-full bg-[#0F172A] border border-[#334155] rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-sm';

  return (
    <Modal open onClose={onClose} title={`✨ AI Generate — ${product.name}`}>
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        {!result ? (
          <>
            <p className="text-sm text-slate-400">Grok will generate a full product description, tagline, FAQ, key outcomes, and a sales bot persona for this product.</p>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Brief / Additional context <span className="text-slate-600">(optional)</span></label>
              <textarea className={`${inp} resize-none`} rows={3} value={brief} onChange={e => setBrief(e.target.value)} placeholder="e.g. Buku digital panduan UMKM untuk pemula..." />
            </div>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
              <button onClick={generate} disabled={loading} className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-50 flex items-center gap-2">
                {loading ? <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Generating…</> : '✨ Generate'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-3">
              <div className="bg-[#0F172A] rounded-lg p-3 border border-[#334155]"><div className="text-xs text-indigo-400 font-semibold mb-1 uppercase tracking-wider">Tagline</div><div className="text-white text-sm">{result.tagline}</div></div>
              <div className="bg-[#0F172A] rounded-lg p-3 border border-[#334155]"><div className="text-xs text-indigo-400 font-semibold mb-1 uppercase tracking-wider">Description</div><div className="text-slate-300 text-sm whitespace-pre-wrap">{result.description}</div></div>
              <div className="bg-[#0F172A] rounded-lg p-3 border border-[#334155]"><div className="text-xs text-indigo-400 font-semibold mb-1 uppercase tracking-wider">Key Outcomes</div><ul className="space-y-1">{result.keyOutcomes.map((o, i) => <li key={i} className="text-slate-300 text-sm">✓ {o}</li>)}</ul></div>
              <div className="bg-[#0F172A] rounded-lg p-3 border border-[#334155]"><div className="text-xs text-indigo-400 font-semibold mb-1 uppercase tracking-wider">FAQ ({result.faqPairs.length})</div><div className="space-y-2">{result.faqPairs.map((p, i) => <div key={i}><div className="text-white text-xs font-medium">Q: {p.q}</div><div className="text-slate-400 text-xs mt-0.5">A: {p.a}</div></div>)}</div></div>
              <div className="bg-[#0F172A] rounded-lg p-3 border border-[#334155]"><div className="text-xs text-indigo-400 font-semibold mb-1 uppercase tracking-wider">AI Sales Persona</div><div className="text-slate-300 text-xs whitespace-pre-wrap">{result.bookPersonaPrompt}</div></div>
              {result._meta && <div className="text-xs text-slate-600 text-right">{result._meta.modelId} · {result._meta.tokensUsed} tokens · {result._meta.latencyMs}ms</div>}
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-[#334155] sticky bottom-0 bg-[#1E293B] pb-1">
              <button onClick={() => setResult(null)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Regenerate</button>
              <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Discard</button>
              <button onClick={() => { onApply(result); onClose(); }} className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg">Apply to Product</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function AddProductModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', sku: '', priceIdr: '', weightGrams: '', description: '', quantity: '0' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function submit() {
    if (!form.name.trim() || !form.priceIdr || !form.weightGrams) { setError('Name, price, and weight required.'); return; }
    setLoading(true); setError('');
    try {
      const p = await api.post<Product>('/products', { name: form.name.trim(), sku: form.sku || undefined, priceIdr: parseInt(form.priceIdr), weightGrams: parseInt(form.weightGrams), description: form.description || undefined });
      if (parseInt(form.quantity) > 0) await api.patch(`/inventory/${p.data.id}`, { quantityAvailable: parseInt(form.quantity) });
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
          <button onClick={submit} disabled={loading} className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-50">{loading ? 'Creating...' : 'Create Product'}</button>
        </div>
      </div>
    </Modal>
  );
}

function EditProductModal({ product, inv, open, onClose, onSaved }: { product: Product; inv?: InventoryItem; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: product.name, sku: product.sku ?? '', priceIdr: String(product.priceIdr), weightGrams: String(product.weightGrams), description: product.description ?? '' });
  const [invForm, setInvForm] = useState({ quantityAvailable: String(inv?.quantityAvailable ?? 0), lowStockThreshold: String(inv?.lowStockThreshold ?? 10) });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }
  function setI(k: string, v: string) { setInvForm(f => ({ ...f, [k]: v })); }

  async function submit() {
    setLoading(true); setError('');
    try {
      await Promise.all([
        api.patch(`/products/${product.id}`, { name: form.name.trim(), sku: form.sku || undefined, priceIdr: parseInt(form.priceIdr), weightGrams: parseInt(form.weightGrams), description: form.description || undefined }),
        api.patch(`/inventory/${product.id}`, { quantityAvailable: parseInt(invForm.quantityAvailable), lowStockThreshold: parseInt(invForm.lowStockThreshold) }),
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
          <button onClick={submit} disabled={loading} className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-50">{loading ? 'Saving...' : 'Save Changes'}</button>
        </div>
      </div>
    </Modal>
  );
}

type ProductFilter = 'all' | 'active' | 'inactive' | 'lowstock';
const FILTER_TABS: { key: ProductFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
  { key: 'lowstock', label: 'Low Stock' },
];

export function ProductsPage() {
  const qc = useQueryClient();
  const { addToast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [aiProduct, setAiProduct] = useState<Product | null>(null);
  const [uploadProduct, setUploadProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ProductFilter>('all');

  const { data: allProducts = [], isLoading: pLoading } = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: () => api.get('/products').then(r => r.data),
    // Auto-refresh every 5s when any product is processing so the badge updates live
    refetchInterval: (query) => {
      const data = query.state.data as Product[] | undefined;
      return data?.some(p => p.knowledgeStatus === 'processing') ? 5000 : false;
    },
  });
  const { data: inventory = [] } = useQuery<InventoryItem[]>({ queryKey: ['inventory'], queryFn: () => api.get('/inventory').then(r => r.data) });

  const invMap = Object.fromEntries(inventory.map(i => [i.productId, i]));
  const products = allProducts.filter(p => {
    const inv = invMap[p.id];
    const matchesSearch = !search.trim() || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku?.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === 'all' ? true : filter === 'active' ? p.isActive : filter === 'inactive' ? !p.isActive : filter === 'lowstock' ? (inv ? inv.quantityAvailable - inv.quantityReserved <= inv.lowStockThreshold : false) : true;
    return matchesSearch && matchesFilter;
  });

  const toggleActive = useMutation({
    mutationFn: (p: Product) => api.patch(`/products/${p.id}`, { isActive: !p.isActive }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); addToast('Product status updated', 'success'); },
  });

  const deleteProduct = useMutation({
    mutationFn: (id: string) => api.delete(`/products/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); addToast('Product deleted', 'success'); },
  });

  function refetch() { qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['inventory'] }); addToast('Product saved', 'success'); }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Products</h1>
          <p className="text-slate-400 text-sm mt-1">{allProducts.length} product{allProducts.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-3">
          <SearchInput placeholder="Search by name or SKU..." value={search} onChange={setSearch} className="w-64" />
          <button onClick={() => setAddOpen(true)} className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">+ Add Product</button>
        </div>
      </div>

      <div className="flex gap-1 mb-6 bg-surface border border-border rounded-lg p-1 overflow-x-auto">
        {FILTER_TABS.map(tab => (
          <button key={tab.key} onClick={() => setFilter(tab.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${filter === tab.key ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}>{tab.label}</button>
        ))}
      </div>

      {pLoading ? <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-[#1E293B] rounded-lg animate-pulse" />)}</div> : products.length === 0 ? (
        <div className="text-center py-20 text-slate-500"><p className="text-4xl mb-3">📦</p><p>No products yet. Add your first product to get started.</p></div>
      ) : (
        <div className="bg-[#1E293B] border border-[#334155] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#334155] text-slate-400 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-left">Product</th><th className="px-4 py-3 text-left">SKU</th><th className="px-4 py-3 text-right">Price</th><th className="px-4 py-3 text-right">Stock</th>
                <th className="px-4 py-3 text-center">Status</th><th className="px-4 py-3 text-center">AI Knowledge</th><th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => {
                const inv = invMap[p.id];
                const ks = ksBadge[p.knowledgeStatus];
                return (
                  <tr key={p.id} className="border-b border-[#334155]/50 hover:bg-[#334155]/20 transition-colors">
                    <td className="px-4 py-3"><div className="font-medium text-white">{p.name}</div>{p.description && <div className="text-slate-500 text-xs truncate max-w-xs">{p.description}</div>}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{p.sku ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{fmtIdr(p.priceIdr)}</td>
                    <td className="px-4 py-3 text-right"><StockCell inv={inv} /></td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => toggleActive.mutate(p)} className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${p.isActive ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30' : 'bg-slate-600/20 text-slate-400 hover:bg-slate-600/30'}`}>{p.isActive ? 'Active' : 'Inactive'}</button>
                    </td>
                    <td className="px-4 py-3 text-center"><span className={`text-xs px-2.5 py-1 rounded-full font-medium ${ks.color}`}>{ks.label}</span></td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setUploadProduct(p)}
                          className={`text-xs px-2 py-1 rounded transition-colors ${p.knowledgeStatus === 'ready' ? 'text-green-400 hover:text-green-300' : 'text-slate-400 hover:text-indigo-300'}`}
                          title="Upload knowledge PDF">
                          📄 {p.knowledgeStatus === 'ready' ? 'Re-train' : 'Upload'}
                        </button>
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
      {editProduct && <EditProductModal product={editProduct} inv={invMap[editProduct.id]} open={!!editProduct} onClose={() => setEditProduct(null)} onSaved={refetch} />}
      {aiProduct && <AiGenerateModal product={aiProduct} onClose={() => setAiProduct(null)} onApply={async (copy) => { await api.patch(`/products/${aiProduct.id}`, { description: copy.description, tagline: copy.tagline, keyOutcomes: copy.keyOutcomes, problemsSolved: copy.problemsSolved, faqPairs: copy.faqPairs, bookPersonaPrompt: copy.bookPersonaPrompt }); refetch(); }} />}
      {uploadProduct && (
        <KnowledgeUploadModal
          product={uploadProduct}
          onClose={() => setUploadProduct(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ['products'] });
            addToast('PDF uploaded — AI is training on your product', 'success');
          }}
        />
      )}
    </div>
  );
}
