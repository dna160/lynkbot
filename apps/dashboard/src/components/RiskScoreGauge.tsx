/**
 * @CLAUDE_CONTEXT
 * Package : apps/dashboard
 * File    : src/components/RiskScoreGauge.tsx
 * Role    : Colored arc gauge for tenant risk score (PRD §13.3).
 *           ok (<60): green, warning (60-80): yellow, blocked (>80): red.
 *           Fetches from GET /api/v1/risk-score on mount; also accepts props directly.
 */
import { useEffect, useState } from 'react';
import { riskScoreApi } from '@/lib/api';

interface RiskScoreData {
  score: number;
  level: 'ok' | 'warning' | 'blocked';
  computedAt?: string;
}

interface RiskScoreGaugeProps {
  /** If provided, skips the internal fetch and uses this data directly */
  data?: RiskScoreData;
  /** Show compact inline variant (no label, smaller) */
  compact?: boolean;
}

function getColor(level: 'ok' | 'warning' | 'blocked') {
  if (level === 'blocked') return { stroke: '#EF4444', text: 'text-red-400', bg: 'bg-red-900/20 border-red-800/40' };
  if (level === 'warning') return { stroke: '#EAB308', text: 'text-yellow-400', bg: 'bg-yellow-900/20 border-yellow-800/40' };
  return { stroke: '#22C55E', text: 'text-green-400', bg: 'bg-green-900/20 border-green-800/40' };
}

function getLevelLabel(level: 'ok' | 'warning' | 'blocked') {
  if (level === 'blocked') return 'Blocked';
  if (level === 'warning') return 'Warning';
  return 'OK';
}

function getLevelDescription(level: 'ok' | 'warning' | 'blocked') {
  if (level === 'blocked') return 'Risk score too high — broadcasts are blocked until score drops below 80.';
  if (level === 'warning') return 'Risk score elevated — review your sending patterns to avoid being blocked.';
  return 'Risk score healthy — broadcasts and flow activations are permitted.';
}

/**
 * SVG arc gauge. Draws a 180° half-circle arc from 0 to `pct` (0–1).
 */
function ArcGauge({ score, color }: { score: number; color: string }) {
  const r = 40;
  const cx = 55;
  const cy = 55;
  const startAngle = Math.PI; // 180°  (left)
  const endAngle = 0;        // 0°    (right)

  // full track arc (half circle)
  const trackStart = { x: cx + r * Math.cos(startAngle), y: cy + r * Math.sin(startAngle) };
  const trackEnd   = { x: cx + r * Math.cos(endAngle),   y: cy + r * Math.sin(endAngle) };

  // filled arc up to score
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const fillAngle = Math.PI - pct * Math.PI; // from PI down to 0
  const fillEnd   = { x: cx + r * Math.cos(fillAngle), y: cy + r * Math.sin(fillAngle) };

  const largeArc = pct > 0.5 ? 1 : 0;

  return (
    <svg width="110" height="62" viewBox="0 0 110 62" className="overflow-visible">
      {/* Track */}
      <path
        d={`M ${trackStart.x} ${trackStart.y} A ${r} ${r} 0 0 1 ${trackEnd.x} ${trackEnd.y}`}
        fill="none"
        stroke="#334155"
        strokeWidth="8"
        strokeLinecap="round"
      />
      {/* Fill */}
      {pct > 0 && (
        <path
          d={`M ${trackStart.x} ${trackStart.y} A ${r} ${r} 0 ${largeArc} 1 ${fillEnd.x} ${fillEnd.y}`}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
        />
      )}
      {/* Score text */}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        fontSize="18"
        fontWeight="700"
        fill={color}
      >
        {score}
      </text>
    </svg>
  );
}

export function RiskScoreGauge({ data: propData, compact = false }: RiskScoreGaugeProps) {
  const [data, setData] = useState<RiskScoreData | null>(propData ?? null);
  const [loading, setLoading] = useState(!propData);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (propData) { setData(propData); return; }
    let cancelled = false;
    setLoading(true);
    riskScoreApi.get()
      .then(res => {
        if (!cancelled) setData(res.data as RiskScoreData);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load risk score');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [propData]);

  if (loading) {
    return (
      <div className={compact ? 'flex items-center gap-2' : 'flex items-center gap-3 p-4 bg-surface border border-border rounded-xl'}>
        <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        {!compact && <span className="text-sm text-secondary">Loading risk score…</span>}
      </div>
    );
  }

  if (error || !data) {
    if (compact) return null;
    return (
      <div className="flex items-center gap-3 p-4 bg-surface border border-border rounded-xl">
        <span className="text-sm text-secondary/60">{error ?? 'Risk score unavailable'}</span>
      </div>
    );
  }

  const { stroke, text, bg } = getColor(data.level);

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${bg}`}>
        <span className={`w-1.5 h-1.5 rounded-full`} style={{ background: stroke }} />
        <span className={text}>Score {data.score}</span>
        <span className="text-secondary/60">· {getLevelLabel(data.level)}</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-5 p-4 border rounded-xl ${bg}`}>
      <ArcGauge score={data.score} color={stroke} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-primary">Sender Risk Score</span>
          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full border ${bg} ${text}`}>
            {getLevelLabel(data.level)}
          </span>
        </div>
        <p className="text-xs text-secondary leading-relaxed">{getLevelDescription(data.level)}</p>
        {data.computedAt && (
          <p className="text-[10px] text-secondary/40 mt-1">
            Last computed: {new Date(data.computedAt).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}
