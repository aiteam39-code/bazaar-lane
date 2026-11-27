// seasons/winter.js - the Winter season (mid-November to February; Christmas takes over 1 to 26 December).
// 1. Snow falls over the page on one canvas that never takes a click; the flakes drift away from the mouse or a finger.
//    It pauses when the tab is hidden, never runs with reduced motion, and the footer's "Snow" switch turns it off
//    (remembered in this browser as bazaarSnow).
// 2. The home page gets one big Christmas gift-box tile at the top that opens the Christmas shop (the category).
(function winterSeason() {
  const SNOW_KEY = 'bazaarSnow';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let snow = null;

  // Is snow wanted? Off with reduced motion or when the shopper switched it off.
  function snowWanted() {
    if (reduceMotion.matches) return false;
    try { return localStorage.getItem(SNOW_KEY) !== 'off'; } catch (e) { return true; }
  }

  // Starts the snowfall.
  function startSnow() {
    if (snow || !snowWanted()) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'winter-snow';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);
    const pen = canvas.getContext('2d');
    const pointer = { x: -999, y: -999 };
    const size = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
    size();
    const count = Math.round(Math.min(90, Math.max(30, innerWidth / 16)));
    const flakes = Array.from({ length: count }, () => ({
      x: Math.random() * innerWidth, y: Math.random() * innerHeight, r: 1.2 + Math.random() * 3,
      speed: 0.25 + Math.random() * 0.5, drift: Math.random() * Math.PI * 2, push: 0,
    }));
    let frame = 0;
    const draw = () => {
      pen.clearRect(0, 0, canvas.width, canvas.height);
      pen.fillStyle = '#ffffff';
      for (const flake of flakes) {
        flake.drift += 0.012;
        flake.y += flake.speed;
        flake.x += Math.sin(flake.drift) * 0.5 + flake.push;
        flake.push *= 0.93;
        const dx = flake.x - pointer.x;
        const dy = flake.y - pointer.y;
        const near = dx * dx + dy * dy;
        if (near < 90 * 90) flake.push += (dx > 0 ? 1 : -1) * 0.6; // the mouse or finger blows the flakes aside
        if (flake.y > canvas.height + 6) { flake.y = -6; flake.x = Math.random() * canvas.width; }
        if (flake.x > canvas.width + 6) flake.x = -6;
        if (flake.x < -6) flake.x = canvas.width + 6;
        pen.globalAlpha = 0.55 + flake.r / 8;
        pen.beginPath();
        pen.arc(flake.x, flake.y, flake.r, 0, Math.PI * 2);
        pen.fill();
      }
      frame = requestAnimationFrame(draw);
    };
    const follow = (event) => { const p = event.touches ? event.touches[0] : event; pointer.x = p.clientX; pointer.y = p.clientY; };
    const pauseWhenHidden = () => {
      if (document.hidden) cancelAnimationFrame(frame);
      else frame = requestAnimationFrame(draw);
    };
    window.addEventListener('resize', size);
    window.addEventListener('pointermove', follow, { passive: true });
    window.addEventListener('touchmove', follow, { passive: true });
    document.addEventListener('visibilitychange', pauseWhenHidden);
    frame = requestAnimationFrame(draw);
    snow = {
      stop() {
        cancelAnimationFrame(frame);
        window.removeEventListener('resize', size);
        window.removeEventListener('pointermove', follow);
        window.removeEventListener('touchmove', follow);
        document.removeEventListener('visibilitychange', pauseWhenHidden);
        canvas.remove();
        snow = null;
      },
    };
  }

  // The footer's "Snow" switch (a pressed button, remembered in this browser).
  function snowSwitch() {
    const footer = document.querySelector('[data-customer-footer]');
    if (!footer || reduceMotion.matches || footer.querySelector('.snow-switch')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'snow-switch';
    const draw = () => {
      const on = snowWanted();
      button.textContent = on ? 'Stop the snow' : 'Let it snow';
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    };
    button.addEventListener('click', () => {
      const on = !snowWanted();
      try { localStorage.setItem(SNOW_KEY, on ? 'on' : 'off'); } catch (e) { /* not saved: still works on this page */ }
      if (on) startSnow(); else if (snow) snow.stop();
      draw();
    });
    draw();
    footer.append(button);
  }

  // The home page: "Handmade for Christmas" first, from real products with Christmas in their name.
  async function christmasRow() {
    const banner = document.querySelector('.home-banner');
    if (location.pathname !== '/' || !banner || document.querySelector('.winter-row')) return;
    // One big gift-box tile for the whole Christmas shop: its photo comes from the Christmas category, and a click
    // opens the category page with every Christmas product.
    let tile = null;
    try {
      tile = (await api('GET', '/api/home')).categories.find((category) => category.slug === 'christmas');
    } catch (e) {
      return;
    }
    if (!tile) return; // no Christmas products to show: no tile
    const link = make('a', 'winter-row christmas-tile');
    link.href = '/category/christmas';
    const words = make('div', 'christmas-tile-words');
    words.append(make('h2', '', 'The Christmas shop'),
      make('p', '', `${tile.product_count} handmade gifts: crochet Santas, star lanterns, plum cake and more.`),
      make('span', 'button christmas-tile-open', 'Open the Christmas shop'));
    const photo = make('img', 'christmas-tile-photo');
    photo.src = tile.photo_url || placeholderArt(tile.id);
    photo.alt = 'A gift box with a red bow';
    link.append(words, photo);
    banner.after(link);
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(snowSwitch, 0); // after kit.js has drawn the footer
    startSnow();
    christmasRow();
  });
}());
