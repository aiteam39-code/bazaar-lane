'use client';
import React, { useState } from 'react';
import { cx, useControllable } from './util';
import { RollingNumber } from './RollingNumber.jsx';
import { sound } from './sound';

const HEART =
  'M12 20.3s-7.4-4.5-9.1-9.2C1.8 8 3.7 4.6 7.1 4.6c2 0 3.5 1.1 4.9 2.9 1.4-1.8 2.9-2.9 4.9-2.9 3.4 0 5.3 3.4 4.2 6.5-1.7 4.7-9.1 9.2-9.1 9.2z';

/**
 * Save-to-wishlist heart. Pops and bursts on save, quietly empties on unsave.
 * `count` is shown as given; update it from onChange if you show one.
 */
export function WishlistHeart({
  pressed,
  defaultPressed = false,
  onChange,
  count,
  size = 'md',
  onMedia = false,
  label = 'Save to wishlist',
  className,
}) {
  const [on, setOn] = useControllable(pressed, defaultPressed, onChange);
  const [burst, setBurst] = useState(0);
  const toggle = () => {
    const next = !on;
    setOn(next);
    if (next) {
      setBurst((b) => b + 1);
      sound.play('tick');
    }
  };
  const name = count !== undefined ? `${label}, ${count} saved` : label;
  return (
    <button
      type="button"
      className={cx('ik-heart', `ik-heart-${size}`, onMedia && 'ik-heart-media', on && 'is-on', className)}
      aria-pressed={on}
      aria-label={name}
      onClick={toggle}
    >
      <span className="ik-heart-icon" key={burst} data-pop={burst > 0 && on ? '' : undefined}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d={HEART} />
        </svg>
        {burst > 0 && on && (
          <span className="ik-heart-burst" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <i key={i} style={{ '--a': `${i * 45}deg` }} />
            ))}
          </span>
        )}
      </span>
      {count !== undefined && <RollingNumber className="ik-heart-count" value={count} animateOnMount={false} />}
    </button>
  );
}
