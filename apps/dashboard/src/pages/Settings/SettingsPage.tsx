import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/ToastProvider';

type ConnectStatus = 'idle' | 'loading' | 'ok' | 'failed';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="ml-2 text-[10px] px-2 py-0.5 bg-white/10 hover:bg-white/20 text-slate-300 rounded transition-colors flex-shrink-0"
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

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
  const [webhookVerifyToken, setWebhookVerifyToken] = useState('');

  // Derive the API base URL (strips /api/v1 suffix from axios baseURL)
  const apiBaseUrl = (api.defaults.baseURL ?? '').replace(/\/api\/v1\/?$/, '');
  const webhookUrl = apiBaseUrl ? `${apiBaseUrl}/webhooks/meta` : '';

  useEffect(() => {
    api.get('/onboarding/status')
      .then(res => {
        setIsConnected(res.data.onboarded ?? false);
        setCurrentPhone(res.data.displayPhone ?? null);
        setWebhookVerifyToken(res.data.webhookVerifyToken ?? '');
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

      {/* Step 1 — WhatsApp / WABA credentials */}
      <div className="bg-surface border border-border rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-indigo-600/20 flex items-center justify-center flex-shrink-0 text-indigo-400 font-bold text-sm">1</div>
          <div className="w-10 h-10 rounded-lg bg-green-600/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-6 h-6 text-green-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          </div>
          <div>
            <h2 className="text-base font-semibold text-primary">Connect WhatsApp Business Account</h2>
            <p className="text-xs text-secondary mt-0.5">
              Enter your WABA credentials from Meta Business Manager.
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
            <span className="text-secondary text-xs ml-2">Enter credentials below to connect WhatsApp.</span>
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
      </div>

      {/* Step 2 — Webhook Registration */}
      <div className={`bg-surface border rounded-xl p-6 space-y-5 transition-all ${
        isConnected ? 'border-indigo-500/40' : 'border-border opacity-60'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm ${
            isConnected ? 'bg-indigo-600/20 text-indigo-400' : 'bg-white/5 text-slate-500'
          }`}>2</div>
          <div className="w-10 h-10 rounded-lg bg-blue-600/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-semibold text-primary">Register Webhook in Meta</h2>
            <p className="text-xs text-secondary mt-0.5">
              Tells Meta where to send incoming WhatsApp messages.{' '}
              <strong className="text-yellow-400">Required for conversations to work.</strong>
            </p>
          </div>
        </div>

        {!isConnected && (
          <p className="text-xs text-secondary/60 italic">Complete Step 1 first.</p>
        )}

        {isConnected && (
          <>
            <div className="bg-blue-900/10 border border-blue-700/20 rounded-lg px-4 py-3 space-y-1">
              <p className="text-xs text-blue-300 font-medium">
                Without this step, your WhatsApp conversations page will be empty — Meta doesn&apos;t know where to deliver messages.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-xs text-secondary mb-1.5 font-medium">Your Webhook URL</p>
                <div className="flex items-center gap-2 bg-[#0F172A] border border-border rounded-lg px-3 py-2">
                  <code className="text-green-300 text-xs flex-1 break-all font-mono">
                    {webhookUrl || 'https://your-api.railway.app/webhooks/meta'}
                  </code>
                  {webhookUrl && <CopyButton text={webhookUrl} />}
                </div>
              </div>

              {webhookVerifyToken && (
                <div>
                  <p className="text-xs text-secondary mb-1.5 font-medium">Verify Token</p>
                  <div className="flex items-center gap-2 bg-[#0F172A] border border-border rounded-lg px-3 py-2">
                    <code className="text-yellow-300 text-xs flex-1 font-mono">{webhookVerifyToken}</code>
                    <CopyButton text={webhookVerifyToken} />
                  </div>
                  <p className="text-[10px] text-secondary/50 mt-1">
                    This must match the <code className="bg-white/5 px-1 rounded">META_WEBHOOK_VERIFY_TOKEN</code> Railway env var.
                  </p>
                </div>
              )}

              <div className="bg-[#0F172A] border border-border rounded-lg px-4 py-3 space-y-2">
                <p className="text-xs font-semibold text-secondary">How to register in Meta Developer Console</p>
                <ol className="text-[11px] text-secondary/70 space-y-1.5 list-decimal list-inside">
                  <li>Go to <strong className="text-secondary">developers.facebook.com</strong> → your app → <strong className="text-secondary">WhatsApp → Configuration</strong></li>
                  <li>Click <strong className="text-secondary">Edit</strong> next to the Webhook section</li>
                  <li>Paste the <strong className="text-secondary">Webhook URL</strong> above into the <em>Callback URL</em> field</li>
                  <li>Paste the <strong className="text-secondary">Verify Token</strong> above into the <em>Verify Token</em> field</li>
                  <li>Click <strong className="text-secondary">Verify and Save</strong> — Meta will call your API to confirm it's reachable</li>
                  <li>Under <strong className="text-secondary">Webhook Fields</strong>, click <strong className="text-secondary">Subscribe</strong> next to <code className="bg-white/5 px-1 rounded">messages</code></li>
                </ol>
              </div>

              <div className="bg-amber-900/10 border border-amber-700/20 rounded-lg px-4 py-3">
                <p className="text-xs text-amber-300 font-medium mb-1">Already registered a webhook?</p>
                <p className="text-[11px] text-amber-200/70">
                  If you previously used a different webhook URL (e.g. for WATI or another service), you need to <strong>update it</strong> to the URL above. Only one webhook URL is active at a time per phone number.
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Step 3 — Verify it's working */}
      {isConnected && (
        <div className="bg-surface border border-border rounded-xl p-6 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-white/5 text-slate-500 flex items-center justify-center flex-shrink-0 font-bold text-sm">3</div>
            <div>
              <h2 className="text-base font-semibold text-primary">Test the Integration</h2>
              <p className="text-xs text-secondary mt-0.5">
                Send a WhatsApp message to your business number and check the Conversations page.
              </p>
            </div>
          </div>
          <ol className="text-[11px] text-secondary/70 space-y-1 list-decimal list-inside ml-11">
            <li>Send any message to <strong className="text-secondary">{currentPhone ?? 'your business number'}</strong> from a personal WhatsApp</li>
            <li>Open the <strong className="text-secondary">Conversations</strong> page in this dashboard</li>
            <li>The conversation should appear within a few seconds</li>
            <li>Click the conversation, then click <strong className="text-secondary">Take Over</strong> to reply as a human agent</li>
          </ol>
        </div>
      )}
    </div>
  );
}
