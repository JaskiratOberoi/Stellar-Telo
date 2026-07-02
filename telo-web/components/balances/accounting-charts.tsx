'use client';

import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import type { AccountingDay } from '@/actions/accounting.actions';
import type {
  PaymentModeRow,
  CashCreditSplit,
  AgingBucket,
} from '@/db/read/accounting';

// ── Theme palette — chart-N tokens follow light/dark automatically ──────────
const C = {
  indigo: 'hsl(var(--chart-1))',
  emerald: 'hsl(var(--chart-2))',
  amber: 'hsl(var(--chart-3))',
  sky: 'hsl(var(--chart-4))',
  violet: 'hsl(var(--chart-5))',
  rose: 'hsl(var(--chart-6))',
  destructive: 'hsl(var(--destructive))',
};
const DONUT = [C.indigo, C.emerald, C.amber, C.sky, C.violet, C.rose, C.destructive];
// Theme-aware so axes/gridlines stay legible in both light and dark.
const GRID = 'hsl(var(--border))';
const TICK = { fill: 'hsl(var(--muted-foreground))', fontSize: 11 };

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const inrCompact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return `₹${Math.round(n)}`;
};
const mmdd = (day: string) => (day.length >= 10 ? day.slice(5) : day);

const tooltipStyle = {
  contentStyle: {
    background: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 10,
    fontSize: 12,
    boxShadow: '0 4px 12px hsl(var(--foreground) / 0.08)',
  },
  labelStyle: { color: 'hsl(var(--muted-foreground))' },
  itemStyle: { color: 'hsl(var(--foreground))' },
  cursor: { fill: 'hsl(var(--muted) / 0.5)' },
};

function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-4 shadow-elevation-1 transition-shadow hover:shadow-elevation-2 animate-fade-in motion-reduce:animate-none">
      <div className="mb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </p>
        {hint && <p className="text-[11px] text-muted-foreground/70">{hint}</p>}
      </div>
      <div className="h-48 sm:h-64 w-full">{children}</div>
    </div>
  );
}

export function AccountingCharts({
  daily,
  paymentModes,
  cashCredit,
  aging,
}: {
  daily: AccountingDay[];
  paymentModes: PaymentModeRow[];
  cashCredit: CashCreditSplit;
  aging: AgingBucket[];
}) {
  const series = daily.map((d) => ({ ...d, label: mmdd(d.day) }));
  const modeData = paymentModes
    .filter((m) => m.amount > 0)
    .map((m) => ({ name: m.mode, value: m.amount }));
  const cashCreditData = [
    { name: 'Paying (cash)', value: cashCredit.cashCharges },
    { name: 'Credit', value: cashCredit.creditCharges },
  ].filter((d) => d.value > 0);
  const agingData = aging.map((a) => ({ name: a.bucket, balance: a.balance, bills: a.bills }));
  const hasAging = aging.some((a) => a.bills > 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Billed vs Collected over time */}
      <div className="lg:col-span-2">
        <ChartCard
          title="Billed vs Collected"
          hint="Charges by bill date · Collected by receipt date"
        >
          <ResponsiveContainer>
            <ComposedChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: 4 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tick={TICK} axisLine={false} tickLine={false} width={52} tickFormatter={inrCompact} />
              <Tooltip {...tooltipStyle} formatter={(v) => inr(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar name="Charges" dataKey="charges" fill={C.indigo} radius={[3, 3, 0, 0]} maxBarSize={36} />
              <Line name="Collected" type="monotone" dataKey="collected" stroke={C.emerald} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Bills per day */}
      <ChartCard title="Bills per day">
        <ResponsiveContainer>
          <BarChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tick={TICK} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
            <Tooltip {...tooltipStyle} />
            <Bar name="Bills" dataKey="bills" fill={C.sky} radius={[3, 3, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Outstanding aging */}
      <ChartCard title="Outstanding aging" hint="Unpaid balance by age of bill · as of now">
        {hasAging ? (
          <ResponsiveContainer>
            <BarChart data={agingData} margin={{ top: 6, right: 8, bottom: 0, left: 4 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="name" tick={TICK} axisLine={false} tickLine={false} />
              <YAxis tick={TICK} axisLine={false} tickLine={false} width={52} tickFormatter={inrCompact} />
              <Tooltip {...tooltipStyle} formatter={(v) => inr(Number(v))} />
              <Bar name="Balance" dataKey="balance" radius={[3, 3, 0, 0]} maxBarSize={56}>
                {agingData.map((_, i) => (
                  <Cell key={i} fill={[C.emerald, C.amber, C.indigo, C.destructive][i] ?? C.indigo} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart label="No outstanding balance" />
        )}
      </ChartCard>

      {/* Collections by payment mode */}
      <ChartCard title="Collections by mode" hint="Receipts in the selected period">
        {modeData.length > 0 ? (
          <ResponsiveContainer>
            <PieChart>
              <Pie data={modeData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={84} paddingAngle={2} stroke="none">
                {modeData.map((_, i) => (
                  <Cell key={i} fill={DONUT[i % DONUT.length]} />
                ))}
              </Pie>
              <Tooltip {...tooltipStyle} formatter={(v) => inr(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart label="No collections in period" />
        )}
      </ChartCard>

      {/* Cash vs Credit (by charges) */}
      <ChartCard title="Paying vs Credit" hint="Share of charges billed">
        {cashCreditData.length > 0 ? (
          <ResponsiveContainer>
            <PieChart>
              <Pie data={cashCreditData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={84} paddingAngle={2} stroke="none">
                <Cell fill={C.emerald} />
                <Cell fill={C.amber} />
              </Pie>
              <Tooltip {...tooltipStyle} formatter={(v) => inr(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart label="No bills in period" />
        )}
      </ChartCard>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}
