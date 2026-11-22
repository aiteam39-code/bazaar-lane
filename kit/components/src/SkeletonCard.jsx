'use client';
import React from 'react';
import { cx } from './util';

/**
 * Loading stand-in shaped like a ProductCard, with a slow shimmer.
 * Put the grid that holds these in aria-busy="true" with a hidden "Loading products" status.
 */
export function SkeletonCard({ media = true, lines = 2, aspect = '4 / 5', className }) {
  return (
    <div className={cx('ik-skel', className)} aria-hidden="true">
      {media && <span className="ik-skel-block ik-skel-media" style={{ aspectRatio: aspect }} />}
      <span className="ik-skel-block ik-skel-line" style={{ width: '42%' }} />
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="ik-skel-block ik-skel-line" style={{ width: i === lines - 1 ? '58%' : '88%' }} />
      ))}
    </div>
  );
}
