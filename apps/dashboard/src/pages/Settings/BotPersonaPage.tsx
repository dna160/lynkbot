import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/ToastProvider';

type BotTone = 'friendly' | 'formal' | 'playful';
type Language = 'id' | 'en';

interface PersonaForm {
  botName: string;
  botTone: BotTone | '';
  botDefaultLanguage: Language | '';
  botGreetingStyle: string;
  botAvatarEmoji: string;
  botCustomInstructions: string;
}

const TONE_OPTIONS: { value: BotTone; label: string; desc: string }[] = [
  { value: 'friendly', label: 'Friendly', desc: 'Warm and conversational — approachable but professional' },
  { value: 'formal',   label: 'Formal',   desc: 'Professional and polished — no slang or casual expressions' },
  { value: 'playful',  label: 'Playful',  desc: 'Upbeat and expressive — feel free to use emojis' },
];

const EMOJI_PRESETS = ['🤖', '🛍️', '💬', '✨', '🌟', '💎', '🎯', '🧡', '💙', '🌿'];

export function BotPersonaPage() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<PersonaForm>({
    botName: '',
    botTone: '',
    botDefaultLanguage: '',
    botGreetingStyle: '',
    botAvatarEmoji: '',
    botCustomInstructions: '',
  });

  useEffect(() => {
    api.get('/settings/persona')
      .then(res => {
        const d = res.data;
        setForm({
          botName: d.botName ?? '',
          botTone: d.botTone ?? '',
          botDefaultLanguage: d.botDefaultLanguage ?? '',
          botGreetingStyle: d.botGreetingStyle ?? '',
          botAvatarEmoji: d.botAvatarEmoji ?? '',
          botCustomInstructions: d.botCustomInstructions ?? '',
        });
      })
      .catch(() => {/* silently use empty defaults */})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const patch: Record<string, string | null> = {
        botName: form.botName.trim() || null,
        botTone: form.botTone || null,
        botDefaultLanguage: form.botDefaultLanguage || null,
        botGreetingStyle: form.botGreetingStyle.trim() || null,
        botAvatarEmoji: form.botAvatarEmoji.trim() || null,
        botCustomInstructions: form.botCustomInstructions.trim() || null,
      };
      await api.patch('/settings/persona', patch);
      addToast('Bot persona saved', 'success');
    } catch {
      addToast('Failed to save — please try again', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-secondary text-sm">
        <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-primary">Bot Persona</h1>
        <p className="text-sm text-secondary mt-0.5">
          Customize how your AI assistant introduces itself and communicates with customers.
        </p>
      </div>

      {/* Identity */}
      <div className="bg-surface border border-border rounded-xl p-6 space-y-5">
        <h2 className="text-base font-semibold text-primary">Identity</h2>

        {/* Avatar emoji */}
        <div>
          <label className="block text-xs text-secondary mb-2">Avatar Emoji</label>
          <div className="flex items-center gap-3 flex-wrap">
            {EMOJI_PRESETS.map(emoji => (
              <button
                key={emoji}
                onClick={() => setForm(f => ({ ...f, botAvatarEmoji: f.botAvatarEmoji === emoji ? '' : emoji }))}
                className={`text-2xl w-10 h-10 rounded-lg border transition-all ${
                  form.botAvatarEmoji === emoji
                    ? 'border-accent bg-accent/10'
                    : 'border-border hover:border-accent/50 bg-white/5'
                }`}
              >
                {emoji}
              </button>
            ))}
            <input
              value={form.botAvatarEmoji}
              onChange={e => setForm(f => ({ ...f, botAvatarEmoji: e.target.value }))}
              placeholder="Custom…"
              maxLength={10}
              className="w-24 bg-[#0F172A] border border-border text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent"
            />
          </div>
          <p className="text-[10px] text-secondary/50 mt-1">Shown in the dashboard only — not sent to customers.</p>
        </div>

        {/* Bot name */}
        <div>
          <label className="block text-xs text-secondary mb-1.5">
            Bot Name <span className="text-secondary/40">(optional)</span>
          </label>
          <input
            value={form.botName}
            onChange={e => setForm(f => ({ ...f, botName: e.target.value }))}
            placeholder="e.g. Aria, Luna, Mitra"
            maxLength={100}
            className="w-full bg-[#0F172A] border border-border text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent"
          />
          <p className="text-[10px] text-secondary/50 mt-1">
            When blank, your store name is used as the bot's identity.
          </p>
        </div>

        {/* Default language */}
        <div>
          <label className="block text-xs text-secondary mb-1.5">Default Language</label>
          <div className="flex gap-2">
            {([{ value: 'id', label: '🇮🇩 Bahasa Indonesia' }, { value: 'en', label: '🇬🇧 English' }] as const).map(opt => (
              <button
                key={opt.value}
                onClick={() => setForm(f => ({ ...f, botDefaultLanguage: opt.value }))}
                className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-all ${
                  form.botDefaultLanguage === opt.value
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-secondary hover:border-accent/50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tone */}
      <div className="bg-surface border border-border rounded-xl p-6 space-y-4">
        <h2 className="text-base font-semibold text-primary">Tone</h2>
        <div className="space-y-2">
          {TONE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setForm(f => ({ ...f, botTone: f.botTone === opt.value ? '' : opt.value }))}
              className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-all ${
                form.botTone === opt.value
                  ? 'border-accent bg-accent/10'
                  : 'border-border hover:border-accent/40'
              }`}
            >
              <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                form.botTone === opt.value ? 'border-accent' : 'border-secondary/40'
              }`}>
                {form.botTone === opt.value && <div className="w-2 h-2 rounded-full bg-accent" />}
              </div>
              <div>
                <div className="text-sm font-medium text-primary">{opt.label}</div>
                <div className="text-xs text-secondary mt-0.5">{opt.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Greeting style */}
      <div className="bg-surface border border-border rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-primary">Greeting Style</h2>
          <p className="text-xs text-secondary mt-0.5">
            Describe how the bot should open conversations. Leave blank to use the default for your chosen tone.
          </p>
        </div>
        <textarea
          value={form.botGreetingStyle}
          onChange={e => setForm(f => ({ ...f, botGreetingStyle: e.target.value }))}
          placeholder={`e.g. Always greet with "Halo Kak! 👋 Ada yang bisa kami bantu hari ini?"`}
          maxLength={500}
          rows={3}
          className="w-full bg-[#0F172A] border border-border text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent resize-none"
        />
        <p className="text-[10px] text-secondary/50">{form.botGreetingStyle.length}/500</p>
      </div>

      {/* Custom instructions */}
      <div className="bg-surface border border-border rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-primary">Custom Instructions</h2>
          <p className="text-xs text-secondary mt-0.5">
            Additional rules appended at the end of every system prompt. Use this for product-specific policies,
            escalation rules, or brand voice guidelines.
          </p>
        </div>
        <textarea
          value={form.botCustomInstructions}
          onChange={e => setForm(f => ({ ...f, botCustomInstructions: e.target.value }))}
          placeholder={`e.g. Always mention free shipping on orders above Rp 200.000.\nNever discuss competitor products.\nFor complaints, always offer to connect to a human agent.`}
          maxLength={2000}
          rows={6}
          className="w-full bg-[#0F172A] border border-border text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent resize-none font-mono text-xs"
        />
        <p className="text-[10px] text-secondary/50">{form.botCustomInstructions.length}/2000</p>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving…' : 'Save Persona'}
        </button>
      </div>
    </div>
  );
}
