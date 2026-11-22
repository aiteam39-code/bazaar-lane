'use client';
import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { cx, formatMoney } from './util';
import { RollingNumber } from './RollingNumber.jsx';

const useIsoLayout = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Two-to-four-option toggle with a gliding thumb (used for Day / Week). */
function Segmented({ options, value, onChange, label }) {
  const refs = useRef({});
  const [thumb, setThumb] = useState(null);
  const measure = useCallback(() => {
    const el = refs.current[value];
    if (el) setThumb({ x: el.offsetLeft, w: el.offsetWidth });
  }, [value]);
  useIsoLayout(measure, [measure, options]);
  useEffect(() => {
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  }, [measure]);
  return (
    <div className="ik-seg" role="tablist" aria-label={label}>
      <span className="ik-seg-thumb" style={thumb ? { transform: `translateX(${thumb.x}px)`, width: thumb.w } : { opacity: 0 }} aria-hidden="true" />
      {options.map((o) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[o.value] = el;
          }}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={cx('ik-seg-opt', o.value === value && 'is-on')}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Seller revenue chart: stacked bars by channel. Point at a bar (or focus it) and the
 * headline number scrubs to that bar's total while the legend shows its breakdown.
 */
export function StackedBars({
  datasets,
  series,
  defaultPeriod,
  title = 'Revenue',
  format,
  height = 180,
  className,
}) {
  const periods = Object.keys(datasets || {});
  const [period, setPeriod] = useState(defaultPeriod || periods[0]);
  const [hover, setHover] = useState(null);
  const id = useId();
  const ds = datasets[period];
  const fmt = format || ((n) => formatMoney(n));
  const totals = ds.bars.map((b) => series.reduce((sum, s) => sum + (b.values[s.key] || 0), 0));
  const max = Math.max(1, ...totals);
  const grand = totals.reduce((a, b) => a + b, 0);
  const focusBar = hover !== null ? ds.bars[hover] : null;
  const seriesValue = (s) =>
    focusBar ? focusBar.values[s.key] || 0 : ds.bars.reduce((sum, b) => sum + (b.values[s.key] || 0), 0);

  return (
    <section className={cx('ik-bars', className)} aria-labelledby={`${id}-t`}>
      <header className="ik-bars-head">
        <div>
          <p className="ik-bars-kicker" id={`${id}-t`}>
            {title} · {focusBar ? focusBar.label : ds.caption || ds.label}
          </p>
          <RollingNumber className="ik-bars-total" value={hover !== null ? totals[hover] : grand} format={fmt} animateOnMount={false} />
        </div>
        {periods.length > 1 && (
          <Segmented
            label="Period"
            options={periods.map((p) => ({ value: p, label: datasets[p].label }))}
            value={period}
            onChange={(p) => {
              setPeriod(p);
              setHover(null);
            }}
          />
        )}
      </header>
      <div className="ik-bars-plot" style={{ height }} onPointerLeave={() => setHover(null)}>
        {ds.bars.map((b, i) => (
          <button
            key={`${period}-${b.label}`}
            type="button"
            className={cx('ik-bars-col', hover === i && 'is-on', hover !== null && hover !== i && 'is-dim')}
            style={{ '--i': i }}
            onPointerEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            aria-label={`${b.label}: ${fmt(totals[i])}. ${series.map((s) => `${s.label} ${fmt(b.values[s.key] || 0)}`).join(', ')}`}
          >
            <span className="ik-bars-stack" style={{ height: `${(totals[i] / max) * 100}%` }}>
              {series.map((s) => {
                const v = b.values[s.key] || 0;
                return v > 0 ? <span key={s.key} className={`ik-bars-seg ik-c${s.tone || 1}`} style={{ flexGrow: v }} /> : null;
              })}
            </span>
            <span className="ik-bars-x" aria-hidden="true">
              {b.label}
            </span>
          </button>
        ))}
      </div>
      <ul className="ik-bars-legend">
        {series.map((s) => (
          <li key={s.key}>
            <span className={`ik-bars-key ik-c${s.tone || 1}`} aria-hidden="true" />
            <span className="ik-bars-name">{s.label}</span>
            <span className="ik-bars-val">{fmt(seriesValue(s))}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
