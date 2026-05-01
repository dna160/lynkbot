import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { flowTemplatesApi } from '@/lib/api';
import { useToast } from '@/components/ToastProvider';
import { TemplatePreview } from './components/TemplatePreview';

type Category = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
type ButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';

interface Button { type: ButtonType; text: string; url?: string; phone_number?: string }

function toSnakeCase(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^[^a-z]+/, '')
    .slice(0, 255);
}

function extractVariables(text: string): string[] {
  const matches = [...text.matchAll(/\{\{(\d+)\}\}/g)];
  return [...new Set(matches.map(m => `{{${m[1]}}}`))]
    .sort((a, b) => parseInt(a.slice(2)) - parseInt(b.slice(2)));
}

export function TemplateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const isEdit = Boolean(id);

  const [displayName, setDisplayName] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('UTILITY');
  const [language, setLanguage] = useState('id');
  const [headerType, setHeaderType] = useState<'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT'>('NONE');
  const [headerText, setHeaderText] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [footerText, setFooterText] = useState('');
  const [buttons, setButtons] = useState<Button[]>([]);
  const [variableLabels, setVariableLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Auto-derive snake_case name from displayName
  useEffect(() => {
    if (!isEdit) {
      setName(toSnakeCase(displayName));
    }
  }, [displayName, isEdit]);

  // Load template data in edit mode
  useEffect(() => {
    if (!isEdit || !id) return;
    setLoading(true);
    flowTemplatesApi.get(id)
      .then(res => {
        const t = res.data;
        setDisplayName(t.name);
        setName(t.name);
        setCategory(t.category);
        setLanguage(t.language);
        setBodyText(t.bodyText);
        if (t.footer) setFooterText(t.footer);
        if (Array.isArray(t.buttons)) setButtons(t.buttons);
        if (t.header) {
          const h = t.header as { type?: string; text?: string; format?: string };
          setHeaderType((h.format ?? h.type ?? 'NONE') as typeof headerType);
          if (h.text) setHeaderText(h.text);
        }
      })
      .catch(() => addToast('Failed to load template', 'error'))
      .finally(() => setLoading(false));
  }, [id, isEdit, addToast]);

  const variables = extractVariables(bodyText);

  const buildComponents = () => {
    const components = [];
    if (headerType !== 'NONE') {
      components.push({
        type: 'HEADER',
        format: headerType,
        ...(headerType === 'TEXT' ? { text: headerText } : {}),
      });
    }
    components.push({ type: 'BODY', text: bodyText });
    if (footerText.trim()) {
      components.push({ type: 'FOOTER', text: footerText });
    }
    if (buttons.length > 0) {
      components.push({ type: 'BUTTONS', buttons });
    }
    return components;
  };

  const handleSave = async () => {
    if (!bodyText.trim()) { addToast('Body text is required', 'error'); return; }
    if (!name.match(/^[a-z][a-z0-9_]*$/)) { addToast('Template name must be snake_case', 'error'); return; }

    setSaving(true);
    try {
      const payload = {
        name,
        displayName,
        category,
        language,
        components: buildComponents() as any,
        variableLabels,
      };

      if (isEdit && id) {
        await flowTemplatesApi.update(id, payload);
        addToast('Template updated', 'success');
      } else {
        await flowTemplatesApi.create(payload);
        addToast('Template created as draft', 'success');
        navigate('/dashboard/templates');
      }
    } catch (err: any) {
      addToast(err?.response?.data?.error ?? 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const addButton = () => {
    if (buttons.length >= 3) { addToast('Max 3 buttons allowed', 'error'); return; }
    setButtons([...buttons, { type: 'QUICK_REPLY', text: '' }]);
  };

  const updateButton = (i: number, field: keyof Button, val: string) => {
    setButtons(prev => prev.map((b, idx) => idx === i ? { ...b, [field]: val } : b));
  };

  const removeButton = (i: number) => {
    setButtons(prev => prev.filter((_, idx) => idx !== i));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/dashboard/templates')} className="text-secondary hover:text-primary transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-2xl font-bold text-primary">
          {isEdit ? 'Edit Template' : 'New Template'}
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left — Form */}
        <div className="space-y-5">
          {/* Basic info */}
          <div className="bg-surface border border-border rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-primary uppercase tracking-wider">Basic Info</h2>

            <div>
              <label className="block text-xs text-secondary mb-1.5">Display Name</label>
              <input
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="e.g. Order Confirmation"
                className="w-full bg-[#0F172A] border border-border text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="block text-xs text-secondary mb-1.5">
                Template Name <span className="text-accent/60">(snake_case — auto-derived)</span>
              </label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="order_confirmation"
                className="w-full bg-[#0F172A] border border-border text-primary text-sm font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-accent"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-secondary mb-1.5">Category</label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value as Category)}
                  className="w-full bg-[#0F172A] border border-border text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent"
                >
                  <option value="UTILITY">Utility</option>
                  <option value="MARKETING">Marketing</option>
                  <option value="AUTHENTICATION">Authentication</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-secondary mb-1.5">Language</label>
                <select
                  value={language}
                  onChange={e => setLanguage(e.target.value)}
                  className="w-full bg-[#0F172A] border border-border text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent"
                >
                  <option value="id">Indonesian (id)</option>
                  <option value="en">English (en)</option>
                  <option value="en_US">English US</option>
                </select>
              </div>
            </div>
          </div>

          {/* Header */}
          <div className="bg-surface border border-border rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-primary uppercase tracking-wider">Header <span className="text-secondary/60 normal-case font-normal">(optional)</span></h2>
            <div>
              <select
                value={headerType}
                onChange={e => setHeaderType(e.target.value as typeof headerType)}
                className="w-full bg-[#0F172A] border border-border text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent"
              >
                <option value="NONE">None</option>
                <option value="TEXT">Text</option>
                <option value="IMAGE">Image</option>
                <option value="VIDEO">Video</option>
                <option value="DOCUMENT">Document</option>
              </select>
            </div>
            {headerType === 'TEXT' && (
              <input
                value={headerText}
                onChange={e => setHeaderText(e.target.value)}
                placeholder="Header text (max 60 chars)"
                maxLength={60}
                className="w-full bg-[#0F172A] border border-border text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent"
              />
            )}
            {headerType !== 'NONE' && headerType !== 'TEXT' && (
              <p className="text-xs text-secondary/60">Media will be uploaded when sending via broadcast.</p>
            )}
          </div>

          {/* Body */}
          <div className="bg-surface border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-primary uppercase tracking-wider">Body</h2>
              <span className="text-xs text-secondary">{bodyText.length}/1024</span>
            </div>
            <textarea
              value={bodyText}
              onChange={e => setBodyText(e.target.value)}
              placeholder="Your message body. Use {{1}}, {{2}} for variables."
              rows={5}
              maxLength={1024}
              className="w-full bg-[#0F172A] border border-border text-primary text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent resize-none"
            />
            {variables.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-secondary font-medium">Variable Labels</p>
                {variables.map(v => (
                  <div key={v} className="flex items-center gap-2">
                    <span className="text-xs font-mono text-accent/80 w-12">{v}</span>
                    <input
                      value={variableLabels[v] ?? ''}
                      onChange={e => setVariableLabels(prev => ({ ...prev, [v]: e.target.value }))}
                      placeholder={`Label for ${v} (e.g. Customer Name)`}
                      className="flex-1 bg-[#0F172A] border border-border text-primary text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-accent"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="bg-surface border border-border rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-primary uppercase tracking-wider">Footer <span className="text-secondary/60 normal-case font-normal">(optional)</span></h2>
            <input
              value={footerText}
              onChange={e => setFooterText(e.target.value)}
              placeholder="Footer text (max 60 chars)"
              maxLength={60}
              className="w-full bg-[#0F172A] border border-border text-primary text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent"
            />
          </div>

          {/* Buttons */}
          <div className="bg-surface border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-primary uppercase tracking-wider">Buttons <span className="text-secondary/60 normal-case font-normal">(up to 3)</span></h2>
              <button
                onClick={addButton}
                disabled={buttons.length >= 3}
                className="text-xs text-accent hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
              >
                + Add button
              </button>
            </div>
            {buttons.map((btn, i) => (
              <div key={i} className="border border-border rounded-lg p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <select
                    value={btn.type}
                    onChange={e => updateButton(i, 'type', e.target.value)}
                    className="bg-[#0F172A] border border-border text-primary text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-accent"
                  >
                    <option value="QUICK_REPLY">Quick Reply</option>
                    <option value="URL">URL</option>
                    <option value="PHONE_NUMBER">Phone Number</option>
                  </select>
                  <button onClick={() => removeButton(i)} className="text-red-400/70 hover:text-red-400 text-xs">Remove</button>
                </div>
                <input
                  value={btn.text}
                  onChange={e => updateButton(i, 'text', e.target.value)}
                  placeholder="Button label"
                  maxLength={25}
                  className="w-full bg-[#0F172A] border border-border text-primary text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-accent"
                />
                {btn.type === 'URL' && (
                  <input
                    value={btn.url ?? ''}
                    onChange={e => updateButton(i, 'url', e.target.value)}
                    placeholder="https://example.com/{{1}}"
                    className="w-full bg-[#0F172A] border border-border text-primary text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-accent"
                  />
                )}
                {btn.type === 'PHONE_NUMBER' && (
                  <input
                    value={btn.phone_number ?? ''}
                    onChange={e => updateButton(i, 'phone_number', e.target.value)}
                    placeholder="+628123456789"
                    className="w-full bg-[#0F172A] border border-border text-primary text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-accent"
                  />
                )}
              </div>
            ))}
            {buttons.length === 0 && (
              <p className="text-xs text-secondary/50">
                Add Quick Reply buttons to use this template as a flow trigger (required by Meta compliance).
              </p>
            )}
          </div>

          {/* Save */}
          <div className="flex gap-3">
            <button
              onClick={() => navigate('/dashboard/templates')}
              className="flex-1 py-2.5 border border-border rounded-lg text-sm text-secondary hover:text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving…' : isEdit ? 'Update Draft' : 'Create Draft'}
            </button>
          </div>
        </div>

        {/* Right — Preview */}
        <div className="lg:sticky lg:top-6 h-fit">
          <div className="bg-surface border border-border rounded-xl p-5">
            <h2 className="text-sm font-semibold text-primary uppercase tracking-wider mb-4">Preview</h2>
            <TemplatePreview
              headerType={headerType === 'NONE' ? undefined : headerType}
              headerText={headerText}
              bodyText={bodyText}
              footerText={footerText}
              buttons={buttons}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
