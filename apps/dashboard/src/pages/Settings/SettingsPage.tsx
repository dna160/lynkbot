import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/ToastProvider';

type ConnectStatus = 'idle' | 'loading' | 'ok' | 'failed';

export function SettingsPage() {
  const { addToast } = useToast();

  // WABA form state
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>('idle');
  const [connectError, setConnectError] = useState('');

  // Current onboarding status
  const [currentPhone, setCurrentPhone] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);

  useEffect(() => {
    api.get('/onboarding/status')
      .then(res => {
        setIsConnected(res.data.onboarded ?? false);
        setCurrentPhone(res.data.displayPhone ?? null);
      })
      .catch(() => {/* ignore */})
      .finally(() => setStatusLoading(false));
  }, []);

  const handleConnect = async () => {
    if (!phoneNumberId.trim() || !wabaId.trim() || !accessToken.trim()) {
      setConnectError('All three fields are required.');
      return;
    }
    setConnectStatus('loading');
    setConnectError('');
    try {
      const res = await api.post('/onboarding/complete', {
        mode: 'manual',
        metaPhoneNumberId: phoneNumberId.trim(),
        wabaId: wabaId.trim(),
        metaAccessToken: accessToken.trim(),
      });
      setCurrentPhone(res.data.displayPhone ?? phoneNumberId.trim());
      setIsConnected(true);
      setConnectStatus('ok');
      setPhoneNumberId('');
      setWabaId('');
      setAccessToken('');
      addToast('WhatsApp connected successfully', 'success');
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Could not verify your Meta credentials.';
      setConnectError(msg);
      setConnectStatus('failed');
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-primary">Settings</h1>
        <p className="text-sm text-secondary mt-0.5">Configure your WhatsApp Business integration.</p>
      </div>

      {/* WhatsApp / WABA section */}
      <div className="bg-surface border border-border rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-3">
          {/* WhatsApp icon */}
          <div className="w-10 h-10 rounded-lg bg-green-600/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-6 h-6 text-green-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          </div>
          <div>
            <h2 className="text-base font-semibold text-primary">WhatsApp Business Account</h2>
            <p className="text-xs text-secondary mt-0.5">
              Required for template submission and WhatsApp messaging.
            </p>
          </div>
        </div>

        {/* Current status */}
        {statusLoading ? (
          <div className="flex items-center gap-2 text-sm text-secondary">
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            Checking connection…
          </div>
        ) : isConnected && currentPhone ? (
          <div className="flex items-center gap-2 bg-green-900/20 border border-green-700/30 rounded-lg px-4 py-3">
            <span className="text-green-400 text-sm">✓ Connected</span>
            <span className="text-green-300 font-mono text-sm">{currentPhone}</span>
            <span className="ml-auto text-xs text-secondary">Re-enter credentials below to update</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 bg-yellow-900/20 border border-yellow-700/30 rounded-lg px-4 py-3">
            <span className="text-yellow-400 text-sm">⚠ Not connected</span>
            <span className="text-secondary text-xs ml-2">Template submission requires WABA credentials.</span>
          </div>
        )}

        {/* Credential form */}
        <div className="space-y-3">
          <p className="text-xs text-secondary/70">
            Find these values in{' '}
            <strong className="text-secondary">Meta Business Manager → WhatsApp → API Setup</strong>.
          </p>

          <div>
            <label className="block text-xs text-secondary mb-1.5">Phone Number ID</label>
            <input
              value={phoneNumberId}
              onChange={e => setPhoneNumberId(e.target.value)}
              placeholder="e.g. 123456789012345"
              className="w-full bg-[#0F172A] border border-border text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-secondary mb-1.5">WABA ID</label>
            <input
              value={wabaId}
              onChange={e => setWabaId(e.target.value)}
              placeholder="e.g. 123456789012345"
              className="w-full bg-[#0F172A] border border-border text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-secondary mb-1.5">System User Access Token</label>
            <input
              type="password"
              value={accessToken}
              onChange={e => setAccessToken(e.target.value)}
              placeholder="EAAx…"
              className="w-full bg-[#0F172A] border border-border text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent font-mono"
            />
            <p className="text-[10px] text-secondary/50 mt-1">
              Use a <strong>System User</strong> token (not a personal token) — it never expires.
            </p>
          </div>

          {connectError && (
            <p className="text-red-400 text-sm">{connectError}</p>
          )}

          <button
            onClick={handleConnect}
            disabled={connectStatus === 'loading'}
            className="w-full py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {connectStatus === 'loading'
              ? 'Verifying…'
              : isConnected
              ? 'Update Credentials'
              : 'Connect WhatsApp'}
          </button>
        </div>

        {/* Help callout */}
        <div className="bg-[#0F172A] border border-border rounded-lg px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-secondary">Where to find these values</p>
          <ol className="text-[11px] text-secondary/70 space-y-0.5 list-decimal list-inside">
            <li>Go to <strong className="text-secondary">business.facebook.com</strong></li>
            <li>Select your app → <strong className="text-secondary">WhatsApp → API Setup</strong></li>
            <li>Copy <strong className="text-secondary">Phone Number ID</strong> and <strong className="text-secondary">WhatsApp Business Account ID</strong></li>
            <li>Generate a <strong className="text-secondary">System User Access Token</strong> with <code className="bg-white/5 px-1 rounded">whatsapp_business_messaging</code> permission</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
