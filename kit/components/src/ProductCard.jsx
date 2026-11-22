'use client';
import React from 'react';
import { cx, formatMoney } from './util';
import { WishlistHeart } from './WishlistHeart.jsx';
import { AddToCartButton } from './AddToCartButton.jsx';

/**
 * Product tile for grids. Hover shows the second photo and slides up Quick add;
 * on touch screens Quick add is always visible. The whole card links to `href`.
 */
export function ProductCard({
  title,
  vendor,
  price,
  compareAt,
  images = [],
  alt,
  badge,
  href = '#',
  wishlisted,
  defaultWishlisted,
  onWishlistChange,
  onAdd,
  soldOut = false,
  currency = 'INR',
  locale = 'en-IN',
  className,
}) {
  const [first, second] = images;
  const off = compareAt && compareAt > price ? Math.round((1 - price / compareAt) * 100) : 0;
  const money = (n) => formatMoney(n, { currency, locale });
  return (
    <article className={cx('ik-card', second && 'has-alt', soldOut && 'is-soldout', className)}>
      <div className="ik-card-media">
        {first && <img className="ik-card-img" src={first} alt={alt || title} loading="lazy" decoding="async" />}
        {second && (
          <img className="ik-card-img ik-card-img-alt" src={second} alt="" aria-hidden="true" loading="lazy" decoding="async" />
        )}
        {(badge || soldOut) && <span className="ik-chip ik-card-badge">{soldOut ? 'Sold out' : badge}</span>}
        <span className="ik-card-heart">
          <WishlistHeart
            size="sm"
            onMedia
            pressed={wishlisted}
            defaultPressed={defaultWishlisted}
            onChange={onWishlistChange}
            label={`Save ${title}`}
          />
        </span>
        {!soldOut && (
          <div className="ik-card-quick">
            <AddToCartButton size="sm" tone="ink" block label="Quick add" onAdd={onAdd} aria-label={`Quick add ${title}`} />
          </div>
        )}
      </div>
      <div className="ik-card-body">
        {vendor && <p className="ik-card-vendor">{vendor}</p>}
        <h3 className="ik-card-title">
          <a href={href}>{title}</a>
        </h3>
        <p className="ik-card-price">
          <span className="ik-price">{money(price)}</span>
          {off > 0 && (
            <>
              <s className="ik-card-compare">
                <span className="ik-sr">was </span>
                {money(compareAt)}
              </s>
              <span className="ik-card-off">{off}% off</span>
            </>
          )}
        </p>
      </div>
    </article>
  );
}
