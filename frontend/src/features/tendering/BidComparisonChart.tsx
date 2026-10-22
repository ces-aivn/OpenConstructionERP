// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtList, fmtPercent } from '@/shared/lib/formatters';
import { formatCompactCurrency } from '@/shared/lib/money';
import { unpricedLineCount } from './analysis';
import { getNumberLocale } from '@/stores/usePreferencesStore';

/* ── Types ─────────────────────────────────────────────────────────────── */

interface BidTotal {
  bid_id: string;
  company_name: string;
  total: number;
  currency: string;
  deviation_pct: number;
  status: string;
  matched_lines?: number;
  total_lines?: number;
}

interface BidComparisonChartProps {
  bidTotals: BidTotal[];
  budgetTotal: number;
  currency: string;
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

const CHART_PADDING_TOP = 64;
const CHART_PADDING_BOTTOM = 80;
const CHART_PADDING_LEFT = 80;
const CHART_PADDING_RIGHT = 24;
const BAR_GAP_RATIO = 0.3;
const MIN_CHART_HEIGHT = 330;
// The bottom strip the legend used to be drawn in, inside the SVG.
const LEGEND_STRIP = 20;
const TICK_COUNT = 5;
// A bar is never drawn thinner than this, so the cheapest bid stays visible
// beside bids a hundred times its size; its figure is printed above it anyway.
const MIN_BAR_PX = 6;
// Roughly the width of one character of the 11px axis label.
const LABEL_CHAR_PX = 6.5;

const LOWEST_COLOR = 'var(--oe-success, #15803d)';
// Orange rather than red: red against green is the pair a red-green colour
// blind reader cannot tell apart, and every bar also carries its label.
const HIGHEST_COLOR = 'var(--oe-warning-strong, #c2410c)';
const OTHER_COLOR = 'var(--color-oe-blue, #3b82f6)';

export interface BarLabel {
  /** The name as shown, made unique when two bids carry the same one. */
  full: string;
  /** Up to two lines that fit under the bar. */
  lines: string[];
}

/**
 * Labels for the bars: whole words on up to two lines, never a bare prefix.
 *
 * Two bids from "Schuff Steel" used to read "Schuff Steel..." twice and could
 * not be told apart. A name that occurs more than once is numbered, and a name
 * too long for two lines keeps its end ("...Steel Pacific") rather than only
 * its start, because the start is what same-company bids share. The full
 * name is always in the tooltip.
 */
export function barLabels(names: string[], maxChars: number): BarLabel[] {
  const width = Math.max(6, Math.floor(maxChars));
  const seen = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n.trim(), (counts.get(n.trim()) ?? 0) + 1);
  return names.map((raw) => {
    const name = raw.trim();
    let full = name;
    if ((counts.get(name) ?? 0) > 1) {
      const index = (seen.get(name) ?? 0) + 1;
      seen.set(name, index);
      full = `${name} (${index})`;
    }
    const words = full.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= width || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    if (lines.length <= 2 && lines.every((l) => l.length <= width)) return { full, lines };
    // Too long: the first line as it is, the second line the end of the name.
    const head = lines[0] ?? '';
    const first = head.length > width ? `${head.slice(0, width - 1)}\u2026` : head;
    const rest = full.slice(first.endsWith('\u2026') ? width - 1 : head.length).trim();
    const second = rest.length > width ? `\u2026${rest.slice(rest.length - (width - 1))}` : rest;
    return { full, lines: second ? [first, second] : [first] };
  });
}

function formatCompact(amount: number, currency: string): string {
  // currency may be "", which renders a clean number with no symbol rather
  // than a wrong one (task #217).
  return formatCompactCurrency(amount, currency);
}

function formatFull(amount: number, currency: string): string {
  const code = (currency || '').trim().toUpperCase();
  // NEVER hard-fallback to EUR (task #217): render a symbol-less number
  // when the currency is unknown.
  if (!/^[A-Z]{3}$/.test(code)) {
    return new Intl.NumberFormat(getNumberLocale(), {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }
  try {
    return new Intl.NumberFormat(getNumberLocale(), {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toFixed(0)} ${code}`;
  }
}

function getBarColor(
  total: number,
  lowestTotal: number,
  highestTotal: number,
  bidCount: number,
): string {
  if (bidCount <= 1) return OTHER_COLOR;
  if (total === lowestTotal) return LOWEST_COLOR;
  if (total === highestTotal) return HIGHEST_COLOR;
  return OTHER_COLOR;
}

function niceNum(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * Math.pow(10, exponent);
}

function computeYAxis(maxValue: number): { min: number; max: number; step: number } {
  if (maxValue <= 0) return { min: 0, max: 100, step: 20 };
  const range = niceNum(maxValue * 1.15, false);
  const step = niceNum(range / TICK_COUNT, true);
  const max = Math.ceil(maxValue * 1.15 / step) * step;
  return { min: 0, max, step };
}

/* ── Component ─────────────────────────────────────────────────────────── */

export function BidComparisonChart({
  bidTotals,
  budgetTotal,
  currency,
}: BidComparisonChartProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [svgWidth, setSvgWidth] = useState(600);

  // A single value axis can only honestly compare bids quoted in the SAME
  // currency — plotting EUR and USD bars side by side on one axis labelled
  // with one currency silently treats 1 EUR = 1 USD. So we pick a single
  // "comparison currency" (the one carried by the most bids, falling back to
  // the project currency) and plot only those bids, surfacing a notice for
  // any bids excluded because they are in a different currency.
  const { chartCurrency, plottedBids, excludedCount, excludedCurrencies } =
    useMemo(() => {
      const norm = (c: string) => (c || '').trim().toUpperCase();
      const counts = new Map<string, number>();
      for (const b of bidTotals) {
        const c = norm(b.currency);
        if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      const projectCcy = norm(currency);
      let dominant = projectCcy;
      let best = -1;
      for (const [c, n] of counts) {
        if (n > best || (n === best && c === projectCcy)) {
          best = n;
          dominant = c;
        }
      }
      // When no bid carries a currency at all, fall back to plotting every
      // bid (legacy behavior) under the project currency label.
      const anyCurrency = counts.size > 0;
      const plotted = anyCurrency
        ? bidTotals.filter((b) => norm(b.currency) === dominant)
        : bidTotals;
      const excluded = bidTotals.length - plotted.length;
      const excludedCcys = anyCurrency
        ? [...new Set(bidTotals
            .filter((b) => norm(b.currency) !== dominant)
            .map((b) => norm(b.currency))
            .filter(Boolean))]
        : [];
      return {
        chartCurrency: anyCurrency ? dominant : projectCcy,
        plottedBids: plotted,
        excludedCount: excluded,
        excludedCurrencies: excludedCcys,
      };
    }, [bidTotals, currency]);

  const containerNodeRef = useRef<HTMLDivElement | null>(null);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    containerNodeRef.current = node;
    if (node) setSvgWidth(node.clientWidth);
  }, []);

  useEffect(() => {
    const node = containerNodeRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSvgWidth(entry.contentRect.width);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const { lowestTotal, highestTotal, yAxis, chartArea, bars, budgetY } = useMemo(() => {
    const allValues = plottedBids.map((b) => b.total);
    // Only a complete bid can be the lowest: one that left lines unpriced is
    // cheaper by exactly what it left out. A negative total, which the server
    // now refuses but an older bid may still carry, is a typing mistake and
    // never the lowest price. NaN matches no bar.
    const completeValues = plottedBids
      .filter((b) => unpricedLineCount(b) === 0 && b.total >= 0)
      .map((b) => b.total);
    const lowest = completeValues.length > 0 ? Math.min(...completeValues) : Number.NaN;
    const highest = allValues.length > 0 ? Math.max(...allValues) : 0;

    const maxVal = Math.max(highest, budgetTotal);
    const yAx = computeYAxis(maxVal);

    const area = {
      x: CHART_PADDING_LEFT,
      y: CHART_PADDING_TOP,
      width: svgWidth - CHART_PADDING_LEFT - CHART_PADDING_RIGHT,
      height: MIN_CHART_HEIGHT - CHART_PADDING_TOP - CHART_PADDING_BOTTOM,
    };

    const barCount = plottedBids.length;
    const totalBarWidth = barCount > 0 ? area.width / barCount : area.width;
    const barWidth = totalBarWidth * (1 - BAR_GAP_RATIO);
    const gapWidth = totalBarWidth * BAR_GAP_RATIO;

    const labels = barLabels(
      plottedBids.map((b) => b.company_name),
      totalBarWidth / LABEL_CHAR_PX,
    );
    const barsArr = plottedBids.map((bid, i) => {
      const scaled = yAx.max > 0 ? (Math.max(bid.total, 0) / yAx.max) * area.height : 0;
      const barHeight = Math.max(scaled, MIN_BAR_PX);
      return {
        x: area.x + i * totalBarWidth + gapWidth / 2,
        y: area.y + area.height - barHeight,
        width: Math.max(barWidth, 0),
        height: barHeight,
        label: labels[i] ?? { full: bid.company_name, lines: [bid.company_name] },
        bid,
      };
    });

    const budgetYPos =
      yAx.max > 0
        ? area.y + area.height - (budgetTotal / yAx.max) * area.height
        : area.y + area.height;

    return {
      lowestTotal: lowest,
      highestTotal: highest,
      yAxis: yAx,
      chartArea: area,
      bars: barsArr,
      budgetY: budgetYPos,
    };
  }, [plottedBids, budgetTotal, svgWidth]);

  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let v = yAxis.min; v <= yAxis.max; v += yAxis.step) {
      ticks.push(v);
    }
    return ticks;
  }, [yAxis]);

  if (plottedBids.length === 0) {
    return null;
  }

  return (
    <div className="mb-4">
      <h5 className="text-xs font-semibold text-content-secondary uppercase tracking-wider mb-3">
        {t('tendering.bid_totals_chart', 'Bid Totals Overview')}
        {chartCurrency && (
          <span className="ml-2 font-normal normal-case text-content-tertiary">
            ({chartCurrency})
          </span>
        )}
      </h5>
      {excludedCount > 0 && (
        <p className="mb-2 text-xs text-semantic-warning">
          {t('tendering.chart_mixed_currency', {
            defaultValue:
              '{{count}} bid(s) in {{currencies}} are not shown - bids in a different currency cannot be plotted on the {{base}} axis without conversion.',
            count: excludedCount,
            currencies: fmtList(excludedCurrencies),
            base: chartCurrency,
          })}
        </p>
      )}
      <div ref={containerRef} className="w-full">
        <svg
          ref={svgRef}
          width={svgWidth}
          height={MIN_CHART_HEIGHT - LEGEND_STRIP}
          className="select-none"
          role="img"
          aria-label={t('tendering.bid_comparison_chart_label', 'Bar chart comparing bid totals')}
        >
          {/* Y-axis grid lines and labels */}
          {yTicks.map((tick) => {
            const y =
              chartArea.y +
              chartArea.height -
              (yAxis.max > 0 ? (tick / yAxis.max) * chartArea.height : 0);
            return (
              <g key={tick}>
                <line
                  x1={chartArea.x}
                  y1={y}
                  x2={chartArea.x + chartArea.width}
                  y2={y}
                  stroke="var(--color-border-light, #e5e7eb)"
                  strokeWidth={1}
                />
                <text
                  x={chartArea.x - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="text-[10px]"
                  fill="var(--color-content-tertiary, #9ca3af)"
                >
                  {formatCompact(tick, chartCurrency)}
                </text>
              </g>
            );
          })}

          {/* Budget reference line */}
          {budgetTotal > 0 && (
            <g>
              <line
                x1={chartArea.x}
                y1={budgetY}
                x2={chartArea.x + chartArea.width}
                y2={budgetY}
                stroke="var(--oe-warning, #f59e0b)"
                strokeWidth={1.5}
                strokeDasharray="6 4"
              />
              <text
                x={chartArea.x + chartArea.width + 2}
                y={budgetY - 6}
                className="text-[10px] font-medium"
                fill="var(--oe-warning, #f59e0b)"
                textAnchor="end"
              >
                {t('tendering.budget', 'Budget')}
              </text>
            </g>
          )}

          {/* Bars */}
          {bars.map((bar, i) => {
            const color = getBarColor(
              bar.bid.total,
              lowestTotal,
              highestTotal,
              plottedBids.length,
            );
            const isHovered = hoveredIndex === i;
            const isLowest = plottedBids.length > 1 && bar.bid.total === lowestTotal;
            const isHighest = plottedBids.length > 1 && !isLowest && bar.bid.total === highestTotal;
            const rank = isLowest
              ? t('tendering.lowest', 'Lowest')
              : isHighest
                ? t('tendering.highest', 'Highest')
                : '';
            const tooltipText = `${bar.label.full}: ${formatFull(bar.bid.total, bar.bid.currency)}`;
            const tooltipWidth = Math.max(140, tooltipText.length * LABEL_CHAR_PX + 16);
            return (
              <g
                key={bar.bid.bid_id}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                className="cursor-pointer"
                data-testid="bid-chart-bar"
              >
                <title>{rank ? `${tooltipText} (${rank})` : tooltipText}</title>
                {/* Bar */}
                <rect
                  x={bar.x}
                  y={bar.y}
                  width={bar.width}
                  height={bar.height}
                  rx={3}
                  fill={color}
                  stroke={isLowest ? 'var(--color-content-primary, #1f2937)' : 'none'}
                  strokeWidth={isLowest ? 1.5 : 0}
                  opacity={isHovered ? 1 : 0.9}
                  className="transition-opacity duration-150"
                />

                {/* Amount and rank above the bar, so neither depends on colour */}
                <text
                  x={bar.x + bar.width / 2}
                  y={bar.y - 20}
                  textAnchor="middle"
                  className="text-[10px] font-semibold"
                  fill="var(--color-content-primary, #1f2937)"
                >
                  {formatCompact(bar.bid.total, chartCurrency)}
                  {rank ? ` \u00b7 ${rank}` : ''}
                </text>

                {/* Deviation label above bar */}
                <text
                  x={bar.x + bar.width / 2}
                  y={bar.y - 8}
                  textAnchor="middle"
                  className="text-[10px] font-semibold"
                  fill={
                    bar.bid.deviation_pct < -0.1
                      ? 'var(--oe-success, #15803d)'
                      : bar.bid.deviation_pct > 0.1
                        ? 'var(--oe-error, #dc2626)'
                        : 'var(--color-content-tertiary, #9ca3af)'
                  }
                >
                  {bar.bid.deviation_pct > 0 ? '+' : ''}
                  {fmtPercent(bar.bid.deviation_pct)}
                </text>

                {/* Company name on X axis, whole words on up to two lines */}
                {bar.label.lines.map((line, li) => (
                  <text
                    key={li}
                    x={bar.x + bar.width / 2}
                    y={chartArea.y + chartArea.height + 16 + li * 13}
                    textAnchor="middle"
                    className="text-[11px] font-medium"
                    fill="var(--color-content-primary, #1f2937)"
                  >
                    {line}
                  </text>
                ))}

                {/* Hover tooltip */}
                {isHovered && (
                  <g>
                    <rect
                      x={bar.x + bar.width / 2 - tooltipWidth / 2}
                      y={bar.y - 58}
                      width={tooltipWidth}
                      height={28}
                      rx={6}
                      fill="var(--color-surface-primary, #ffffff)"
                      stroke="var(--color-border, #d1d5db)"
                      strokeWidth={1}
                      filter="drop-shadow(0 2px 4px rgba(0,0,0,0.08))"
                    />
                    <text
                      x={bar.x + bar.width / 2}
                      y={bar.y - 40}
                      textAnchor="middle"
                      className="text-[11px] font-semibold"
                      fill="var(--color-content-primary, #1f2937)"
                    >
                      {tooltipText}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* X-axis base line */}
          <line
            x1={chartArea.x}
            y1={chartArea.y + chartArea.height}
            x2={chartArea.x + chartArea.width}
            y2={chartArea.y + chartArea.height}
            stroke="var(--color-border, #d1d5db)"
            strokeWidth={1}
          />

        </svg>
        {/* Legend. HTML rather than SVG text at fixed x offsets: a translated
            label is as long as its language makes it ("Niedrigstes" ran into
            "Höchstes"), and a flex row with a gap never overlaps. */}
        {(plottedBids.length > 1 || budgetTotal > 0) && (
          <div
            className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-content-secondary"
            style={{ paddingLeft: chartArea.x }}
            data-testid="bid-chart-legend"
          >
            {plottedBids.length > 1 && (
              <>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: LOWEST_COLOR }} />
                  {t('tendering.lowest', 'Lowest')}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: HIGHEST_COLOR }} />
                  {t('tendering.highest', 'Highest')}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: OTHER_COLOR }} />
                  {t('tendering.other', 'Other')}
                </span>
              </>
            )}
            {budgetTotal > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-5 border-t-[1.5px] border-dashed" style={{ borderColor: 'var(--oe-warning, #f59e0b)' }} />
                {t('tendering.budget_line', 'Budget')}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
