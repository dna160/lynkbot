/**
 * WhatsApp bubble preview — renders live as the editor form changes.
 * Header: text or image placeholder. Body: rendered with {{N}} shown.
 * Footer: small grey text. Buttons: pill buttons below bubble.
 */
interface Button { type: string; text: string }

interface TemplatePreviewProps {
  headerText?: string;
  headerType?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  bodyText: string;
  footerText?: string;
  buttons?: Button[];
}

export function TemplatePreview({
  headerText,
  headerType = 'TEXT',
  bodyText,
  footerText,
  buttons = [],
}: TemplatePreviewProps) {
  return (
    <div className="bg-[#0b1417] rounded-xl p-4 max-w-sm mx-auto shadow-xl">
      {/* Status bar mockup */}
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/10">
        <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-white text-xs font-bold">WA</div>
        <div>
          <div className="text-xs text-white font-medium">WhatsApp Preview</div>
          <div className="text-[10px] text-green-400">online</div>
        </div>
      </div>

      {/* Chat bubble */}
      <div className="flex justify-end mb-2">
        <div className="max-w-[85%]">
          <div className="bg-[#005c4b] rounded-2xl rounded-tr-sm px-3 py-2.5 shadow">
            {/* Header */}
            {headerType === 'IMAGE' && (
              <div className="w-full h-28 bg-white/10 rounded-lg mb-2 flex items-center justify-center">
                <svg className="w-8 h-8 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            )}
            {headerType === 'VIDEO' && (
              <div className="w-full h-28 bg-white/10 rounded-lg mb-2 flex items-center justify-center">
                <svg className="w-8 h-8 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
            )}
            {headerType === 'DOCUMENT' && (
              <div className="w-full bg-white/10 rounded-lg mb-2 px-3 py-2 flex items-center gap-2">
                <svg className="w-5 h-5 text-white/50 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="text-xs text-white/60 truncate">document.pdf</span>
              </div>
            )}
            {headerType === 'TEXT' && headerText && (
              <p className="text-white font-semibold text-sm mb-1">{headerText}</p>
            )}

            {/* Body */}
            <p className="text-white/90 text-sm leading-relaxed whitespace-pre-wrap">
              {bodyText || <span className="text-white/30 italic">Body text will appear here…</span>}
            </p>

            {/* Footer */}
            {footerText && (
              <p className="text-white/40 text-[11px] mt-1.5">{footerText}</p>
            )}

            {/* Timestamp */}
            <div className="flex justify-end mt-1">
              <span className="text-white/30 text-[10px]">
                {new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>

          {/* Buttons */}
          {buttons.length > 0 && (
            <div className="mt-1 space-y-1">
              {buttons.map((btn, i) => (
                <div
                  key={i}
                  className="bg-[#005c4b] rounded-xl px-3 py-2 text-center border-t border-white/10"
                >
                  <span className="text-[#53bdeb] text-sm font-medium">{btn.text || 'Button'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
