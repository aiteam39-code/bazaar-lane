import { RollingNumber } from './RollingNumber.jsx';
import { ProductCard } from './ProductCard.jsx';
import { WishlistHeart } from './WishlistHeart.jsx';
import { VariantPicker } from './VariantPicker.jsx';
import { QuantityStepper } from './QuantityStepper.jsx';
import { AddToCartButton } from './AddToCartButton.jsx';
import { CollectionAccordion } from './CollectionAccordion.jsx';
import { SkeletonCard } from './SkeletonCard.jsx';
import { FreeShippingMeter } from './FreeShippingMeter.jsx';
import { ToastStack, useToasts } from './ToastStack.jsx';
import { ConfirmButton } from './ConfirmButton.jsx';
import { OtpInput } from './OtpInput.jsx';
import { OrderTracker } from './OrderTracker.jsx';
import { StackedBars } from './StackedBars.jsx';
import { sound } from './sound';
import { art, artKinds } from './demo-art';
import { formatMoney } from './util';

const IK = {
  RollingNumber,
  ProductCard,
  WishlistHeart,
  VariantPicker,
  QuantityStepper,
  AddToCartButton,
  CollectionAccordion,
  SkeletonCard,
  FreeShippingMeter,
  ToastStack,
  useToasts,
  ConfirmButton,
  OtpInput,
  OrderTracker,
  StackedBars,
  sound,
  formatMoney,
  demo: { art, artKinds },
};

window.IK = Object.assign(window.IK || {}, IK);
