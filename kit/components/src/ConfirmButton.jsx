'use client';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cx } from './util';
import { IconTrash } from './icons.jsx';

const useIsoLayout = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Two-step destructive action. The first press widens the button into a question
 * ("Remove item?") with a draining timer; the second press confirms.
 * Escape, blur or the timer running out puts it back.
 */
export function ConfirmButton({
  label = 'Remove',
  confirmLabel = 'Remove item?',
  hint = 'Press again to confirm',
  onConfirm,
  timeout = 3000,
  className,
}) {
  const [armed, setArmed] = useState(false);
  const [widths, setWidths] = useState(null);
  const timer = useRef();
  const idle = useRef(null);
  const ask = useRef(null);

  useIsoLayout(() => {
    const measure = () => {
      if (idle.current && ask.current) setWidths({ idle: idle.current.offsetWidth, armed: ask.current.offsetWidth });
    };
    measure();
    // Web fonts can arrive after first paint and change label widths.
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  }, [label, confirmLabel]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const disarm = () => {
    clearTimeout(timer.current);
    setArmed(false);
  };
  const press = () => {
    if (!armed) {
      setArmed(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setArmed(false), timeout);
      return;
    }
    disarm();
    if (onConfirm) onConfirm();
  };

  return (
    <span className="ik-confirm-wrap">
      <button
        type="button"
        className={cx('ik-confirm', armed && 'is-armed', className)}
        style={{ width: widths ? (armed ? widths.armed : widths.idle) : undefined, '--t': `${timeout}ms` }}
        onClick={press}
        onBlur={disarm}
        onKeyDown={(e) => {
          if (e.key === 'Escape') disarm();
        }}
      >
        <IconTrash />
        <span className="ik-confirm-text">{armed ? confirmLabel : label}</span>
        {armed && <span className="ik-confirm-timer" aria-hidden="true" />}
      </button>
      <span className="ik-sr" aria-live="polite">
        {armed ? hint : ''}
      </span>
      <span className="ik-confirm-measure" aria-hidden="true">
        <span className="ik-confirm" ref={idle}>
          <IconTrash />
          <span className="ik-confirm-text">{label}</span>
        </span>
        <span className="ik-confirm" ref={ask}>
          <IconTrash />
          <span className="ik-confirm-text">{confirmLabel}</span>
        </span>
      </span>
    </span>
  );
}
