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
      speed: 0.25 + Math.random() * 0.5, drift: Math.random() * Math.PI * 2, push: 0, bow: Math.random() < 0.15, spin: Math.random() * 6,
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
        if (flake.bow) {
          drawBow(pen, flake);
          continue;
        }
        pen.globalAlpha = 0.55 + flake.r / 8;
        pen.fillStyle = '#ffffff';
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

  // A little red bow (two loops and a knot) that turns slowly as it falls.
  function drawBow(pen, flake) {
    const size = 4 + flake.r * 1.6;
    flake.spin += 0.01;
    pen.save();
    pen.translate(flake.x, flake.y);
    pen.rotate(Math.sin(flake.spin) * 0.5);
    pen.globalAlpha = 0.95;
    pen.fillStyle = '#d7263d';
    pen.beginPath();
    pen.moveTo(0, 0); pen.lineTo(-size, -size * 0.6); pen.lineTo(-size, size * 0.6); pen.closePath();
    pen.moveTo(0, 0); pen.lineTo(size, -size * 0.6); pen.lineTo(size, size * 0.6); pen.closePath();
    pen.fill();
    pen.fillStyle = '#9e1528';
    pen.beginPath();
    pen.arc(0, 0, size * 0.28, 0, Math.PI * 2);
    pen.fill();
    pen.restore();
  }

  // A little Santa on his sleigh (our own drawing) glides across the top of the page now and then.
  const SANTA_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 60" width="160" height="60" aria-hidden="true" focusable="false">'
    + '<g fill="none" stroke="#f5d48a" stroke-width="1.5"><path d="M60 40 Q40 30 20 34"/></g>'
    + '<g fill="#8b5a2b"><ellipse cx="14" cy="34" rx="9" ry="5"/><path d="M8 30l-4-8M12 29l-1-8" stroke="#8b5a2b" stroke-width="1.5"/></g>'
    + '<path d="M60 46 h70 q10 0 12 -10 h-6 q-2 6 -8 6 h-62z" fill="#f5d48a"/>'
    + '<path d="M66 44 h56 l6 -16 h-50 q-12 0 -12 16z" fill="#c2263f"/>'
    + '<circle cx="96" cy="20" r="7" fill="#f3c9a8"/><path d="M89 18 q7 -12 16 -2z" fill="#c2263f"/><circle cx="106" cy="15" r="2.4" fill="#ffffff"/>'
    + '<path d="M91 23 q5 8 10 0z" fill="#ffffff"/><rect x="88" y="26" width="16" height="10" rx="3" fill="#c2263f"/>'
    + '<rect x="110" y="24" width="12" height="10" rx="2" fill="#1f6b78"/><path d="M110 29h12M116 24v10" stroke="#f5d48a" stroke-width="1.5"/>'
    + '</svg>';
  let santaTimer = 0;
  function startSanta() {
    if (santaTimer || !snowWanted()) return;
    const fly = () => {
      if (document.hidden || !snowWanted()) return;
      const santa = document.createElement('div');
      santa.className = 'winter-santa';
      santa.setAttribute('aria-hidden', 'true');
      santa.innerHTML = SANTA_SVG; // our own fixed drawing, never text from people
      document.body.append(santa);
      santa.addEventListener('animationend', () => santa.remove());
    };
    setTimeout(fly, 2500);
    santaTimer = setInterval(fly, 22000);
  }
  function stopSanta() {
    clearInterval(santaTimer);
    santaTimer = 0;
    document.querySelectorAll('.winter-santa').forEach((santa) => santa.remove());
  }

  // Baubles hanging on strings under the header (our own drawings), gently swinging. Decoration only.
  function hangOrnaments() {
    const header = document.querySelector('[data-customer-header]');
    if (!header || document.querySelector('.winter-ornaments')) return;
    const colours = ['#c2263f', '#f5c542', '#1f8a70', '#4a90d9', '#e86a92', '#f5c542', '#c2263f', '#1f8a70'];
    const row = document.createElement('div');
    row.className = 'winter-ornaments';
    row.setAttribute('aria-hidden', 'true');
    const count = Math.max(5, Math.min(12, Math.round(innerWidth / 130)));
    for (let i = 0; i < count; i += 1) {
      const colour = colours[i % colours.length];
      const length = 14 + ((i * 37) % 34);
      const bauble = document.createElement('span');
      bauble.className = 'winter-bauble';
      bauble.style.setProperty('--left', `${(i + 0.5) * (100 / count)}%`);
      bauble.style.setProperty('--delay', `${(i % 4) * -0.7}s`);
      bauble.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="${length + 30}" viewBox="0 0 26 ${length + 30}" focusable="false">`
        + `<line x1="13" y1="0" x2="13" y2="${length}" stroke="#d8e6f2" stroke-width="1"/>`
        + `<rect x="9" y="${length}" width="8" height="5" rx="1" fill="#d4af37"/>`
        + `<circle cx="13" cy="${length + 16}" r="11" fill="${colour}"/>`
        + `<ellipse cx="9" cy="${length + 12}" rx="3" ry="4" fill="#ffffff" opacity=".45"/></svg>`; // our own fixed drawing
      row.append(bauble);
    }
    header.append(row); // hangs just below the sticky header, so it stays with it while scrolling
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
      if (on) { startSnow(); startSanta(); } else { if (snow) snow.stop(); stopSanta(); }
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
    startSanta();
    hangOrnaments();
    christmasRow();
  });
}());
