'use client';
/*
 * Placeholder product art for previews and early builds, before real photography exists.
 * IK.demo.art('mug') -> a data: URI you can put in <img src>. Never ship it to production.
 */
const SCENES = {
  mug: {
    bg: '#cdd5c3', floor: '#bdc6b2',
    draw: `<path d="M268 236c54 0 54 96 0 96" fill="none" stroke="#efe9de" stroke-width="22" stroke-linecap="round"/>
      <rect x="128" y="200" width="144" height="168" rx="20" fill="#efe9de"/>
      <path d="M128 220a20 20 0 0 1 20-20h104a20 20 0 0 1 20 20v34c-10 8-18-6-26 4s-12 22-22 10-14-16-24-4-16 10-24-2-18 2-24-4-14 6-24-8z" fill="#7d8f84"/>
      <ellipse cx="200" cy="202" rx="72" ry="12" fill="#5f6f66"/>`,
  },
  tote: {
    bg: '#e6c9b5', floor: '#d9b9a3',
    draw: `<path d="M156 226c0-86 88-86 88 0" fill="none" stroke="#8f6c42" stroke-width="12" stroke-linecap="round"/>
      <path d="M118 222h164l16 150H102z" fill="#efe2c8"/>
      <rect x="110" y="300" width="180" height="20" fill="#c96f45"/>
      <rect x="110" y="328" width="180" height="6" fill="#c96f45" opacity=".55"/>`,
  },
  lamp: {
    bg: '#c9d7dd', floor: '#b7c7ce',
    draw: `<rect x="195" y="246" width="10" height="122" rx="4" fill="#2f2a25"/>
      <ellipse cx="200" cy="370" rx="58" ry="12" fill="#2f2a25"/>
      <path d="M146 140h108l34 108H112z" fill="#f4ead6"/>
      <path d="M146 140h108l6 18H140z" fill="#e4d6bb"/>`,
  },
  bottle: {
    bg: '#ead39f', floor: '#dcc287',
    draw: `<rect x="184" y="118" width="32" height="54" fill="#8a4a17"/>
      <rect x="180" y="104" width="40" height="20" rx="5" fill="#2f2a25"/>
      <rect x="138" y="166" width="124" height="204" rx="28" fill="#a65e1e"/>
      <rect x="150" y="236" width="100" height="84" rx="8" fill="#f3ead8"/>
      <rect x="166" y="256" width="68" height="8" rx="4" fill="#a65e1e"/>
      <rect x="176" y="274" width="48" height="6" rx="3" fill="#a65e1e" opacity=".6"/>
      <rect x="170" y="294" width="60" height="6" rx="3" fill="#a65e1e" opacity=".6"/>`,
  },
  bowl: {
    bg: '#d8d2c8', floor: '#c9c2b6',
    draw: `<circle cx="172" cy="262" r="26" fill="#e4a33a"/>
      <circle cx="214" cy="256" r="24" fill="#c75a3a"/>
      <circle cx="240" cy="268" r="20" fill="#e4a33a"/>
      <path d="M106 272q94 150 188 0z" fill="#5f7482"/>
      <ellipse cx="200" cy="272" rx="94" ry="16" fill="#7c919e"/>
      <path d="M118 274q82 18 164 0" fill="none" stroke="#4b5d69" stroke-width="6"/>`,
  },
  candle: {
    bg: '#e8cfc4', floor: '#dcbdb0',
    draw: `<path d="M200 200c14 16 14 34 0 42-14-8-14-26 0-42z" fill="#f2a516"/>
      <rect x="198" y="236" width="4" height="18" fill="#2f2a25"/>
      <rect x="144" y="230" width="112" height="142" rx="16" fill="#d3c2ae"/>
      <rect x="152" y="252" width="96" height="112" rx="10" fill="#f5eee2"/>
      <rect x="144" y="300" width="112" height="34" fill="#2f2a25"/>`,
  },
};

const encode = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

/** kind: 'mug' | 'tote' | 'lamp' | 'bottle' | 'bowl' | 'candle'; alt: a closer second shot for hover swaps. */
export function art(kind, { alt = false } = {}) {
  const s = SCENES[kind] || SCENES.mug;
  const product = alt ? `<g transform="translate(-130 -190) scale(1.65)">${s.draw}</g>` : s.draw;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice">
    <rect width="400" height="500" fill="${alt ? s.floor : s.bg}"/>
    <rect y="${alt ? 430 : 360}" width="400" height="${alt ? 70 : 140}" fill="${alt ? s.bg : s.floor}"/>
    ${alt ? '' : '<ellipse cx="200" cy="372" rx="110" ry="14" fill="#000" opacity=".10"/>'}
    ${product}
  </svg>`;
  return encode(svg);
}

export const artKinds = Object.keys(SCENES);
