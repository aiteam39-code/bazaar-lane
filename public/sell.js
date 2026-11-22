// sell.js - "Sell with us": the default commission and the early-bird offer (with how many places are left).

async function loadSellInfo() {
  try {
    const info = await api('GET', '/api/sell-info');
    document.getElementById('commission-line').textContent =
      `${percentText(info.default_commission_bps)} of the items total of each delivered order (shipping is yours). Some categories have their own rate.`;
    const offer = info.early_bird;
    const line = document.getElementById('early-bird-line');
    if (offer && offer.places_left > 0) {
      line.textContent = `Early-bird offer: the next ${offer.places_left} shop${offer.places_left === 1 ? '' : 's'} approved pay only ${percentText(offer.rate_bps)} for their first ${offer.days} days.`;
      line.classList.remove('hidden');
    }
  } catch (error) {
    // The page still explains everything else.
  }
}

// 1000 basis points -> "10%", 850 -> "8.5%".
function percentText(bps) {
  return `${bps / 100}%`;
}

loadSellInfo();
