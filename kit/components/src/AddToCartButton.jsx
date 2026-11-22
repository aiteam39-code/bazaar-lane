'use client';
import React, { useEffect, useRef, useState } from 'react';
import { cx, shake, useReducedMotion } from './util';
import { sound } from './sound';

/**
 * The add-to-bag button. Plus becomes a spinner while the add is in flight,
 * then draws a tick and says "Added"; a failed add shakes and offers "Try again".
 * Width never jumps: every label shares one grid cell.
 */
export function AddToCartButton({
  onAdd,
  label = 'Add to bag',
  addedLabel = 'Added',
  errorLabel = 'Try again',
  soldOut = false,
  soldOutLabel = 'Sold out',
  tone = 'accent',
  size = 'md',
  block = false,
  disabled = false,
  className,
  ...rest
}) {
  const [state, setState] = useState('idle'); // idle | busy | done | error
  const timer = useRef();
  const btn = useRef();
  const reduced = useReducedMotion();
  useEffect(() => () => clearTimeout(timer.current), []);

  const settle = (next) => {
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), next === 'done' ? 1800 : 2400);
    if (next === 'done') sound.play('add');
    if (next === 'error') {
      sound.play('error');
      shake(btn.current, reduced);
    }
  };

  const handle = async (e) => {
    if (state === 'busy' || soldOut || disabled) return;
    let result;
    try {
      result = onAdd ? onAdd(e) : undefined;
    } catch (err) {
      settle('error');
      return;
    }
    if (result && typeof result.then === 'function') {
      setState('busy');
      try {
        await result;
        settle('done');
      } catch (err) {
        settle('error');
      }
    } else {
      settle('done');
    }
  };

  const shown = soldOut ? 'soldout' : state;
  const announce = state === 'done' ? addedLabel : state === 'error' ? errorLabel : '';
  return (
    <>
      <button
        type="button"
        {...rest}
        ref={btn}
        className={cx('ik-atc', `ik-atc-${tone}`, `ik-atc-${size}`, block && 'ik-atc-block', `is-${shown}`, className)}
        onClick={handle}
        disabled={disabled || soldOut}
        aria-busy={state === 'busy' || undefined}
      >
        {!soldOut && (
          <span className="ik-atc-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path className="ik-atc-v" d="M12 5.5v13" />
              <path className="ik-atc-h" d="M5.5 12h13" />
              <path className="ik-atc-tick" d="M5.5 12.5l4.2 4.2L18.5 8" />
            </svg>
            <span className="ik-atc-spin" />
          </span>
        )}
        <span className="ik-atc-labels">
          <span className="ik-atc-l" data-k="idle">{label}</span>
          <span className="ik-atc-l" data-k="done">{addedLabel}</span>
          <span className="ik-atc-l" data-k="error">{errorLabel}</span>
          <span className="ik-atc-l" data-k="soldout">{soldOutLabel}</span>
        </span>
      </button>
      <span className="ik-sr" aria-live="polite">
        {announce}
      </span>
    </>
  );
}
