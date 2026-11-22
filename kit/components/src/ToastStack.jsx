'use client';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cx } from './util';
import { IconAlert, IconCheckCircle, IconClose } from './icons.jsx';

const useIsoLayout = typeof window === 'undefined' ? useEffect : useLayoutEffect;
let seq = 0;

/** Toast list state: const { toasts, push, dismiss } = useToasts(); */
export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((toast) => {
    seq += 1;
    const id = toast.id || `t${seq}`;
    setToasts((list) => [{ ...toast, id }, ...list.filter((t) => t.id !== id)].slice(0, 6));
    return id;
  }, []);
  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  return { toasts, push, dismiss };
}

/**
 * Toasts stacked into one card with the two behind peeking out above it.
 * Point at the stack (or tab into it) and it springs apart into a list;
 * timers pause while it is open. Newest first.
 */
export function ToastStack({
  toasts = [],
  onDismiss,
  placement = 'bottom-right',
  duration = 5000,
  peek = 12,
  gap = 10,
  visible = 3,
  className,
}) {
  const [open, setOpen] = useState(false);
  const nodes = useRef({});
  const [heights, setHeights] = useState({});
  const timers = useRef({});

  // Natural height of every toast, so the open list can space them exactly.
  useIsoLayout(() => {
    const next = {};
    toasts.forEach((t) => {
      const el = nodes.current[t.id];
      if (el) next[t.id] = el.scrollHeight;
    });
    setHeights(next);
  }, [toasts]);

  // One timer per toast; time spent open does not count.
  useEffect(() => {
    const now = Date.now();
    toasts.forEach((t) => {
      if (!timers.current[t.id]) timers.current[t.id] = { left: t.duration !== undefined ? t.duration : duration, start: now, handle: null };
    });
    Object.keys(timers.current).forEach((tid) => {
      if (!toasts.some((t) => t.id === tid)) {
        clearTimeout(timers.current[tid].handle);
        delete timers.current[tid];
      }
    });
    Object.entries(timers.current).forEach(([tid, tm]) => {
      if (open || tm.left === Infinity || !onDismiss) return;
      tm.start = Date.now();
      tm.handle = setTimeout(() => onDismiss(tid), Math.max(0, tm.left));
    });
    return () => {
      Object.values(timers.current).forEach((tm) => {
        if (tm.handle) {
          clearTimeout(tm.handle);
          tm.left -= Date.now() - tm.start;
          tm.handle = null;
        }
      });
    };
  }, [toasts, open, duration, onDismiss]);

  const front = toasts[0] ? heights[toasts[0].id] || 64 : 0;
  const shown = toasts.slice(0, visible);
  let offset = 0;
  const layout = shown.map((t, i) => {
    const h = heights[t.id] || front;
    const y = open ? -offset : -peek * i;
    offset += h + gap;
    return { y, h: open ? h : front, scale: open ? 1 : 1 - 0.05 * i };
  });
  const listHeight = !toasts.length ? 0 : open ? offset - gap : front + peek * (shown.length - 1);

  return (
    <section
      className={cx('ik-toasts', `ik-toasts-${placement}`, open && 'is-open', className)}
      aria-label="Notifications"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <ol className="ik-toasts-list" style={{ height: listHeight }} aria-live="polite" aria-relevant="additions">
        {toasts.map((t, i) => {
          const l = layout[i];
          const hiddenToast = !l;
          return (
            <li
              key={t.id}
              className={cx('ik-toast', `ik-toast-${t.tone || 'neutral'}`, i > 0 && !open && 'is-behind', hiddenToast && 'is-hidden')}
              style={
                hiddenToast
                  ? undefined
                  : { transform: `translateY(${l.y}px) scale(${l.scale})`, height: l.h, zIndex: 20 - i }
              }
            >
              <div
                className="ik-toast-inner"
                ref={(el) => {
                  nodes.current[t.id] = el;
                }}
              >
                {t.tone === 'success' && <IconCheckCircle className="ik-toast-icon" />}
                {t.tone === 'danger' && <IconAlert className="ik-toast-icon" />}
                {t.thumb && !t.tone && <img className="ik-toast-thumb" src={t.thumb} alt="" />}
                <div className="ik-toast-text">
                  <p className="ik-toast-title">{t.title}</p>
                  {t.body && <p className="ik-toast-body">{t.body}</p>}
                </div>
                {t.action && (
                  <button
                    type="button"
                    className="ik-toast-action"
                    onClick={() => {
                      if (t.action.onClick) t.action.onClick();
                      if (onDismiss) onDismiss(t.id);
                    }}
                  >
                    {t.action.label}
                  </button>
                )}
                <button type="button" className="ik-toast-close" aria-label="Dismiss" onClick={() => onDismiss && onDismiss(t.id)}>
                  <IconClose />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
