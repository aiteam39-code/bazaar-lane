'use client';
import React, { useEffect, useId, useRef } from 'react';
import { cx, shake, useControllable, useReducedMotion } from './util';
import { sound } from './sound';

/**
 * One-time code boxes for phone login and checkout. Typing advances, Backspace
 * steps back, paste or SMS autofill fills every box. The parent sets `status`:
 * 'verifying' pulses, 'error' shakes, 'success' turns each box with a stagger.
 */
export function OtpInput({
  length = 6,
  value,
  defaultValue = '',
  onChange,
  onComplete,
  status = 'idle',
  message,
  label,
  autoFocus = false,
  className,
}) {
  const [code, setCode] = useControllable(value, defaultValue, onChange);
  const boxes = useRef([]);
  const row = useRef(null);
  const reduced = useReducedMotion();
  const id = useId();
  const digits = Array.from({ length }, (_, i) => code[i] || '');
  const locked = status === 'verifying' || status === 'success';

  useEffect(() => {
    if (status === 'error') {
      shake(row.current, reduced);
      sound.play('error');
    }
    if (status === 'success') sound.play('paid');
  }, [status, reduced]);

  const focusBox = (i) => {
    const el = boxes.current[Math.max(0, Math.min(length - 1, i))];
    if (el) el.focus();
  };

  const commit = (next) => {
    const clean = next.replace(/\D/g, '').slice(0, length);
    setCode(clean);
    if (clean.length === length && onComplete) onComplete(clean);
    return clean;
  };

  const onInput = (i, e) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) return;
    const pos = Math.min(i, code.length);
    if (raw.length > 1) {
      // Paste or SMS autofill landed in one box.
      const next = commit(code.slice(0, pos) + raw);
      focusBox(next.length);
      return;
    }
    const next = commit(code.slice(0, pos) + raw + code.slice(pos + 1));
    focusBox(Math.min(pos + 1, next.length));
  };

  const onKeyDown = (i, e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (digits[i]) commit(code.slice(0, i) + code.slice(i + 1));
      else if (i > 0) {
        commit(code.slice(0, i - 1) + code.slice(i));
        focusBox(i - 1);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusBox(i - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusBox(Math.min(i + 1, code.length));
    }
  };

  const onPaste = (e) => {
    const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
    const clean = text.replace(/\D/g, '');
    if (!clean) return;
    e.preventDefault();
    const next = commit(clean);
    focusBox(next.length);
  };

  return (
    <div className={cx('ik-otp', `is-${status}`, className)}>
      <span className="ik-otp-label" id={`${id}-l`}>
        {label || `Enter the ${length}-digit code`}
      </span>
      <div
        className="ik-otp-row"
        role="group"
        aria-labelledby={`${id}-l`}
        aria-describedby={message ? `${id}-m` : undefined}
        ref={row}
        onPaste={onPaste}
      >
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              boxes.current[i] = el;
            }}
            className={cx('ik-otp-box', d && 'is-filled')}
            style={{ '--i': i }}
            value={d}
            onChange={(e) => onInput(i, e)}
            onKeyDown={(e) => onKeyDown(i, e)}
            onFocus={(e) => e.target.select()}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={length}
            aria-label={`Digit ${i + 1} of ${length}`}
            aria-invalid={status === 'error' || undefined}
            readOnly={locked}
            autoFocus={autoFocus && i === 0}
          />
        ))}
      </div>
      <p className="ik-otp-msg" id={`${id}-m`} aria-live="polite">
        {message}
      </p>
    </div>
  );
}
