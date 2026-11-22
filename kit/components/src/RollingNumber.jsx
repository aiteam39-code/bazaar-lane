'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { cx } from './util';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

function Column({ digit, animateOnMount }) {
  const [shown, setShown] = useState(animateOnMount ? 0 : digit);
  useEffect(() => {
    if (shown === digit) return undefined;
    const id = requestAnimationFrame(() => setShown(digit));
    return () => cancelAnimationFrame(id);
  }, [digit, shown]);
  return (
    <span className="ik-roll-col">
      <span className="ik-roll-strip" style={{ '--d': shown }}>
        {DIGITS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </span>
    </span>
  );
}

/**
 * A number whose digits roll like an odometer when it changes.
 * Use for cart counts, totals, KPI headlines and anything a shopper watches change.
 */
export function RollingNumber({
  value,
  format,
  locale = 'en-IN',
  prefix = '',
  suffix = '',
  live = false,
  animateOnMount = true,
  className,
  style,
}) {
  const text = useMemo(() => {
    if (typeof format === 'function') return format(value);
    try {
      return new Intl.NumberFormat(locale, format || {}).format(value);
    } catch (e) {
      return String(value);
    }
  }, [value, format, locale]);
  const full = `${prefix}${text}${suffix}`;
  const chars = Array.from(full);
  const n = chars.length;
  return (
    <span className={cx('ik-roll', className)} style={style}>
      <span className="ik-sr" aria-live={live ? 'polite' : undefined}>
        {full}
      </span>
      <span className="ik-roll-vis" aria-hidden="true">
        {chars.map((ch, i) => {
          // Keyed from the right, so a new leading digit slides in without re-rolling the rest.
          const key = n - i;
          return /\d/.test(ch) ? (
            <Column key={`d${key}`} digit={Number(ch)} animateOnMount={animateOnMount} />
          ) : (
            <span className="ik-roll-sym" key={`s${key}`}>
              {ch}
            </span>
          );
        })}
      </span>
    </span>
  );
}
