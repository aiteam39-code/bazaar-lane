'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Join class names, skipping falsy values. */
export const cx = (...names) => names.filter(Boolean).join(' ');

/** True when the visitor asked the OS for reduced motion. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    if (mq.addEventListener) mq.addEventListener('change', update);
    else mq.addListener(update);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', update);
      else mq.removeListener(update);
    };
  }, []);
  return reduced;
}

/** Controlled when `value` is given, uncontrolled otherwise. */
export function useControllable(value, defaultValue, onChange) {
  const [inner, setInner] = useState(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : inner;
  const latest = useRef(current);
  latest.current = current;
  const set = useCallback(
    (next) => {
      const resolved = typeof next === 'function' ? next(latest.current) : next;
      if (!controlled) setInner(resolved);
      if (onChange) onChange(resolved);
    },
    [controlled, onChange]
  );
  return [current, set];
}

/** Rupees by default, Indian digit grouping (1,24,580). */
export function formatMoney(amount, { currency = 'INR', locale = 'en-IN', decimals = 0 } = {}) {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount);
  } catch (e) {
    return '₹' + Math.round(amount).toLocaleString();
  }
}

/** A short horizontal shake through the Web Animations API (skipped for reduced motion). */
export function shake(el, reduced) {
  if (!el || reduced || !el.animate) return;
  el.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-6px)' },
      { transform: 'translateX(5px)' },
      { transform: 'translateX(-3px)' },
      { transform: 'translateX(2px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 380, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
  );
}
