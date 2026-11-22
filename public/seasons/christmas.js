// seasons/christmas.js - the Christmas season's script, loaded ONLY while the season is on (the server writes it into
// the page). It adds what CSS cannot: gentle snowfall on one canvas (never blocks a click, paused when the tab is
// hidden, off with reduced motion, with a "Snow" switch in the footer), the gift-sack bag icon, the warm words for the
// toast and the order tracker, a soft bell instead of the kit's "add" sound (only if the shopper turned sound on),
// and on the home page the Christmas hero band and gift rows chosen by real prices and categories.
// Delete this file (with christmas.css) and the store is simply normal.

(function christmasSeason() {
  if (document.documentElement.dataset.season !== 'christmas') return;
  const SNOW_KEY = 'bazaarSnow';                    // 'off' when the shopper switched the snow off
  const lessMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- The warm words (also used by the server's emails) ----------
  fetch('/seasons/christmas-words.json').then((r) => r.json()).then((words) => {
    window.SEASON_WORDS = {
      added: words.added,
      // One plain, warm sentence for the order tracker, or null to keep the normal one.
      sentence(part) {
        const template = words.sentences[part.status];
        if (!template) return null;
        const item = part.items[0] ? part.items[0].name.toLowerCase() : 'order';
        return template.replace('{shop}', part.shop_name).replace('{item}', item).replace('{courier}', part.courier || 'the courier');
      },
    };
    // The tracking page may have drawn before the words arrived: draw it again with them.
    if (typeof loadOrder === 'function' && typeof forgetDrawnData === 'function') {
      forgetDrawnData('order');
      loadOrder();
    }
  }).catch(() => {});

  // ---------- The bag becomes a gift sack (the same rolling count) ----------
  function giftSack() {
    const svgSpace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgSpace, 'svg');
    for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.75',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(name, value);
    for (const d of ['M8 7c-2 2-3 5-3 8a6 6 0 0 0 6 6h2a6 6 0 0 0 6-6c0-3-1-6-3-8', 'M8 7h8', 'M9 7c0-2 1-3 3-3s3 1 3 3', 'M9 4l3 3 3-3']) {
      const path = document.createElementNS(svgSpace, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    return svg;
  }
  function dressTheBag() {
    document.querySelectorAll('.bag-link').forEach((link) => {
      const old = link.querySelector('svg');
      if (old && !old.dataset.sack) {
        const sack = giftSack();
        sack.dataset.sack = 'yes';
        old.replaceWith(sack);
      }
    });
  }

  // ---------- A soft bell for "added to bag" (only when the shopper turned sound on) ----------
  function ringBell() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    const context = new Audio();
    const start = context.currentTime;
    for (const [frequency, volume] of [[1318.5, 0.08], [2637, 0.03], [3955, 0.015]]) {
      const tone = context.createOscillator();
      const level = context.createGain();
      tone.type = 'sine';
      tone.frequency.value = frequency;
      level.gain.setValueAtTime(volume, start);
      level.gain.exponentialRampToValueAtTime(0.0001, start + 1.2);
      tone.connect(level).connect(context.destination);
      tone.start(start);
      tone.stop(start + 1.25);
    }
    setTimeout(() => context.close(), 1400);
  }
  function swapTheAddSound() {
    if (!window.IK || !IK.sound || IK.sound.christmasBell) return;
    const play = IK.sound.play.bind(IK.sound);
    IK.sound.play = (name, options) => {
      if (name === 'add' && IK.sound.isEnabled()) return ringBell();
      return play(name, options);
    };
    IK.sound.christmasBell = true;
  }

  // ---------- Gentle snowfall: few flakes, slow, one canvas that never takes a click ----------
  let snow = null;
  function snowWanted() {
    let saved = '';
    try { saved = localStorage.getItem(SNOW_KEY) || ''; } catch (e) { saved = ''; }
    return saved !== 'off' && !lessMotion.matches;
  }
  function startSnow() {
    if (snow || !snowWanted()) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'xmas-snow';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);
    const pen = canvas.getContext('2d');
    const flakes = [];
    const size = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
    size();
    const count = Math.round(Math.min(46, Math.max(16, innerWidth / 30)));
    for (let i = 0; i < count; i += 1) {
      flakes.push({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, r: 1 + Math.random() * 2.2, speed: 0.25 + Math.random() * 0.45, drift: Math.random() * Math.PI * 2 });
    }
    const colour = getComputedStyle(document.documentElement).getPropertyValue('--season-snow').trim() || '#ffffff';
    let frame = 0;
    const draw = () => {
      pen.clearRect(0, 0, canvas.width, canvas.height);
      pen.fillStyle = colour;
      pen.globalAlpha = 0.85;
      for (const flake of flakes) {
        flake.y += flake.speed;
        flake.drift += 0.01;
        flake.x += Math.sin(flake.drift) * 0.3;
        if (flake.y > canvas.height + 4) { flake.y = -4; flake.x = Math.random() * canvas.width; }
        pen.beginPath();
        pen.arc(flake.x, flake.y, flake.r, 0, Math.PI * 2);
        pen.fill();
      }
      frame = requestAnimationFrame(draw);
    };
    const pauseWhenHidden = () => {
      if (document.hidden) cancelAnimationFrame(frame);
      else frame = requestAnimationFrame(draw);
    };
    window.addEventListener('resize', size);
    document.addEventListener('visibilitychange', pauseWhenHidden);
    frame = requestAnimationFrame(draw);
    snow = { stop() { cancelAnimationFrame(frame); window.removeEventListener('resize', size); document.removeEventListener('visibilitychange', pauseWhenHidden); canvas.remove(); snow = null; } };
  }
  function stopSnow() {
    if (snow) snow.stop();
  }
  lessMotion.addEventListener('change', () => (snowWanted() ? startSnow() : stopSnow()));

  // The "Snow: on / off" switch in the footer, remembered in this browser.
  function snowSwitch() {
    const extras = document.querySelector('.footer-extras');
    if (!extras || extras.querySelector('[data-snow-switch]')) return;
    const button = make('button', 'secondary', '');
    button.type = 'button';
    button.dataset.snowSwitch = 'yes';
    const draw = () => {
      const on = snowWanted();
      button.textContent = lessMotion.matches ? 'Snow: off (reduce motion)' : on ? 'Snow: on' : 'Snow: off';
      button.setAttribute('aria-pressed', String(on));
      button.disabled = lessMotion.matches;
    };
    button.addEventListener('click', () => {
      try { localStorage.setItem(SNOW_KEY, snowWanted() ? 'off' : 'on'); } catch (e) { /* the switch still works on this page */ }
      if (snowWanted()) startSnow(); else stopSnow();
      draw();
    });
    lessMotion.addEventListener('change', draw);
    draw();
    extras.append(button);
  }

  // ---------- The home page: the hero band and the gift rows ----------
  const ROWS = [
    ['Gifts under ₹499', 'giftable=1&price_max=499&sort=price_asc&limit=4'],
    ['Gifts under ₹999', 'giftable=1&price_min=500&price_max=999&sort=price_asc&limit=4'],
    ['Gifts for the kitchen', 'giftable=1&category=home-and-kitchen&limit=4'],
  ];
  async function dressTheHomePage() {
    if (location.pathname !== '/' || document.querySelector('.xmas-hero')) return;
    const main = document.querySelector('main');
    const hero = make('section', 'xmas-hero');
    hero.setAttribute('aria-labelledby', 'xmas-hero-title');
    const title = make('h2', '', 'Christmas gifts from independent makers');
    title.id = 'xmas-hero-title';
    const shop = make('a', 'button accent', 'Shop gifts');
    shop.href = '/christmas';
    hero.append(title, make('p', '', 'Hand-made pickles, clay lamps and woven stoles, wrapped by the people who made them.'), shop);
    const rows = [];
    for (const [heading, query] of ROWS) {
      const data = await api('GET', '/api/products?' + query).catch(() => ({ products: [] }));
      if (data.products.length === 0) continue; // never a fake pick: an empty row is left out
      const section = make('section', 'xmas-row');
      section.append(make('h2', '', heading));
      const grid = make('div', 'product-grid');
      grid.append(...data.products.map(productCard));
      section.append(grid);
      rows.push(section);
    }
    const after = main.querySelector('.hero');
    (after || main.firstElementChild).after(hero, ...rows);
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => { dressTheBag(); snowSwitch(); }, 0); // after kit.js has drawn the header and footer
    swapTheAddSound();
    startSnow();
    dressTheHomePage();
  });
})();
