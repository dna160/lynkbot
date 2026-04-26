interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ReactNode;
}

export function StatCard({ label, value, sub, icon }: StatCardProps) {
  return (
    <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-secondary">{label}</span>
        {icon && <span className="text-secondary">{icon}</span>}
      </div>
      <div className="text-2xl font-bold text-primary">{value}</div>
      {sub && <div className="text-xs text-secondary">{sub}</div>}
    </div>
  );
}
