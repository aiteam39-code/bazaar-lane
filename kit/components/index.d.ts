import type * as React from 'react';

/** Numbers: Intl options (formatted with `locale`, default en-IN) or your own formatter. */
export type NumberFormat = Intl.NumberFormatOptions | ((n: number) => string);

export interface RollingNumberProps {
  value: number;
  format?: NumberFormat;
  locale?: string;
  prefix?: string;
  suffix?: string;
  /** Announce changes to screen readers (polite). Default false. */
  live?: boolean;
  /** Roll up from zero on first render. Default true. */
  animateOnMount?: boolean;
  className?: string;
  style?: React.CSSProperties;
}
export declare function RollingNumber(props: RollingNumberProps): React.ReactElement;

export interface ProductCardProps {
  title: string;
  vendor?: string;
  /** Selling price in major units (rupees). */
  price: number;
  /** Original price; shows struck through with "% off" when higher than price. */
  compareAt?: number;
  /** [main photo, hover photo]. Second is optional. */
  images?: [string, string?] | string[];
  alt?: string;
  /** Short chip text: "New", "Only 2 left". Only true scarcity. */
  badge?: string;
  href?: string;
  wishlisted?: boolean;
  defaultWishlisted?: boolean;
  onWishlistChange?: (saved: boolean) => void;
  /** Return a promise to show the in-flight spinner; reject to show "Try again". */
  onAdd?: (e: React.MouseEvent) => void | Promise<unknown>;
  soldOut?: boolean;
  currency?: string;
  locale?: string;
  className?: string;
}
export declare function ProductCard(props: ProductCardProps): React.ReactElement;

export interface WishlistHeartProps {
  pressed?: boolean;
  defaultPressed?: boolean;
  onChange?: (saved: boolean) => void;
  /** Shown as given, rolling when it changes. Omit to hide. */
  count?: number;
  size?: 'sm' | 'md';
  /** Round surface chip for use on top of photos. */
  onMedia?: boolean;
  label?: string;
  className?: string;
}
export declare function WishlistHeart(props: WishlistHeartProps): React.ReactElement;

export interface VariantOption {
  value: string;
  label: string;
  soldOut?: boolean;
  /** Product colour for kind="swatch" (any CSS colour; it is content, not a token). */
  swatch?: string;
}
export interface VariantPickerProps {
  label?: string;
  options: VariantOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  kind?: 'size' | 'swatch';
  className?: string;
}
export declare function VariantPicker(props: VariantPickerProps): React.ReactElement;

export interface QuantityStepperProps {
  value?: number;
  defaultValue?: number;
  min?: number;
  max?: number;
  onChange?: (qty: number) => void;
  label?: string;
  /** Shown when the shopper pushes past max. Default "Max {max} per order". */
  maxHint?: string;
  size?: 'sm' | 'md';
  className?: string;
}
export declare function QuantityStepper(props: QuantityStepperProps): React.ReactElement;

export interface AddToCartButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  /** Return a promise to show the spinner; resolve = "Added", reject = "Try again". */
  onAdd?: (e: React.MouseEvent) => void | Promise<unknown>;
  label?: string;
  addedLabel?: string;
  errorLabel?: string;
  soldOut?: boolean;
  soldOutLabel?: string;
  tone?: 'accent' | 'ink';
  size?: 'sm' | 'md';
  block?: boolean;
}
export declare function AddToCartButton(props: AddToCartButtonProps): React.ReactElement;

export interface CollectionItem {
  id?: string;
  title: string;
  subtitle?: string;
  /** Photo URL; white text sits on a dark scrim over it. */
  image: string;
  href?: string;
  cta?: string;
}
export interface CollectionAccordionProps {
  items: CollectionItem[];
  defaultActive?: number;
  onSelect?: (item: CollectionItem, index: number) => void;
  /** Row height in px or any CSS length. Default 360. */
  height?: number | string;
  className?: string;
}
export declare function CollectionAccordion(props: CollectionAccordionProps): React.ReactElement;

export interface SkeletonCardProps {
  media?: boolean;
  lines?: number;
  /** CSS aspect-ratio of the media block. Default "4 / 5" (matches ProductCard). */
  aspect?: string;
  className?: string;
}
export declare function SkeletonCard(props: SkeletonCardProps): React.ReactElement;

export interface FreeShippingMeterProps {
  subtotal: number;
  threshold: number;
  currency?: string;
  locale?: string;
  unlockedLabel?: string;
  className?: string;
}
export declare function FreeShippingMeter(props: FreeShippingMeterProps): React.ReactElement;

export interface Toast {
  id?: string;
  title: string;
  body?: string;
  tone?: 'neutral' | 'success' | 'danger';
  /** Small product photo; shown when no tone icon is. */
  thumb?: string;
  action?: { label: string; onClick?: () => void };
  /** ms before it leaves; Infinity keeps it. Default: the stack's duration. */
  duration?: number;
}
export interface ToastStackProps {
  toasts: Array<Toast & { id: string }>;
  onDismiss?: (id: string) => void;
  placement?: 'bottom-right' | 'bottom-center' | 'inline';
  duration?: number;
  /** px each card behind peeks out. Default 12. */
  peek?: number;
  /** px between cards when open. Default 10. */
  gap?: number;
  /** Cards shown in the stack. Default 3. */
  visible?: number;
  className?: string;
}
export declare function ToastStack(props: ToastStackProps): React.ReactElement;
export declare function useToasts(): {
  toasts: Array<Toast & { id: string }>;
  push: (toast: Toast) => string;
  dismiss: (id: string) => void;
};

export interface ConfirmButtonProps {
  label?: string;
  confirmLabel?: string;
  /** Announced to screen readers when armed. */
  hint?: string;
  onConfirm?: () => void;
  /** ms before an unconfirmed press resets. Default 3000. */
  timeout?: number;
  className?: string;
}
export declare function ConfirmButton(props: ConfirmButtonProps): React.ReactElement;

export interface OtpInputProps {
  length?: number;
  value?: string;
  defaultValue?: string;
  onChange?: (code: string) => void;
  /** Fires once every box is filled. Verify, then set status. */
  onComplete?: (code: string) => void;
  status?: 'idle' | 'verifying' | 'error' | 'success';
  message?: React.ReactNode;
  label?: string;
  autoFocus?: boolean;
  className?: string;
}
export declare function OtpInput(props: OtpInputProps): React.ReactElement;

export interface TrackStep {
  label: string;
  /** "9:12 am", "Tue 14". Shown under the label. */
  time?: string;
}
export interface OrderTrackerProps {
  steps?: TrackStep[];
  /** Index of the step the order is at. */
  current?: number;
  /** "6:40 pm". Shown big while in transit. */
  eta?: string;
  /** One live line: "Ravi is 2.1 km away". */
  status?: string;
  /** Right-aligned line: order number, item count. */
  meta?: string;
  className?: string;
}
export declare function OrderTracker(props: OrderTrackerProps): React.ReactElement;

export interface BarSeries {
  key: string;
  label: string;
  /** 1 = chart-1 (darkest) … 3 = chart-3 (lightest). */
  tone?: 1 | 2 | 3;
}
export interface BarDataset {
  /** Toggle label: "Week". */
  label: string;
  /** Kicker after the title when nothing is hovered: "last 7 days". */
  caption?: string;
  bars: Array<{ label: string; values: Record<string, number> }>;
}
export interface StackedBarsProps {
  /** One entry per period; more than one shows the Day / Week toggle. */
  datasets: Record<string, BarDataset>;
  series: BarSeries[];
  defaultPeriod?: string;
  title?: string;
  /** Formats totals and legend values. Default: rupees, en-IN. */
  format?: (n: number) => string;
  /** Plot height in px including the x labels. Default 180. */
  height?: number;
  className?: string;
}
export declare function StackedBars(props: StackedBarsProps): React.ReactElement;

export declare const sound: {
  enable(): void;
  disable(): void;
  isEnabled(): boolean;
  play(name: 'tick' | 'add' | 'paid' | 'error', options?: { volume?: number }): void;
};
export declare function formatMoney(amount: number, options?: { currency?: string; locale?: string; decimals?: number }): string;

declare global {
  interface Window {
    IK: {
      RollingNumber: typeof RollingNumber;
      ProductCard: typeof ProductCard;
      WishlistHeart: typeof WishlistHeart;
      VariantPicker: typeof VariantPicker;
      QuantityStepper: typeof QuantityStepper;
      AddToCartButton: typeof AddToCartButton;
      CollectionAccordion: typeof CollectionAccordion;
      SkeletonCard: typeof SkeletonCard;
      FreeShippingMeter: typeof FreeShippingMeter;
      ToastStack: typeof ToastStack;
      useToasts: typeof useToasts;
      ConfirmButton: typeof ConfirmButton;
      OtpInput: typeof OtpInput;
      OrderTracker: typeof OrderTracker;
      StackedBars: typeof StackedBars;
      sound: typeof sound;
      formatMoney: typeof formatMoney;
      demo: { art(kind: 'mug' | 'tote' | 'lamp' | 'bottle' | 'bowl' | 'candle', options?: { alt?: boolean }): string; artKinds: string[] };
    };
  }
}
