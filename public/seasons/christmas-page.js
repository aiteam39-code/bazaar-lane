// seasons/christmas-page.js - the /christmas collection: every giftable product that can be bought, with the usual
// filters and sorting (listing.js), kept in the page address.

async function loadGifts() {
  try {
    await buildFilterForm(document.getElementById('filters'), { giftable: '1' });
    await loadProductList(document.getElementById('products'), { giftable: '1' }, document.getElementById('result-count'));
  } catch (error) {
    showMessage(document.getElementById('message'), error.message, 'error');
  }
}

loadGifts();
