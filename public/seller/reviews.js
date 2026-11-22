// seller/reviews.js - the seller's own products' reviews, each with ONE reply. Hidden ones are marked (the admin hid
// them; customers do not see them). Refreshes every 5 seconds, but never while someone is typing.

const reviewsMessage = document.getElementById('message');

async function loadReviews() {
  try {
    const data = await api('GET', '/api/seller/reviews');
    clearLoadProblem(reviewsMessage);
    if (!dataChanged('seller-reviews', data)) return;
    document.getElementById('summary').replaceChildren(ratingLine(data.rating, data.review_count));
    document.getElementById('review-list').replaceChildren(...data.reviews.map(reviewCard));
    document.getElementById('no-reviews').classList.toggle('hidden', data.reviews.length > 0);
  } catch (error) {
    if (!goToLoginIfNeeded(error)) showLoadProblem(reviewsMessage, error);
  }
}

function reviewCard(review) {
  const card = make('article', 'card');
  const top = make('p', 'review-top');
  top.append(starRow(review.rating), make('strong', '', `${review.rating} out of 5`), make('span', 'muted', ` · ${review.product_name} · ${review.first_name} · ${review.code}`));
  card.append(top);
  if (review.hidden) card.append(make('p', 'badge badge-rejected', 'Hidden by the admin'));
  if (review.text) card.append(make('p', 'description', review.text));
  if (review.seller_reply) {
    card.append(make('p', 'reason', 'Your reply: ' + review.seller_reply));
    return card;
  }
  const label = make('label', '', 'Reply (once, up to 500 characters)');
  const box = make('textarea');
  box.id = 'reply-' + review.id;
  box.maxLength = 500;
  box.rows = 2;
  label.htmlFor = box.id;
  const note = make('div', 'message');
  const send = make('button', 'secondary', 'Post reply');
  send.type = 'button';
  send.addEventListener('click', async () => {
    try {
      const answer = await api('POST', `/api/seller/reviews/${review.id}/reply`, { reply: box.value });
      showMessage(reviewsMessage, answer.message, 'ok');
      forgetDrawnData('seller-reviews');
      loadReviews();
    } catch (error) {
      showMessage(note, error.message, 'error');
    }
  });
  card.append(label, box, note, send);
  return card;
}

refreshEvery5Seconds(loadReviews);
