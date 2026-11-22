'use client';
import React, { useState } from 'react';
import { cx } from './util';
import { IconArrow } from './icons.jsx';

/**
 * Category panels side by side; the one under the pointer (or focus) opens wide.
 * On touch, the first tap opens a panel and the second follows its link.
 * Under 480px of width the panels stack vertically.
 */
export function CollectionAccordion({ items = [], defaultActive = 0, onSelect, height = 360, className }) {
  const [active, setActive] = useState(defaultActive);
  const open = (i) => {
    if (i === active) return;
    setActive(i);
    if (onSelect) onSelect(items[i], i);
  };
  return (
    <div className={cx('ik-acc-wrap', className)}>
      <div className="ik-acc" style={{ '--ik-acc-h': typeof height === 'number' ? `${height}px` : height }}>
        {items.map((it, i) => {
          const on = i === active;
          return (
            <a
              key={it.id || it.title}
              href={it.href || '#'}
              className={cx('ik-acc-panel', on && 'is-on')}
              style={{ backgroundImage: `url("${it.image}")` }}
              onPointerEnter={(e) => {
                if (e.pointerType === 'mouse') open(i);
              }}
              onFocus={() => open(i)}
              onClick={(e) => {
                if (!on) {
                  e.preventDefault();
                  open(i);
                }
              }}
            >
              <span className="ik-acc-scrim" aria-hidden="true" />
              <span className="ik-acc-tab" aria-hidden={on || undefined}>
                {it.title}
              </span>
              <span className="ik-acc-body">
                <span className="ik-acc-title">{it.title}</span>
                {it.subtitle && <span className="ik-acc-sub">{it.subtitle}</span>}
                <span className="ik-acc-cta">
                  {it.cta || 'Shop the edit'}
                  <IconArrow />
                </span>
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
