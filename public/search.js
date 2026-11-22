// search.js - /search?search=...: the products that can be bought, with filters (price from and to, shop, city,
// rating) and sorting, all kept in the page address so a search can be shared.

// The title says what was searched for.
function showSearchTitle() {
  const search = new URLSearchParams(location.search).get('search');
  document.getElementById('search-title').textContent = search ? `Results for "${search}"` : 'Search all products';
}

// Builds the filters and loads the results.
async function loadSearch() {
  showSearchTitle();
  try {
    await buildFilterForm(document.getElementById('filters'));
    await loadProductList(document.getElementById('products'), {}, document.getElementById('result-count'));
  } catch (error) {
    showMessage(document.getElementById('message'), error.message, 'error');
  }
}

loadSearch();
