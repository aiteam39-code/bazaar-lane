'use client';
import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { cx, useControllable } from './util';
import { sound } from './sound';

const useIsoLayout = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Size or colour picker. A single selected pill glides between options and a
 * softer highlight follows the pointer. Sold-out options are struck through and skipped.
 */
export function VariantPicker({
  label = 'Size',
  options = [],
  value,
  defaultValue,
  onChange,
  kind = 'size',
  className,
}) {
  const firstAvailable = options.find((o) => !o.soldOut);
  const [val, setVal] = useControllable(value, defaultValue !== undefined ? defaultValue : firstAvailable && firstAvailable.value, onChange);
  const id = useId();
  const row = useRef(null);
  const refs = useRef({});
  const [sel, setSel] = useState(null);
  const [hov, setHov] = useState(null);

  const measure = useCallback((v) => {
    const el = refs.current[v];
    if (!el) return null;
    return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  }, []);

  useIsoLayout(() => {
    setSel(measure(val));
  }, [val, options, measure]);

  useEffect(() => {
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(() => setSel(measure(val)));
    if (!row.current || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setSel(measure(val)));
    ro.observe(row.current);
    return () => ro.disconnect();
  }, [val, measure]);

  const available = options.filter((o) => !o.soldOut);
  const choose = (o) => {
    if (o.soldOut || o.value === val) return;
    setVal(o.value);
    sound.play('tick');
  };
  const onKeyDown = (e) => {
    const i = available.findIndex((o) => o.value === val);
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = available[(i + 1) % available.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = available[(i - 1 + available.length) % available.length];
    else if (e.key === 'Home') next = available[0];
    else if (e.key === 'End') next = available[available.length - 1];
    if (next) {
      e.preventDefault();
      choose(next);
      const el = refs.current[next.value];
      if (el) el.focus();
    }
  };

  const selected = options.find((o) => o.value === val);
  const box = (m) => (m ? { transform: `translate(${m.x}px, ${m.y}px)`, width: m.w, height: m.h } : { opacity: 0 });

  return (
    <div className={cx('ik-vp', `ik-vp-${kind}`, className)}>
      <div className="ik-vp-head">
        <span className="ik-vp-label" id={`${id}-l`}>
          {label}
        </span>
        <span className="ik-vp-value" aria-hidden="true">
          {selected ? selected.label : ''}
        </span>
      </div>
      <div
        className="ik-vp-row"
        role="radiogroup"
        aria-labelledby={`${id}-l`}
        ref={row}
        onKeyDown={onKeyDown}
        onPointerLeave={() => setHov(null)}
      >
        {kind === 'size' && <span className="ik-vp-hover" style={box(hov)} aria-hidden="true" />}
        {kind === 'size' && <span className="ik-vp-sel" style={box(sel)} aria-hidden="true" />}
        {options.map((o) => {
          const on = o.value === val;
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[o.value] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={o.soldOut ? `${o.label}, sold out` : o.label}
              tabIndex={on ? 0 : -1}
              disabled={o.soldOut}
              className={cx('ik-vp-opt', on && 'is-on', o.soldOut && 'is-out')}
              style={o.swatch ? { '--sw': o.swatch } : undefined}
              onClick={() => choose(o)}
              onPointerEnter={() => !o.soldOut && setHov(measure(o.value))}
            >
              {kind === 'swatch' ? <span className="ik-vp-sw" aria-hidden="true" /> : o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
