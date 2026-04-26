import { useState, useRef, useCallback, useEffect } from 'react';
import { buyersApi, broadcastsApi, intelligenceApi, type Buyer, type BroadcastTemplate, type Genome, type GenomeResponse } from '@/lib/api';
import { useToast } from '@/components/ToastProvider';

function formatPhone(p: string) { return p ? `+${p}` : '—'; }
function formatDate(s: string) { return new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }); }

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { addToast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number; total: number; errors: string[] } | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    const ok = f.name.endsWith('.csv') || f.name.endsWith('.xlsx') || f.name.endsWith('.xls');
    if (!ok) { setError('Only .csv, .xlsx, or .xls files are supported'); return; }
    setFile(f); setError('');
  };

  const handleDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }, []);

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true); setError('');
    try {
      const res = await buyersApi.import(file);
      setResult(res.data); addToast(`${res.data.imported} contacts imported`, 'success'); onDone();
    } catch (err: any) { setError(err?.response?.data?.error ?? 'Upload failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-md p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-primary">Import Contacts</h2>
          <button onClick={onClose} className="text-secondary hover:text-primary transition-colors"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        {result ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-green-900/20 border border-green-800/30 rounded-lg p-3"><div className="text-2xl font-bold text-green-400">{result.imported}</div><div className="text-xs text-secondary mt-1">Imported</div></div>
              <div className="bg-yellow-900/20 border border-yellow-800/30 rounded-lg p-3"><div className="text-2xl font-bold text-yellow-400">{result.skipped}</div><div className="text-xs text-secondary mt-1">Skipped</div></div>
              <div className="bg-white/5 border border-border rounded-lg p-3"><div className="text-2xl font-bold text-primary">{result.total}</div><div className="text-xs text-secondary mt-1">Total rows</div></div>
            </div>
            {result.errors.length > 0 && <div className="bg-red-900/20 border border-red-800/30 rounded-lg p-3"><div className="text-xs font-medium text-red-400 mb-2">Errors (first {result.errors.length})</div><div className="space-y-1">{result.errors.map((e, i) => <div key={i} className="text-xs text-secondary">{e}</div>)}</div></div>}
            <button onClick={onClose} className="w-full py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors">Done</button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-secondary">Upload a CSV or XLSX with columns: <span className="text-primary font-mono">phone</span>, <span className="text-primary font-mono">name</span>, <span className="text-primary font-mono">tags</span> (comma-separated), <span className="text-primary font-mono">notes</span>.</p>
            <div className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${file ? 'border-accent/50 bg-accent/5' : 'border-border hover:border-accent/30'}`} onDragOver={e => e.preventDefault()} onDrop={handleDrop} onClick={() => inputRef.current?.click()}>
              <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              {file ? <div><div className="text-sm font-medium text-primary">{file.name}</div><div className="text-xs text-secondary mt-1">{(file.size / 1024).toFixed(1)} KB</div></div> : (
                <div><svg className="w-8 h-8 text-secondary mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg><div className="text-sm text-secondary">Drop file here or <span className="text-accent">browse</span></div><div className="text-xs text-secondary/60 mt-1">CSV, XLSX, or XLS · max 5MB</div></div>
              )}
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-border text-sm text-secondary hover:text-primary transition-colors">Cancel</button>
              <button onClick={handleUpload} disabled={!file || loading} className="flex-1 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">{loading ? 'Uploading…' : 'Import'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BroadcastModal({ onClose }: { onClose: () => void }) {
  const { addToast } = useToast();
  const [templates, setTemplates] = useState<BroadcastTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [selectedKey, setSelectedKey] = useState('');
  const [params, setParams] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ id: string; recipientCount: number; status: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    broadcastsApi.templates().then(res => { setTemplates(res.data.templates); setLoadingTemplates(false); }).catch(() => setLoadingTemplates(false));
  }, []);

  const selectedTemplate = templates.find(t => t.key === selectedKey);
  const handleSelectTemplate = (key: string) => { const tpl = templates.find(t => t.key === key); setSelectedKey(key); setParams(tpl ? tpl.params.map(() => '') : []); };

  const handleSend = async () => {
    if (!selectedKey) { setError('Select a template'); return; }
    setLoading(true); setError('');
    try {
      const audienceFilter = tagFilter.trim() ? { tags: tagFilter.split(',').map(t => t.trim()).filter(Boolean) } : undefined;
      const res = await broadcastsApi.create({ templateKey: selectedKey, parameters: params, audienceFilter });
      setResult(res.data); addToast(`Broadcast queued for ${res.data.recipientCount} recipients`, 'success');
    } catch (err: any) { setError(err?.response?.data?.error ?? 'Failed to send broadcast'); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-lg p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-primary">Send Broadcast</h2>
          <button onClick={onClose} className="text-secondary hover:text-primary transition-colors"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        {result ? (
          <div className="space-y-4">
            <div className="bg-green-900/20 border border-green-800/30 rounded-lg p-4 text-center"><div className="text-2xl font-bold text-green-400 mb-1">{result.recipientCount}</div><div className="text-sm text-secondary">Broadcast queued · {result.status}</div></div>
            <p className="text-xs text-secondary text-center">Sending in background. Check Broadcast History for status.</p>
            <button onClick={onClose} className="w-full py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors">Done</button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">Template</label>
              {loadingTemplates ? <div className="h-10 bg-white/5 rounded-lg animate-pulse" /> : (
                <select value={selectedKey} onChange={e => handleSelectTemplate(e.target.value)} className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent">
                  <option value="">— choose template —</option>
                  {templates.map(t => <option key={t.key} value={t.key}>{t.key} ({t.name})</option>)}
                </select>
              )}
            </div>
            {selectedTemplate && selectedTemplate.params.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">Parameters</label>
                <div className="space-y-2">
                  {selectedTemplate.params.map((paramName, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs text-secondary w-32 shrink-0 font-mono">{paramName}</span>
                      <input type="text" value={params[i] ?? ''} onChange={e => { const next = [...params]; next[i] = e.target.value; setParams(next); }} placeholder={`{{${i + 1}}}`}
                        className="flex-1 bg-bg border border-border rounded-lg px-3 py-1.5 text-sm text-primary placeholder-secondary/40 focus:outline-none focus:border-accent" />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">Filter by tags <span className="text-secondary/50">(optional, comma-separated)</span></label>
              <input type="text" value={tagFilter} onChange={e => setTagFilter(e.target.value)} placeholder="e.g. vip, loyal"
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-primary placeholder-secondary/40 focus:outline-none focus:border-accent" />
              <p className="text-xs text-secondary mt-1">Leave blank to send to all contacts.</p>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-border text-sm text-secondary hover:text-primary transition-colors">Cancel</button>
              <button onClick={handleSend} disabled={!selectedKey || loading} className="flex-1 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">{loading ? 'Sending…' : 'Send Broadcast'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Pantheon Intelligence Drawer ────────────────────────────────────────────

const TRAIT_LABELS: Record<string, string> = {
  openness: 'Openness', conscientiousness: 'Conscientiousness', extraversion: 'Extraversion',
  agreeableness: 'Agreeableness', neuroticism: 'Neuroticism',
  communicationStyle: 'Communication Style', decisionMaking: 'Decision Making',
  brandRelationship: 'Brand Relationship', influenceSusceptibility: 'Influence Susceptibility',
  emotionalExpression: 'Emotional Expression', conflictBehavior: 'Conflict Behavior',
  literacyArticulation: 'Literacy / Articulation', socioeconomicFriction: 'Socioeconomic Friction',
  identityFusion: 'Identity Fusion', chronesthesiaCapacity: 'Chronesthesia',
  tomSelfAwareness: 'Self-Awareness (ToM)', tomSocialModeling: 'Social Modeling (ToM)',
  executiveFlexibility: 'Executive Flexibility',
};

const CLUSTER_KEYS = {
  'A — OCEAN': ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'],
  'B — Behavioral': ['communicationStyle', 'decisionMaking', 'brandRelationship', 'influenceSusceptibility', 'emotionalExpression', 'conflictBehavior', 'literacyArticulation', 'socioeconomicFriction'],
  'C — Human Uniqueness': ['identityFusion', 'chronesthesiaCapacity', 'tomSelfAwareness', 'tomSocialModeling', 'executiveFlexibility'],
};

function scoreColor(v: number) {
  if (v >= 70) return 'bg-emerald-500';
  if (v >= 55) return 'bg-blue-500';
  if (v >= 40) return 'bg-yellow-500';
  return 'bg-red-500';
}

function confidenceBadge(c: 'HIGH' | 'MEDIUM' | 'LOW') {
  const map = { HIGH: 'bg-emerald-900/40 text-emerald-400 border-emerald-800/50', MEDIUM: 'bg-yellow-900/40 text-yellow-400 border-yellow-800/50', LOW: 'bg-zinc-800 text-zinc-400 border-zinc-700' };
  return map[c] ?? map.LOW;
}

function IntelligenceDrawer({ buyer, onClose }: { buyer: Buyer; onClose: () => void }) {
  const { addToast } = useToast();
  const [data, setData] = useState<GenomeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'genome' | 'mutations' | 'cache'>('genome');

  useEffect(() => {
    intelligenceApi.getGenome(buyer.id).then(res => { setData(res.data); }).catch(() => {}).finally(() => setLoading(false));
  }, [buyer.id]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await intelligenceApi.refreshGenome(buyer.id);
      setData(res.data);
      addToast(`Genome refreshed — ${(res.data as any).signalsSummary?.messagesAnalyzed ?? 0} messages analyzed`, 'success');
    } catch { addToast('Refresh failed', 'error'); }
    finally { setRefreshing(false); }
  };

  const genome: Genome | null = data?.genome ?? null;
  const scores = genome?.scores;

  return (
    <div className="fixed inset-0 bg-black/60 flex justify-end z-50" onClick={onClose}>
      <div className="w-full max-w-xl bg-surface border-l border-border h-full overflow-y-auto flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-surface z-10">
          <div>
            <h2 className="text-base font-semibold text-primary">Customer Intelligence Profile</h2>
            <p className="text-xs text-secondary mt-0.5">{buyer.displayName || 'Unnamed'} · +{buyer.waPhone}</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleRefresh} disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-secondary hover:text-primary hover:border-accent/50 disabled:opacity-40 transition-all">
              <svg className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              {refreshing ? 'Refreshing…' : 'Refresh Genome'}
            </button>
            <button onClick={onClose} className="text-secondary hover:text-primary transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center"><div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>
        ) : !data?.hasPersisted ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-4">
            <div className="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center">
              <svg className="w-7 h-7 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
            </div>
            <div>
              <p className="text-sm font-medium text-primary mb-1">No genome yet</p>
              <p className="text-xs text-secondary">This buyer hasn't had enough conversation messages to build a profile. Click <span className="text-accent">Refresh Genome</span> to analyze existing messages.</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            {/* Summary bar */}
            {genome && (
              <div className="flex items-center gap-4 px-5 py-3 border-b border-border bg-white/2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${confidenceBadge(genome.confidence)}`}>{genome.confidence} confidence</span>
                <span className="text-xs text-secondary">{genome.observationCount} messages observed</span>
                {data.mutations.length > 0 && <span className="text-xs text-secondary">{data.mutations.length} trait mutations</span>}
              </div>
            )}

            {/* Tabs */}
            <div className="flex border-b border-border px-5">
              {(['genome', 'mutations', 'cache'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors capitalize ${tab === t ? 'border-accent text-accent' : 'border-transparent text-secondary hover:text-primary'}`}>
                  {t === 'genome' ? 'Parameters' : t === 'mutations' ? `History (${data.mutations.length})` : 'Dialog Cache'}
                </button>
              ))}
            </div>

            {/* Tab: Genome parameters */}
            {tab === 'genome' && scores && (
              <div className="p-5 space-y-6">
                {Object.entries(CLUSTER_KEYS).map(([cluster, keys]) => (
                  <div key={cluster}>
                    <h3 className="text-xs font-semibold text-secondary uppercase tracking-wider mb-3">{cluster}</h3>
                    <div className="space-y-2">
                      {keys.map(key => {
                        const val = (scores as unknown as Record<string, number>)[key] ?? 50;
                        return (
                          <div key={key} className="flex items-center gap-3">
                            <span className="text-xs text-secondary w-44 shrink-0">{TRAIT_LABELS[key] ?? key}</span>
                            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${scoreColor(val)}`} style={{ width: `${val}%` }} />
                            </div>
                            <span className="text-xs font-mono text-primary w-6 text-right">{val}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {data.osintSummary && (
                  <div>
                    <h3 className="text-xs font-semibold text-secondary uppercase tracking-wider mb-2">OSINT Summary</h3>
                    <p className="text-xs text-secondary leading-relaxed bg-white/3 rounded-lg p-3">{data.osintSummary}</p>
                  </div>
                )}
              </div>
            )}

            {/* Tab: Mutation history */}
            {tab === 'mutations' && (
              <div className="p-5">
                {data.mutations.length === 0 ? (
                  <p className="text-sm text-secondary text-center py-8">No significant trait changes recorded yet.</p>
                ) : (
                  <div className="space-y-3">
                    {data.mutations.map((m, i) => (
                      <div key={i} className="bg-white/3 border border-border/50 rounded-lg p-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-primary">{TRAIT_LABELS[m.traitName] ?? m.traitName}</span>
                          <span className={`text-xs font-mono font-semibold ${m.delta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{m.delta > 0 ? '+' : ''}{m.delta}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-secondary">
                          <span className="font-mono">{m.oldScore}</span>
                          <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                          <span className="font-mono text-primary">{m.newScore}</span>
                          <span className="ml-auto">{formatDate(m.createdAt)}</span>
                        </div>
                        {m.evidenceSummary && <p className="text-xs text-secondary/70 italic">{m.evidenceSummary}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Tab: Dialog cache */}
            {tab === 'cache' && (
              <div className="p-5">
                {!data.dialogCache ? (
                  <div className="text-center py-8 space-y-2">
                    <p className="text-sm text-secondary">Dialog cache not built yet.</p>
                    <p className="text-xs text-secondary/60">Genome confidence must be MEDIUM or HIGH. Click Refresh Genome to build.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {data.dialogCacheBuiltAt && <p className="text-xs text-secondary">Built {formatDate(data.dialogCacheBuiltAt)}</p>}
                    {Object.entries(data.dialogCache).map(([momentType, momentData]) => (
                      <div key={momentType} className="border border-border/50 rounded-lg overflow-hidden">
                        <div className="px-3 py-2 bg-white/3 border-b border-border/50">
                          <span className="text-xs font-semibold text-accent capitalize">{momentType.replace(/_/g, ' ')}</span>
                        </div>
                        <div className="p-3 space-y-2">
                          {(['option_a', 'option_b', 'option_c'] as const).map(opt => {
                            const o = (momentData as Record<string, { baseLanguage?: string; baseProbability?: number }>)[opt];
                            if (!o) return null;
                            return (
                              <div key={opt} className="flex items-start gap-2">
                                <span className="text-xs font-mono text-accent/70 w-6 shrink-0 mt-0.5">{opt.slice(-1).toUpperCase()}</span>
                                <span className="text-xs text-secondary flex-1 leading-relaxed">{o.baseLanguage ?? '—'}</span>
                                <span className="text-xs font-mono text-secondary/50 shrink-0">{o.baseProbability ?? '?'}%</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function BuyersPage() {
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedBuyer, setSelectedBuyer] = useState<Buyer | null>(null);
  const limit = 50;

  const fetchBuyers = useCallback(async (p = page, s = search) => {
    setLoading(true);
    try {
      const res = await buyersApi.list({ page: p, limit, search: s || undefined });
      setBuyers(res.data.items); setTotal(res.data.total);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [page, search]);

  useEffect(() => { fetchBuyers(1, ''); }, []);

  const handleSearch = (val: string) => { setSearch(val); setPage(1); fetchBuyers(1, val); };
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this contact?')) return;
    setDeletingId(id);
    try { await buyersApi.delete(id); fetchBuyers(); } finally { setDeletingId(null); }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Contacts</h1>
          <p className="text-secondary text-sm mt-0.5">{total.toLocaleString()} total contacts</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowBroadcast(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm text-secondary hover:text-primary hover:border-accent/50 transition-all">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" /></svg>
            Broadcast
          </button>
          <button onClick={() => setShowImport(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
            Import CSV / XLSX
          </button>
        </div>
      </div>

      <div className="relative">
        <svg className="w-4 h-4 text-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input type="text" value={search} onChange={e => handleSearch(e.target.value)} placeholder="Search by name or phone…"
          className="w-full pl-9 pr-4 py-2.5 bg-surface border border-border rounded-lg text-sm text-primary placeholder-secondary/50 focus:outline-none focus:border-accent" />
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-xs font-medium text-secondary uppercase tracking-wider px-4 py-3">Name</th>
              <th className="text-left text-xs font-medium text-secondary uppercase tracking-wider px-4 py-3">Phone</th>
              <th className="text-left text-xs font-medium text-secondary uppercase tracking-wider px-4 py-3">Tags</th>
              <th className="text-left text-xs font-medium text-secondary uppercase tracking-wider px-4 py-3">Orders</th>
              <th className="text-left text-xs font-medium text-secondary uppercase tracking-wider px-4 py-3">Added</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} className="border-b border-border/50">{Array.from({ length: 6 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-white/5 rounded animate-pulse" /></td>)}</tr>
            )) : buyers.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-16 text-center text-secondary text-sm">{search ? 'No contacts match your search.' : 'No contacts yet — import a CSV or XLSX to get started.'}</td></tr>
            ) : buyers.map(buyer => (
              <tr key={buyer.id} className="border-b border-border/50 hover:bg-white/2 transition-colors cursor-pointer" onClick={() => setSelectedBuyer(buyer)}>
                <td className="px-4 py-3"><div className="text-sm font-medium text-primary">{buyer.displayName || <span className="text-secondary italic">unnamed</span>}</div></td>
                <td className="px-4 py-3"><span className="text-sm text-secondary font-mono">{formatPhone(buyer.waPhone)}</span></td>
                <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{(buyer.tags ?? []).map(tag => <span key={tag} className="px-1.5 py-0.5 rounded text-xs bg-accent/10 text-accent/80 border border-accent/20">{tag}</span>)}</div></td>
                <td className="px-4 py-3"><span className="text-sm text-secondary">{buyer.totalOrders}</span></td>
                <td className="px-4 py-3"><span className="text-sm text-secondary">{formatDate(buyer.createdAt)}</span></td>
                <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                  <button onClick={() => handleDelete(buyer.id)} disabled={deletingId === buyer.id} className="text-secondary hover:text-red-400 transition-colors disabled:opacity-40" title="Delete contact">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-secondary">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button onClick={() => { setPage(p => p - 1); fetchBuyers(page - 1); }} disabled={page <= 1} className="px-3 py-1.5 rounded-lg border border-border hover:border-accent/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Previous</button>
            <button onClick={() => { setPage(p => p + 1); fetchBuyers(page + 1); }} disabled={page >= totalPages} className="px-3 py-1.5 rounded-lg border border-border hover:border-accent/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next</button>
          </div>
        </div>
      )}

      {showImport && <ImportModal onClose={() => setShowImport(false)} onDone={() => { setShowImport(false); fetchBuyers(1, search); }} />}
      {showBroadcast && <BroadcastModal onClose={() => setShowBroadcast(false)} />}
      {selectedBuyer && <IntelligenceDrawer buyer={selectedBuyer} onClose={() => setSelectedBuyer(null)} />}
    </div>
  );
}
