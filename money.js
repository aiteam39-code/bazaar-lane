// money.js - money helpers.
// All money is whole paise (Rs 1 = 100 paise), so Rs 250 is stored as 25000.
// Never use decimals for money in code or in the database.
// Commission rates are basis points: 10% = 1000, 8% = 800.

// Turns whole rupees into paise (used for sample data and tests).
function rupees(wholeRupees) {
  return wholeRupees * 100;
}

// True when the value is a whole number of paise that is 0 or more.
function isMoney(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

// Shows paise as "Rs 250", or "Rs 250.50" when there are paise. Big numbers get Indian commas: Rs 1,20,000.
function formatMoney(paise) {
  const sign = paise < 0 ? '-' : '';
  const whole = Math.floor(Math.abs(paise) / 100);
  const rest = Math.abs(paise) % 100;
  const restText = rest === 0 ? '' : '.' + String(rest).padStart(2, '0');
  return sign + '₹' + whole.toLocaleString('en-IN') + restText; // like IK.formatMoney: ₹1,299, ₹1,24,580
}

// Commission = items total x rate / 10000, rounded to the nearest paisa (exactly half goes up).
function commissionFor(itemsTotal, rateBps) {
  return Math.floor((itemsTotal * rateBps + 5000) / 10000);
}

// Shows a rate in basis points as a percent: 1000 -> "10%", 850 -> "8.5%".
function formatRate(rateBps) {
  return rateBps / 100 + '%';
}

// Reads a price typed in rupees ("250", "250.5", "250.50" or the number 250.5) and returns paise (25000, 25050, 25050).
// Returns null for anything else: letters, a minus sign, more than 2 digits after the dot, more than 7 digits before it.
// No decimal maths is used: the text is split at the dot, so 0.1 + 0.2 style errors cannot happen.
function paiseFromRupeesText(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  if (!match) return null;
  const wholeRupees = Number(match[1]);
  const paise = Number((match[2] || '').padEnd(2, '0'));
  return wholeRupees * 100 + paise;
}

// A shop's shipping for its part of an order: free when its items total is MORE than the shop's free-shipping limit
// (a limit of Rs 499 means Rs 499 pays shipping and Rs 499.01 ships free). No limit means it always pays the fee.
function shippingFor(itemsTotal, shippingFee, freeShippingOver) {
  if (freeShippingOver !== null && freeShippingOver !== undefined && itemsTotal > freeShippingOver) return 0;
  return shippingFee;
}

// Which commission rate applies, in basis points: the shop's own rate if set, else its category's rate, else the default.
function pickCommissionRate(shopRateBps, categoryRateBps, defaultRateBps) {
  if (shopRateBps !== null && shopRateBps !== undefined) return shopRateBps;
  if (categoryRateBps !== null && categoryRateBps !== undefined) return categoryRateBps;
  return defaultRateBps;
}

module.exports = {
  rupees,
  isMoney,
  formatMoney,
  commissionFor,
  formatRate,
  paiseFromRupeesText,
  shippingFor,
  pickCommissionRate,
};
