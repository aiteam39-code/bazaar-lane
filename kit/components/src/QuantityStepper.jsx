'use client';
import React, { useRef, useState } from 'react';
import { cx, shake, useControllable, useReducedMotion } from './util';
import { RollingNumber } from './RollingNumber.jsx';
import { IconMinus, IconPlus } from './icons.jsx';
import { sound } from './sound';

/**
 * Quantity control. The count rolls; pushing past min or max nudges instead of
 * failing silently, and past max it says why.
 */
export function QuantityStepper({
  value,
  defaultValue = 1,
  min = 1,
  max = 10,
  onChange,
  label = 'Quantity',
  maxHint,
  size = 'md',
  className,
}) {
  const [qty, setQty] = useControllable(value, defaultValue, onChange);
  const [hint, setHint] = useState('');
  const num = useRef(null);
  const reduced = useReducedMotion();

  const step = (delta) => {
    const next = qty + delta;
    if (next < min || next > max) {
      shake(num.current, reduced);
      setHint(next > max ? maxHint || `Max ${max} per order` : '');
      sound.play('error');
      return;
    }
    setHint('');
    setQty(next);
    sound.play('tick');
  };

  return (
    <div className={cx('ik-qty', `ik-qty-${size}`, className)}>
      <div className="ik-qty-box" role="group" aria-label={label}>
        <button
          type="button"
          className="ik-qty-btn"
          aria-label={`Decrease ${label.toLowerCase()}`}
          aria-disabled={qty <= min || undefined}
          onClick={() => step(-1)}
        >
          <IconMinus />
        </button>
        <span className="ik-qty-val" ref={num}>
          <RollingNumber value={qty} animateOnMount={false} live />
        </span>
        <button
          type="button"
          className="ik-qty-btn"
          aria-label={`Increase ${label.toLowerCase()}`}
          aria-disabled={qty >= max || undefined}
          onClick={() => step(1)}
        >
          <IconPlus />
        </button>
      </div>
      <span className="ik-qty-hint" aria-live="polite">
        {hint}
      </span>
    </div>
  );
}
