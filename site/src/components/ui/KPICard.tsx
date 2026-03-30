interface KPICardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  color?: string;
  icon?: string;
}

export function KPICard({ label, value, subtitle, color = "#8b5cf6", icon }: KPICardProps) {
  return (
    <div className="card-ghost p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-text-muted uppercase tracking-widest">
          {label}
        </span>
        {icon && <span className="text-base opacity-40">{icon}</span>}
      </div>
      <div
        className="text-2xl font-bold font-[family-name:var(--font-outfit)] tracking-tight"
        style={{ color }}
      >
        {value}
      </div>
      {subtitle && (
        <p className="text-xs text-text-muted mt-1">{subtitle}</p>
      )}
    </div>
  );
}
