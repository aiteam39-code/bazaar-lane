'use client';
import React, { useEffect, useRef, useState } from 'react';
import { cx, formatMoney } from './util';
import { RollingNumber } from './RollingNumber.jsx';
import { IconCheck } from './icons.jsx';
import { sound } from './sound';

/**
 * "Add ₹350 more for free delivery" with a bar that fills as the cart grows.
 * The remaining amount rolls; crossing the line sweeps a shine and swaps to a tick.
 */
export function FreeShippingMeter({
  subtotal,
  threshold,
  currency = 'INR',
  locale = 'en-IN',
  unlockedLabel = 'Free delivery unlocked',
  className,
}) {
  const ratio = threshold > 0 ? Math.max(0, Math.min(1, subtotal / threshold)) : 1;
  const left = Math.max(0, threshold - subtotal);
  const done = left <= 0;
  const was = useRef(done);
  const [shine, setShine] = useState(0);

  useEffect(() => {
    if (done && !was.current) {
      setShine((s) => s + 1);
      sound.play('paid');
    }
    was.current = done;
  }, [done]);

  const leftText = formatMoney(left, { currency, locale });
  return (
    <div className={cx('ik-ship', done && 'is-done', className)}>
      <p className="ik-ship-msg" aria-live="polite">
        {done ? (
          <>
            <span className="ik-ship-tick" aria-hidden="true">
              <IconCheck />
            </span>
            <span>{unlockedLabel}</span>
          </>
        ) : (
          <>
            <span>Add</span>
            <RollingNumber
              className="ik-ship-left"
              value={left}
              locale={locale}
              format={{ style: 'currency', currency, maximumFractionDigits: 0 }}
              animateOnMount={false}
            />
            <span>more for free delivery</span>
          </>
        )}
      </p>
      <div
        className="ik-ship-track"
        role="progressbar"
        aria-label="Progress to free delivery"
        aria-valuemin={0}
        aria-valuemax={threshold}
        aria-valuenow={Math.min(subtotal, threshold)}
        aria-valuetext={done ? unlockedLabel : `${leftText} to go`}
      >
        <span className="ik-ship-fill" style={{ width: `${ratio * 100}%` }} />
        {shine > 0 && <span className="ik-ship-shine" key={shine} aria-hidden="true" />}
      </div>
    </div>
  );
}
