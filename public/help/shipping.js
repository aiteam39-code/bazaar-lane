// help/shipping.js - each open shop's shipping fee, free-shipping limit, dispatch days and returns.

async function loadShipping() {
  const table = document.getElementById('shipping-table');
  try {
    const { shops } = await api('GET', '/api/shops');
    const head = make('tr');
    for (const word of ['Shop', 'Shipping', 'Free when items are over', 'Sends within', 'Returns']) head.append(make('th', '', word));
    table.replaceChildren(head, ...shops.map((shop) => {
      const row = make('tr');
      const link = make('a', '', shop.city ? `${shop.shop_name} · ${shop.city}` : shop.shop_name);
      link.href = '/store/' + encodeURIComponent(shop.slug);
      const name = make('td');
      name.append(link);
      row.append(name, make('td', '', shop.shipping_fee === 0 ? 'Free' : formatMoney(shop.shipping_fee)),
        make('td', '', shop.free_shipping_over === null ? 'Never' : formatMoney(shop.free_shipping_over)),
        make('td', '', `${shop.dispatch_days} day${shop.dispatch_days === 1 ? '' : 's'}`),
        make('td', '', shop.return_days === 0 ? 'No returns' : `${shop.return_days} days`));
      return row;
    }));
  } catch (error) {
    table.replaceChildren(make('caption', '', error.message));
  }
}

loadShipping();
