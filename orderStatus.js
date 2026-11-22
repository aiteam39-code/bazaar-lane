// orderStatus.js - the ONE place where the status of a seller order (one shop's part of an order) changes.
// Every route that changes a status calls changeStatus(). It checks the move is allowed and who may make it,
// refuses anything else with a clear message, and writes the new status, who made it and the time into status_log.
const { db, nowIso } = require('./db');
const { HttpError } = require('./auth');

// Every allowed move, exactly as in CLAUDE.md. A status only moves forward along this table: it never skips a step
// and never goes back. "who" can be:
//   system   - the server itself (payments, sector 4)
//   customer - the person with the tracking link of that order
//   seller   - ONLY the shop that owns that order
//   admin    - the admin
// "needs" lists what must be given with the move.
const MOVES = [
  { from: 'pending_payment', to: 'placed',    who: ['system'] },
  { from: 'pending_payment', to: 'cancelled', who: ['system'] },
  { from: 'placed',          to: 'accepted',  who: ['seller'] },
  { from: 'placed',          to: 'rejected',  who: ['seller'], needs: ['reason'] },
  { from: 'placed',          to: 'cancelled', who: ['customer', 'admin'] },
  { from: 'accepted',        to: 'packed',    who: ['seller'] },
  { from: 'accepted',        to: 'cancelled', who: ['admin'], needs: ['reason'] },
  { from: 'packed',          to: 'shipped',   who: ['seller'], needs: ['courier', 'tracking_number'] },
  { from: 'packed',          to: 'cancelled', who: ['admin'], needs: ['reason'] },
  { from: 'shipped',         to: 'delivered', who: ['seller', 'admin'] },
];

// The statuses, in plain words for messages.
const STATUS_WORDS = {
  pending_payment: 'waiting for payment',
  placed: 'placed',
  accepted: 'accepted',
  packed: 'packed',
  shipped: 'shipped',
  delivered: 'delivered',
  rejected: 'rejected',
  cancelled: 'cancelled',
};

const WHO_WORDS = { system: 'the system', customer: 'the customer', seller: 'the shop', admin: 'the admin' };

const ACTION_WORDS = {
  placed: 'place it',
  accepted: 'accept it',
  rejected: 'reject it',
  packed: 'mark it packed',
  shipped: 'mark it shipped',
  delivered: 'mark it delivered',
  cancelled: 'cancel it',
};

// ---------- A new order ----------

// The first status of a new seller order: Cash on delivery is placed straight away; online payment waits (sector 4).
function firstStatusFor(paymentMethod) {
  return paymentMethod === 'cod' ? 'placed' : 'pending_payment';
}

// Writes the first status of a brand-new seller order into status_log. Only checkout calls this, inside its transaction.
// The customer made it, by placing the order.
function logFirstStatus(sellerOrderId, status) {
  if (status !== 'placed' && status !== 'pending_payment') throw new Error(`A new order cannot start as ${status}.`);
  db.prepare('INSERT INTO status_log (seller_order_id, status, by_role, at) VALUES (?, ?, ?, ?)')
    .run(sellerOrderId, status, 'customer', nowIso());
}

// ---------- Changing a status ----------

// Moves one seller order to newStatus.
//   who:     { role: 'system' | 'customer' | 'seller' | 'admin', sellerId (for a seller), customerOrderId (for a customer) }
//   details: { reason, courier, tracking_number } when the move needs them
// Returns the seller order as it is now. Throws an HttpError with a plain message when the move is not allowed.
// Everything happens in one transaction: the status, the status_log line and (for rejected or cancelled)
// putting the stock back all happen together, or not at all.
function changeStatus(sellerOrderId, newStatus, who, details = {}) {
  return changeStatusInOneGo.immediate(sellerOrderId, newStatus, who, details || {});
}

const changeStatusInOneGo = db.transaction((sellerOrderId, newStatus, who, details) => {
  checkWho(who);
  if (!Object.hasOwn(STATUS_WORDS, String(newStatus))) throw new HttpError(400, 'That is not a status an order can have.');
  const order = findOrderFor(sellerOrderId, who);
  const move = findMove(order.status, newStatus);
  checkWhoMayMakeIt(move, who);
  const given = readWhatTheMoveNeeds(move, details, who);

  const now = nowIso();
  const result = db.prepare(`
    UPDATE seller_orders
    SET status = ?, reason = COALESCE(?, reason), courier = COALESCE(?, courier),
        tracking_number = COALESCE(?, tracking_number), updated_at = ?
    WHERE id = ? AND status = ?`)
    .run(newStatus, given.reason, given.courier, given.tracking_number, now, order.id, order.status);
  if (result.changes !== 1) throw new HttpError(409, 'This order just changed. Please look again.');
  db.prepare('INSERT INTO status_log (seller_order_id, status, by_role, at) VALUES (?, ?, ?, ?)')
    .run(order.id, newStatus, who.role, now);

  // A rejected or cancelled part gives its items back to the shop's stock. These statuses are final,
  // so this can only ever happen once for a seller order.
  if (newStatus === 'rejected' || newStatus === 'cancelled') putStockBack(order.id);
  return db.prepare('SELECT * FROM seller_orders WHERE id = ?').get(order.id);
});

// A mistake in the code (not in what a person did): stop loudly.
function checkWho(who) {
  if (!who || !Object.hasOwn(WHO_WORDS, who.role)) throw new Error('changeStatus needs who.role: system, customer, seller or admin.');
}

// Finds the seller order. A customer may only touch a part of their own order (else "does not exist"),
// and a seller only their own shop's part (else 403).
function findOrderFor(sellerOrderId, who) {
  const id = Number(sellerOrderId);
  const order = Number.isSafeInteger(id) && id > 0 ? db.prepare('SELECT * FROM seller_orders WHERE id = ?').get(id) : null;
  if (who.role === 'customer' && (!order || order.customer_order_id !== who.customerOrderId)) {
    throw new HttpError(404, 'That part of the order does not exist.');
  }
  if (!order) throw new HttpError(404, 'That order does not exist.');
  if (who.role === 'seller' && order.seller_id !== who.sellerId) throw new HttpError(403, 'This order belongs to another shop.');
  return order;
}

// The move from the current status to the new one, or a clear message saying why it is not allowed.
function findMove(current, next) {
  const move = MOVES.find((m) => m.from === current && m.to === next);
  if (move) return move;
  if (current === next) throw new HttpError(400, `This part of the order is already ${STATUS_WORDS[current]}.`);
  const nextSteps = MOVES.filter((m) => m.from === current).map((m) => STATUS_WORDS[m.to]);
  const hint = nextSteps.length > 0
    ? ` Next it can only become ${joinWithOr(nextSteps)}.`
    : ' It is finished, so it cannot change any more.';
  throw new HttpError(400, `This part of the order is ${STATUS_WORDS[current]}, so it cannot become ${STATUS_WORDS[next]}.${hint}`);
}

// 403 when this person may not make this move.
function checkWhoMayMakeIt(move, who) {
  if (move.who.includes(who.role)) return;
  const allowed = joinWithOr(move.who.map((role) => WHO_WORDS[role]));
  throw new HttpError(403, `Only ${allowed} can ${ACTION_WORDS[move.to]} now.`);
}

// The reason, courier or tracking number the move needs (trimmed, at most 200 / 60 / 60 characters).
// Anything a move does not need is ignored.
function readWhatTheMoveNeeds(move, details, who) {
  const needs = move.needs || [];
  const given = { reason: null, courier: null, tracking_number: null };
  if (needs.includes('reason')) {
    given.reason = cleanDetail(details.reason, 200, 'Please give a reason (at most 200 characters).');
  }
  if (needs.includes('courier')) {
    given.courier = cleanDetail(details.courier, 60, 'Please give the courier name (at most 60 characters).');
  }
  if (needs.includes('tracking_number')) {
    given.tracking_number = cleanDetail(details.tracking_number, 60, 'Please give the tracking number (at most 60 characters).');
  }
  // A cancel that needs no reason still records one: the person's own words if they gave some, else who cancelled.
  if (move.to === 'cancelled' && !given.reason) given.reason = defaultCancelReason(move, details, who);
  return given;
}

// Trimmed text of 1 to maxLength characters, or a 400 with the message.
function cleanDetail(value, maxLength, message) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!text || text.length > maxLength) throw new HttpError(400, message);
  return text;
}

// The reason saved for a cancel that needs no reason: the person's own words if they gave some, else who cancelled.
function defaultCancelReason(move, details, who) {
  const text = typeof details.reason === 'string' ? details.reason.trim().replace(/\s+/g, ' ').slice(0, 200) : '';
  if (text) return text;
  if (move.from === 'pending_payment') return 'The payment was not completed.';
  return who.role === 'customer' ? 'Cancelled by the customer.' : 'Cancelled by the admin.';
}

// Puts the items of a rejected or cancelled seller order back into the shop's stock.
function putStockBack(sellerOrderId) {
  const items = db.prepare('SELECT product_id, quantity FROM order_items WHERE seller_order_id = ?').all(sellerOrderId);
  for (const item of items) {
    db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(item.quantity, item.product_id);
  }
}

// "a", "a or b", "a, b or c"
function joinWithOr(words) {
  if (words.length <= 1) return words.join('');
  return words.slice(0, -1).join(', ') + ' or ' + words[words.length - 1];
}

module.exports = { MOVES, STATUS_WORDS, firstStatusFor, logFirstStatus, changeStatus };
