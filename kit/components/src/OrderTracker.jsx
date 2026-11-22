'use client';
import React from 'react';
import { cx } from './util';
import { IconCheck } from './icons.jsx';

const DEFAULT_STEPS = [{ label: 'Ordered' }, { label: 'Packed' }, { label: 'Shipped' }, { label: 'Out for delivery' }, { label: 'Delivered' }];

/**
 * Live order status: a big ETA, a one-line status with a live dot, and a rail
 * that fills to the current step. Goes vertical under 440px of width.
 */
export function OrderTracker({
  steps = DEFAULT_STEPS,
  current = 0,
  eta,
  status,
  meta,
  className,
}) {
  const last = steps.length - 1;
  const at = Math.max(0, Math.min(last, current));
  const done = at === last;
  const progress = last > 0 ? at / last : 0;
  return (
    <section className={cx('ik-track-wrap', className)} aria-label="Order tracking">
      <div className={cx('ik-track', done && 'is-done')} style={{ '--n': steps.length, '--p': progress }}>
        <header className="ik-track-head">
          <div>
            <p className="ik-track-kicker">{done ? 'Delivered' : eta ? 'Arriving by' : 'Status'}</p>
            <p className="ik-track-eta">{done ? steps[last].time || 'Today' : eta || steps[at].label}</p>
          </div>
          {meta && <p className="ik-track-meta">{meta}</p>}
        </header>
        {status && (
          <p className="ik-track-status" aria-live="polite">
            {!done && <span className="ik-track-live" aria-hidden="true" />}
            <span>{status}</span>
          </p>
        )}
        <div className="ik-track-steps">
          <span className="ik-track-rail" aria-hidden="true">
            <span className="ik-track-fill" />
          </span>
          <ol className="ik-track-list">
            {steps.map((s, i) => (
              <li
                key={s.label}
                className={cx('ik-track-step', (i < at || done) && 'is-past', i === at && !done && 'is-now')}
                aria-current={i === at ? 'step' : undefined}
              >
                <span className="ik-track-dot" aria-hidden="true">
                  {(i < at || done) && <IconCheck />}
                </span>
                <span className="ik-track-text">
                  <span className="ik-track-label">{s.label}</span>
                  {s.time && <span className="ik-track-time">{s.time}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
