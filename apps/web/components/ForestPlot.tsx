/**
 * Forest plot of candidate intervals (doc 05 UI-3, UC-02).
 *
 * A forest plot rather than a bar chart, because the interval **is** the result. A bar chart shows
 * the point estimate and hides the uncertainty, which is how every existing size tool ends up
 * implying a ranking it cannot support. Here the bar is the interval, the tick is the estimate, and
 * two candidates whose bars overlap are visibly not separable.
 *
 * Plain inline SVG: no chart library, so this costs the page nothing against its 150 KB budget
 * (NFR-P5).
 */

export interface ForestRow {
  name: string;
  point: number;
  low: number;
  high: number;
  /** Rendered differently so a tie reads as a tie rather than as a ranking. */
  tiedWithPrevious?: boolean;
}

const WIDTH = 760;
const ROW_H = 42;
const LABEL_W = 132;
const PAD_R = 56;

export function ForestPlot({ rows, budgetMs, unit = 'ms' }: { rows: ForestRow[]; budgetMs?: number; unit?: string }) {
  if (rows.length === 0) return null;

  const plotW = WIDTH - LABEL_W - PAD_R;
  // The axis always starts at 0 — a truncated axis exaggerates differences, which is exactly the
  // misreading this chart exists to prevent.
  const maxValue = Math.max(...rows.map((r) => r.high), budgetMs ?? 0) * 1.05 || 1;
  const x = (v: number) => LABEL_W + (Math.max(0, v) / maxValue) * plotW;
  const height = rows.length * ROW_H + 34;

  const ticks = axisTicks(maxValue);

  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Predicted main-thread cost for ${rows.length} candidates, shown as uncertainty intervals in ${unit}`}
      >
        {/* axis */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={18} x2={x(t)} y2={height - 16} stroke="var(--color-line)" strokeWidth={1} />
            <text x={x(t)} y={height - 4} textAnchor="middle" fontSize={10} fill="var(--color-ink-faint)">
              {formatTick(t)}
            </text>
          </g>
        ))}

        {budgetMs !== undefined && budgetMs <= maxValue && (
          <g>
            <line
              x1={x(budgetMs)}
              y1={14}
              x2={x(budgetMs)}
              y2={height - 16}
              stroke="var(--color-bad)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <text x={x(budgetMs)} y={10} textAnchor="middle" fontSize={10} fill="var(--color-bad)">
              budget {formatTick(budgetMs)}
            </text>
          </g>
        )}

        {rows.map((r, i) => {
          const y = 26 + i * ROW_H + ROW_H / 2;
          const x1 = x(r.low);
          const x2 = Math.max(x(r.high), x1 + 2);
          return (
            <g key={r.name}>
              <text x={LABEL_W - 10} y={y + 4} textAnchor="end" fontSize={12} fill="var(--color-ink)" fontWeight={600}>
                {r.name}
              </text>
              {/* the interval */}
              <line x1={x1} y1={y} x2={x2} y2={y} stroke="var(--color-predicted)" strokeWidth={8} strokeLinecap="round" opacity={0.3} />
              {/* whisker ends, so a very wide interval still reads as bounded */}
              <line x1={x1} y1={y - 6} x2={x1} y2={y + 6} stroke="var(--color-predicted)" strokeWidth={1.5} />
              <line x1={x2} y1={y - 6} x2={x2} y2={y + 6} stroke="var(--color-predicted)" strokeWidth={1.5} />
              {/* the point estimate */}
              <circle cx={x(r.point)} cy={y} r={4.5} fill="var(--color-predicted)" />
              <text x={x2 + 8} y={y + 4} fontSize={11} fill="var(--color-ink-soft)" className="tabular-nums">
                {r.point.toFixed(1)}
              </text>
              {r.tiedWithPrevious && (
                <text x={LABEL_W - 10} y={y + 16} textAnchor="end" fontSize={9} fill="var(--color-ink-faint)">
                  = tie
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="text-xs text-[var(--color-ink-faint)]">
        Bars are uncertainty intervals, dots are point estimates, in {unit}. Candidates whose bars overlap
        cannot be separated by this analysis — the honest answer there is &ldquo;no clear
        difference&rdquo;, not a ranking.
      </figcaption>
    </figure>
  );
}

/** 0, then 4–6 round ticks. Keeps the axis readable without a formatting library. */
function axisTicks(max: number): number[] {
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let t = 0; t <= max; t += step) out.push(Math.round(t * 100) / 100);
  return out;
}

const formatTick = (t: number) => (t >= 100 ? t.toFixed(0) : t >= 1 ? String(Math.round(t * 10) / 10) : String(t));
