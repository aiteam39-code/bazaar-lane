// admin/reviews.js - every review, with Hide (the kit's ConfirmButton) or Show. Refreshes every 5 seconds.

const adminReviewsMessage = document.getElementById('message');

async function loadAdminReviews() {
  try {
    const data = await api('GET', '/api/admin/reviews');
    clearLoadProblem(adminReviewsMessage);
    if (!dataChanged('admin-reviews', data)) return;
    document.getElementById('review-list').replaceChildren(...data.reviews.map(adminReviewCard));
    document.getElementById('no-reviews').classList.toggle('hidden', data.reviews.length > 0);
  } catch (error) {
    if (!goToLoginIfNeeded(error)) showLoadProblem(adminReviewsMessage, error);
  }
}

function adminReviewCard(review) {
  const card = make('article', 'card');
  const top = make('p', 'review-top');
  top.append(starRow(review.rating), make('strong', '', `${review.rating} out of 5`), make('span', 'muted', ` · ${review.product_name} · ${review.shop_name}`));
  card.append(top);
  card.append(make('p', review.hidden ? 'badge badge-rejected' : 'badge badge-active', review.hidden ? 'Hidden' : 'Shown'));
  if (review.text) card.append(make('p', 'description', review.text));
  if (review.seller_reply) card.append(make('p', 'reason', 'Shop reply: ' + review.seller_reply));
  const slot = make('div', 'actions');
  if (review.hidden) {
    const show = make('button', 'secondary', 'Show');
    show.type = 'button';
    show.addEventListener('click', () => reviewAction(review.id, 'show'));
    slot.append(show);
  } else {
    const confirm = make('span');
    mountKit(confirm, IK.ConfirmButton, { label: 'Hide', confirmLabel: 'Hide review?', hint: 'Press again to hide this review', onConfirm: () => reviewAction(review.id, 'hide') });
    slot.append(confirm);
  }
  card.append(slot);
  return card;
}

async function reviewAction(id, action) {
  try {
    const answer = await api('POST', `/api/admin/reviews/${id}/${action}`);
    showMessage(adminReviewsMessage, answer.message, 'ok');
    forgetDrawnData('admin-reviews');
    loadAdminReviews();
  } catch (error) {
    showMessage(adminReviewsMessage, error.message, 'error');
  }
}

refreshEvery5Seconds(loadAdminReviews);
