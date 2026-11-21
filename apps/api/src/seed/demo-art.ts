/**
 * Иллюстрации для демо-страниц (только разработка): векторные сцены 1200×800 без текста и чужих брендов.
 * Растеризуются в WebP при загрузке демо-данных; владелец может заменить их своими фото.
 */

const W = 1200;
const H = 800;

/** Детерминированный генератор для повторяемых вариаций (доски, брёвна). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const svg = (defs: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="12"/></filter><filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="30"/></filter></defs>${body}</svg>`;

const lin = (id: string, stops: Array<[number, string, number?]>, x2 = 0, y2 = 1) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`).join('')}</linearGradient>`;
const rad = (id: string, stops: Array<[number, string, number?]>, cx = 0.5, cy = 0.5, r = 0.5) =>
  `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`).join('')}</radialGradient>`;

/** Экран с игровой сценой: закатное небо, горы, солнце. */
function gameScreen(x: number, y: number, w: number, h: number, id: string, hue: 'violet' | 'sunset' = 'violet') {
  const sky = hue === 'violet' ? [[0, '#3b1d8f'], [0.55, '#c0399a'], [1, '#ff9a5c']] : [[0, '#1b2a6b'], [0.6, '#f06b4f'], [1, '#ffd27a']];
  return `
  <defs>${lin(`${id}s`, sky as Array<[number, string]>)}<clipPath id="${id}c"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/></clipPath></defs>
  <g clip-path="url(#${id}c)">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id}s)"/>
    <circle cx="${x + w * 0.68}" cy="${y + h * 0.55}" r="${h * 0.16}" fill="#ffe3a3" opacity="0.95"/>
    <polygon points="${x},${y + h * 0.78} ${x + w * 0.18},${y + h * 0.5} ${x + w * 0.34},${y + h * 0.7} ${x + w * 0.52},${y + h * 0.42} ${x + w * 0.74},${y + h * 0.72} ${x + w * 0.9},${y + h * 0.55} ${x + w},${y + h * 0.66} ${x + w},${y + h} ${x},${y + h}" fill="#2a1450" opacity="0.85"/>
    <polygon points="${x},${y + h * 0.9} ${x + w * 0.25},${y + h * 0.7} ${x + w * 0.45},${y + h * 0.86} ${x + w * 0.7},${y + h * 0.68} ${x + w},${y + h * 0.88} ${x + w},${y + h} ${x},${y + h}" fill="#140a2e"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#scan)" opacity="0.08"/>
  </g>`;
}

const SCAN = `<pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="2" fill="#fff"/></pattern>`;

/** Компьютерный клуб: тёмный зал, неоновые ленты, ряды мест в перспективе. */
export function clubCover(): string {
  const defs = lin('wall', [[0, '#0a0620'], [1, '#1c1045']]) + lin('floor', [[0, '#120a2c'], [1, '#05030d']]) + rad('halo', [[0, '#8b5cf6', 0.55], [1, '#8b5cf6', 0]], 0.5, 0.2, 0.6) + SCAN;
  let body = `<rect width="${W}" height="${H}" fill="url(#wall)"/><rect width="${W}" height="${H}" fill="url(#halo)"/>`;
  body += `<polygon points="0,560 1200,560 1200,800 0,800" fill="url(#floor)"/>`;
  for (let i = -8; i <= 8; i++) body += `<line x1="600" y1="380" x2="${600 + i * 160}" y2="800" stroke="#6d28d9" stroke-opacity="0.25" stroke-width="2"/>`;
  for (const y of [600, 650, 720]) body += `<line x1="0" y1="${y}" x2="1200" y2="${y}" stroke="#6d28d9" stroke-opacity="0.18" stroke-width="2"/>`;
  // неоновые ленты на потолке
  for (const [y, c] of [[70, '#22d3ee'], [120, '#e879f9'], [165, '#22d3ee']] as Array<[number, string]>) {
    body += `<rect x="120" y="${y}" width="960" height="6" rx="3" fill="${c}" filter="url(#glow)"/><rect x="120" y="${y}" width="960" height="4" rx="2" fill="${c}"/>`;
  }
  // логотип-геймпад на стене
  body += `<g transform="translate(540 230)" stroke="#22d3ee" stroke-width="6" fill="none" filter="url(#glow)"><path d="M20 20 h80 a30 30 0 0 1 28 40 l-12 30 a14 14 0 0 1 -24 4 l-14 -18 h-36 l-14 18 a14 14 0 0 1 -24 -4 l-12 -30 a30 30 0 0 1 28 -40z"/></g>`;
  body += `<g transform="translate(540 230)" stroke="#a5f3fc" stroke-width="3" fill="none"><path d="M20 20 h80 a30 30 0 0 1 28 40 l-12 30 a14 14 0 0 1 -24 4 l-14 -18 h-36 l-14 18 a14 14 0 0 1 -24 -4 l-12 -30 a30 30 0 0 1 28 -40z"/></g>`;
  // ряды мест: слева и справа, уменьшаются к центру
  for (let k = 0; k < 5; k++) {
    const s = 1 - k * 0.17;
    const yTop = 430 + (1 - s) * -60;
    for (const side of [-1, 1]) {
      const cx = 600 + side * (520 - k * 95);
      const mw = 150 * s;
      const mh = 95 * s;
      const x = cx - mw / 2;
      body += gameScreen(x, yTop, mw, mh, `m${k}${side > 0 ? 'r' : 'l'}`, k % 2 ? 'sunset' : 'violet');
      body += `<rect x="${x - 4 * s}" y="${yTop - 4 * s}" width="${mw + 8 * s}" height="${mh + 8 * s}" rx="${6 * s}" fill="none" stroke="#0f0f1a" stroke-width="${6 * s}"/>`;
      body += `<rect x="${x - 30 * s}" y="${yTop + mh + 18 * s}" width="${mw + 60 * s}" height="${12 * s}" fill="#1e1b2e"/>`;
      body += `<rect x="${x - 30 * s}" y="${yTop + mh + 30 * s}" width="${mw + 60 * s}" height="${4 * s}" fill="${side > 0 ? '#e879f9' : '#22d3ee'}" filter="url(#glow)"/>`;
      body += `<rect x="${cx - 32 * s}" y="${yTop + mh + 40 * s}" width="${64 * s}" height="${90 * s}" rx="${14 * s}" fill="#121022" stroke="#dc2626" stroke-width="${3 * s}"/>`;
    }
  }
  body += `<rect width="${W}" height="${H}" fill="url(#halo)" opacity="0.4"/>`;
  return svg(defs, body);
}

/** Игровое место: монитор с игровой сценой, клавиатура с подсветкой, корпус с вентиляторами. */
export function pcSetup(variant: 'standard' | 'vip'): string {
  const vip = variant === 'vip';
  const defs =
    lin('wall', vip ? [[0, '#141018'], [1, '#2a1d0c']] : [[0, '#0b1229'], [1, '#1d1240']]) +
    rad('light', [[0, vip ? '#f59e0b' : '#7c3aed', 0.5], [1, '#000', 0]], 0.5, 0.35, 0.55) +
    lin('desk', [[0, '#2b2b35'], [1, '#121217']]) +
    lin('rgb', [[0, '#22d3ee'], [0.5, '#a855f7'], [1, '#f43f5e']], 1, 0) +
    SCAN;
  let body = `<rect width="${W}" height="${H}" fill="url(#wall)"/><rect width="${W}" height="${H}" fill="url(#light)"/>`;
  body += `<rect x="0" y="600" width="${W}" height="200" fill="url(#desk)"/><rect x="0" y="600" width="${W}" height="4" fill="#3f3f4d"/>`;
  const monitors = vip ? [[150, 150, 440, 270], [610, 150, 440, 270]] : [[300, 140, 600, 340]];
  monitors.forEach(([x, y, w, h], i) => {
    body += `<rect x="${x! - 14}" y="${y! - 14}" width="${w! + 28}" height="${h! + 28}" rx="14" fill="#08080c"/>`;
    body += gameScreen(x!, y!, w!, h!, `pc${i}`, i ? 'sunset' : 'violet');
    body += `<polygon points="${x! + w! / 2 - 30},${y! + h! + 14} ${x! + w! / 2 + 30},${y! + h! + 14} ${x! + w! / 2 + 55},600 ${x! + w! / 2 - 55},600" fill="#1a1a22"/>`;
  });
  // клавиатура и мышь
  body += `<rect x="380" y="640" width="440" height="70" rx="10" fill="#0d0d12"/><rect x="380" y="708" width="440" height="6" rx="3" fill="url(#rgb)" filter="url(#glow)"/>`;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 16; c++) body += `<rect x="${392 + c * 26.5}" y="${650 + r * 14}" width="22" height="10" rx="2" fill="#1f1f2b"/>`;
  body += `<rect x="380" y="640" width="440" height="70" rx="10" fill="url(#rgb)" opacity="0.12"/>`;
  body += `<ellipse cx="900" cy="680" rx="28" ry="40" fill="#0d0d12"/><ellipse cx="900" cy="700" rx="22" ry="6" fill="url(#rgb)" filter="url(#glow)"/>`;
  // корпус
  const tx = vip ? 1060 : 980;
  body += `<rect x="${tx}" y="300" width="${vip ? 120 : 170}" height="300" rx="10" fill="#0c0c12" stroke="#2c2c3a" stroke-width="4"/>`;
  for (let f = 0; f < 3; f++) {
    const cy = 350 + f * 85;
    const cx = tx + (vip ? 60 : 85);
    body += `<circle cx="${cx}" cy="${cy}" r="34" fill="none" stroke="${f === 1 ? '#a855f7' : '#22d3ee'}" stroke-width="6" filter="url(#glow)"/><circle cx="${cx}" cy="${cy}" r="34" fill="none" stroke="${f === 1 ? '#e9d5ff' : '#cffafe'}" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="8" fill="#2c2c3a"/>`;
  }
  if (vip) body += `<rect x="0" y="596" width="${W}" height="4" fill="#f59e0b" filter="url(#glow)"/>`;
  return svg(defs, body);
}

/** Комната с консолью: большой телевизор с гоночной сценой, консоль, диван, геймпады. */
export function consoleRoom(): string {
  const defs =
    lin('wall', [[0, '#0f2a33'], [1, '#081a20']]) +
    rad('lamp', [[0, '#fbbf24', 0.45], [1, '#fbbf24', 0]], 0.15, 0.25, 0.45) +
    lin('sky', [[0, '#1e3a8a'], [0.55, '#f97316'], [1, '#fde68a']]) +
    lin('sofa', [[0, '#3f3f46'], [1, '#1f1f23']]) +
    lin('road', [[0, '#374151'], [1, '#111827']]);
  let body = `<rect width="${W}" height="${H}" fill="url(#wall)"/><rect width="${W}" height="${H}" fill="url(#lamp)"/>`;
  body += `<rect x="0" y="560" width="${W}" height="240" fill="#0b1316"/>`;
  // телевизор
  body += `<rect x="290" y="90" width="620" height="360" rx="10" fill="#050507"/>`;
  body += `<defs><clipPath id="tv"><rect x="305" y="105" width="590" height="330"/></clipPath></defs><g clip-path="url(#tv)"><rect x="305" y="105" width="590" height="330" fill="url(#sky)"/>`;
  body += `<circle cx="600" cy="270" r="50" fill="#fde68a"/><polygon points="305,330 450,250 560,320 700,240 895,330 895,435 305,435" fill="#3b0764" opacity="0.7"/>`;
  body += `<polygon points="560,290 640,290 895,435 305,435" fill="url(#road)"/><polygon points="596,300 604,300 640,435 560,435" fill="#fef3c7" opacity="0.8"/>`;
  body += `<rect x="560" y="370" width="80" height="34" rx="8" fill="#dc2626"/><rect x="572" y="360" width="56" height="18" rx="6" fill="#991b1b"/></g>`;
  body += `<rect x="290" y="450" width="620" height="6" fill="#7dd3fc" filter="url(#glow)" opacity="0.6"/>`;
  // тумба и консоль
  body += `<rect x="250" y="500" width="700" height="70" rx="6" fill="#1c1917"/><rect x="250" y="500" width="700" height="6" fill="#292524"/>`;
  body += `<path d="M800 500 q-14 -90 6 -170 q18 4 22 10 q-12 80 0 160z" fill="#f8fafc"/><path d="M840 500 q14 -90 -6 -170 q-18 4 -22 10 q12 80 0 160z" fill="#f8fafc"/><rect x="814" y="340" width="12" height="160" fill="#111827"/><rect x="816" y="380" width="8" height="60" fill="#38bdf8" opacity="0.8"/>`;
  // диван и столик с геймпадами
  body += `<rect x="120" y="620" width="960" height="150" rx="40" fill="url(#sofa)"/><rect x="90" y="600" width="90" height="190" rx="36" fill="#27272a"/><rect x="1020" y="600" width="90" height="190" rx="36" fill="#27272a"/>`;
  for (const x of [190, 470, 750]) body += `<rect x="${x}" y="560" width="260" height="110" rx="30" fill="#3f3f46"/>`;
  body += `<ellipse cx="600" cy="790" rx="420" ry="30" fill="#000" opacity="0.4"/>`;
  for (const [x, r] of [[470, -8], [690, 10]] as Array<[number, number]>) {
    body += `<g transform="translate(${x} 700) rotate(${r})"><path d="M0 10 q0 -22 30 -22 h40 q30 0 30 22 l8 30 q4 18 -12 18 q-12 0 -20 -14 h-52 q-8 14 -20 14 q-16 0 -12 -18z" fill="#f1f5f9"/><circle cx="28" cy="10" r="6" fill="#111827"/><circle cx="72" cy="10" r="6" fill="#111827"/></g>`;
  }
  return svg(defs, body);
}

/** Финская сауна: стены из вертикальной доски, полки, печь-каменка, пар, тёплый свет. */
export function finnishSauna(): string {
  const r = rng(7);
  const defs = rad('warm', [[0, '#ffb347', 0.55], [1, '#ff8c1a', 0]], 0.25, 0.15, 0.7) + lin('bench', [[0, '#d9a066'], [1, '#a86b35']]) + rad('fire', [[0, '#ffdd55'], [0.6, '#ff6a00'], [1, '#7a1f00']]);
  let body = `<rect width="${W}" height="${H}" fill="#b98049"/>`;
  for (let x = 0; x < W; x += 60) {
    const t = Math.floor(170 + r() * 40);
    body += `<rect x="${x}" y="0" width="60" height="${H}" fill="rgb(${t + 20},${Math.floor(t * 0.68)},${Math.floor(t * 0.38)})"/><rect x="${x}" y="0" width="2" height="${H}" fill="#7a4a22" opacity="0.6"/>`;
  }
  body += `<rect width="${W}" height="${H}" fill="url(#warm)"/>`;
  // полки в два яруса
  for (const [y, d] of [[430, 40], [560, 46]] as Array<[number, number]>) {
    body += `<rect x="0" y="${y}" width="820" height="${d}" fill="url(#bench)"/><rect x="0" y="${y + d}" width="820" height="${130 - d}" fill="#8a5528"/>`;
    for (let x = 0; x < 820; x += 82) body += `<rect x="${x}" y="${y + d}" width="3" height="${130 - d}" fill="#6b3f1c"/>`;
  }
  body += `<rect x="0" y="690" width="${W}" height="110" fill="#6b3f1c"/>`;
  // печь-каменка
  body += `<rect x="900" y="420" width="220" height="300" rx="10" fill="#2b2b2b"/><rect x="930" y="600" width="160" height="70" rx="6" fill="url(#fire)"/><rect x="900" y="400" width="220" height="40" fill="#3a3a3a"/>`;
  for (let i = 0; i < 14; i++) body += `<ellipse cx="${915 + (i % 7) * 30 + (i > 6 ? 15 : 0)}" cy="${395 - (i > 6 ? 22 : 0)}" rx="${18 + r() * 6}" ry="${13 + r() * 4}" fill="rgb(${110 + Math.floor(r() * 40)},${105 + Math.floor(r() * 35)},${100 + Math.floor(r() * 30)})"/>`;
  // ведро и ковш
  body += `<path d="M780 640 h80 l-10 60 h-60z" fill="#a86b35" stroke="#6b3f1c" stroke-width="4"/><rect x="776" y="636" width="88" height="10" rx="4" fill="#c0c0c0"/><path d="M850 560 l40 -70" stroke="#a86b35" stroke-width="8" stroke-linecap="round"/>`;
  // пар
  for (let i = 0; i < 9; i++) body += `<ellipse cx="${880 + r() * 280}" cy="${120 + r() * 260}" rx="${80 + r() * 90}" ry="${30 + r() * 40}" fill="#fff" opacity="${0.12 + r() * 0.12}" filter="url(#soft)"/>`;
  // светильник
  body += `<rect x="520" y="60" width="160" height="40" rx="18" fill="#f5c27a" filter="url(#glow)"/><rect x="530" y="66" width="140" height="28" rx="14" fill="#ffe2b0"/>`;
  return svg(defs, body);
}

/** Русская баня: бревенчатые стены, лавка, ушат с веником, окошко, мягкий пар. */
export function russianBanya(): string {
  const r = rng(11);
  const defs = lin('log', [[0, '#8a5a2b'], [0.45, '#c7904f'], [1, '#6b4220']]) + rad('glow', [[0, '#ffcf87', 0.6], [1, '#ffcf87', 0]], 0.78, 0.3, 0.5) + lin('win', [[0, '#bfe3ff'], [1, '#6aa6d8']]);
  let body = `<rect width="${W}" height="${H}" fill="#5a3618"/>`;
  for (let y = 0; y < 640; y += 64) body += `<rect x="0" y="${y}" width="${W}" height="62" rx="30" fill="url(#log)"/><circle cx="${40 + r() * 1100}" cy="${y + 31}" r="${5 + r() * 6}" fill="#6b4220" opacity="0.7"/>`;
  body += `<rect width="${W}" height="${H}" fill="url(#glow)"/>`;
  // окошко
  body += `<rect x="820" y="150" width="220" height="170" rx="8" fill="#4a2c12"/><rect x="836" y="166" width="188" height="138" fill="url(#win)"/><rect x="926" y="166" width="8" height="138" fill="#4a2c12"/><rect x="836" y="231" width="188" height="8" fill="#4a2c12"/>`;
  // лавка
  body += `<rect x="60" y="520" width="700" height="44" rx="8" fill="#d39a5a"/><rect x="90" y="564" width="30" height="130" fill="#8a5a2b"/><rect x="700" y="564" width="30" height="130" fill="#8a5a2b"/>`;
  body += `<rect x="0" y="690" width="${W}" height="110" fill="#3e2510"/>`;
  for (let x = 0; x < W; x += 100) body += `<rect x="${x}" y="690" width="3" height="110" fill="#2a1808"/>`;
  // ушат и веник
  body += `<path d="M860 600 h170 l-16 110 h-138z" fill="#b07a45" stroke="#5a3618" stroke-width="5"/><rect x="852" y="596" width="186" height="12" rx="5" fill="#8f8f8f"/><rect x="852" y="650" width="178" height="8" fill="#8f8f8f"/>`;
  body += `<g transform="translate(300 470) rotate(-12)"><rect x="-8" y="0" width="16" height="70" rx="6" fill="#8a5a2b"/>`;
  for (let i = 0; i < 26; i++) body += `<ellipse cx="${(r() - 0.5) * 90}" cy="${-20 - r() * 110}" rx="${14 + r() * 8}" ry="${8 + r() * 5}" transform="rotate(${(r() - 0.5) * 80} 0 0)" fill="rgb(${40 + Math.floor(r() * 30)},${110 + Math.floor(r() * 60)},${40 + Math.floor(r() * 30)})"/>`;
  body += `</g>`;
  for (let i = 0; i < 8; i++) body += `<ellipse cx="${100 + r() * 1000}" cy="${80 + r() * 300}" rx="${90 + r() * 80}" ry="${30 + r() * 30}" fill="#fff" opacity="${0.1 + r() * 0.1}" filter="url(#soft)"/>`;
  return svg(defs, body);
}

/** Хаммам: мраморные стены, арки с синей плиткой, центральный камень, свет из купола, пар. */
export function hammam(): string {
  const r = rng(23);
  const defs = lin('marble', [[0, '#f3efe9'], [1, '#d9d2c7']]) + rad('dome', [[0, '#fffbe8', 0.9], [1, '#fffbe8', 0]], 0.5, 0, 0.6) + lin('tile', [[0, '#1e5aa8'], [1, '#0e3a75']]) + lin('stone', [[0, '#ece6dc'], [1, '#bdb3a4']]);
  let body = `<rect width="${W}" height="${H}" fill="url(#marble)"/>`;
  for (let i = 0; i < 12; i++) body += `<path d="M${r() * W} ${r() * 500} q${(r() - 0.5) * 200} ${60 + r() * 80} ${(r() - 0.5) * 300} ${120 + r() * 120}" stroke="#b9ad9c" stroke-width="${1 + r() * 2}" fill="none" opacity="0.5"/>`;
  for (const x of [80, 450, 820]) {
    body += `<path d="M${x} 560 v-260 a150 150 0 0 1 300 0 v260z" fill="url(#tile)"/>`;
    for (let yy = 320; yy < 560; yy += 34) for (let xx = x + 10; xx < x + 290; xx += 34) body += `<rect x="${xx}" y="${yy}" width="30" height="30" fill="none" stroke="#8fb5e8" stroke-width="1.5" opacity="0.5"/>`;
    body += `<path d="M${x} 560 v-260 a150 150 0 0 1 300 0 v260" fill="none" stroke="#c8a96a" stroke-width="8"/>`;
    body += `<ellipse cx="${x + 150}" cy="520" rx="60" ry="18" fill="#e7dfd2"/><rect x="${x + 120}" y="470" width="60" height="50" rx="8" fill="#d9cfbf"/><rect x="${x + 144}" y="440" width="12" height="34" fill="#c8a96a"/>`;
  }
  body += `<rect x="0" y="560" width="${W}" height="240" fill="#e4ddd2"/><polygon points="250,640 950,640 1080,760 120,760" fill="url(#stone)"/><polygon points="250,640 950,640 950,656 250,656" fill="#cfc5b6"/>`;
  body += `<rect width="${W}" height="${H}" fill="url(#dome)"/>`;
  for (let i = 0; i < 7; i++) body += `<circle cx="${300 + i * 100}" cy="${40 + (i % 2) * 20}" r="10" fill="#fff8d6" filter="url(#glow)"/>`;
  for (let i = 0; i < 10; i++) body += `<ellipse cx="${r() * W}" cy="${200 + r() * 400}" rx="${100 + r() * 100}" ry="${30 + r() * 40}" fill="#fff" opacity="${0.15 + r() * 0.12}" filter="url(#soft)"/>`;
  return svg(defs, body);
}

/** Обложка банного комплекса: композиция из сауны с более сильным паром. */
export function bathCover(): string {
  return finnishSauna().replace('</svg>', `<rect width="${W}" height="${H}" fill="#2a1406" opacity="0.18"/></svg>`);
}

/** Салон красоты: пудровые стены, круглые зеркала с подсветкой, кресла, растения, подвесные лампы. */
export function beautySalon(): string {
  const r = rng(31);
  const defs =
    lin('wallS', [[0, '#f7e4dc'], [1, '#efd3c6']]) +
    lin('floorS', [[0, '#d9c2b0'], [1, '#bfa48e']]) +
    rad('mirror', [[0, '#ffffff'], [0.7, '#e9eef3'], [1, '#c9d3dc']], 0.4, 0.35, 0.7) +
    rad('sun', [[0, '#fff3d9', 0.9], [1, '#fff3d9', 0]], 0.15, 0.1, 0.6) +
    lin('chair', [[0, '#3b3a4a'], [1, '#22212d']]);
  let body = `<rect width="${W}" height="${H}" fill="url(#wallS)"/><rect width="${W}" height="${H}" fill="url(#sun)"/>`;
  // панели стены
  for (let x = 40; x < W; x += 280) body += `<rect x="${x}" y="40" width="240" height="560" rx="120" fill="#fbeee8" opacity="0.6"/>`;
  body += `<rect x="0" y="600" width="${W}" height="200" fill="url(#floorS)"/>`;
  for (let x = -200; x < W + 200; x += 120) body += `<path d="M${x} 800 L${x + 200} 600" stroke="#c7ae99" stroke-width="2" opacity="0.6"/>`;
  // зеркала, столики и кресла
  for (const x of [160, 600]) {
    body += `<circle cx="${x + 140}" cy="260" r="150" fill="#d8b27a"/><circle cx="${x + 140}" cy="260" r="138" fill="url(#mirror)"/>`;
    body += `<circle cx="${x + 140}" cy="260" r="160" fill="none" stroke="#fff6dd" stroke-width="6" opacity="0.8" filter="url(#glow)"/>`;
    body += `<rect x="${x + 20}" y="430" width="240" height="18" rx="6" fill="#d8b27a"/><rect x="${x + 30}" y="448" width="220" height="40" rx="6" fill="#efe2d6"/>`;
    body += `<rect x="${x + 60}" y="404" width="22" height="26" rx="4" fill="#c98b9b"/><rect x="${x + 92}" y="396" width="16" height="34" rx="4" fill="#9fb7a5"/><circle cx="${x + 220}" cy="416" r="14" fill="#f2c7b8"/>`;
    body += `<rect x="${x + 70}" y="500" width="140" height="90" rx="26" fill="url(#chair)"/><rect x="${x + 60}" y="560" width="160" height="50" rx="20" fill="#2c2b39"/>`;
    body += `<rect x="${x + 134}" y="610" width="12" height="70" fill="#b7b7c2"/><ellipse cx="${x + 140}" cy="690" rx="60" ry="10" fill="#9c9cab"/>`;
  }
  // растение
  body += `<path d="M1080 690 h80 l-12 80 h-56z" fill="#e8d7c6" stroke="#cdb59f" stroke-width="3"/>`;
  for (let i = 0; i < 16; i++) {
    const a = -150 + r() * 120;
    const len = 90 + r() * 120;
    const ex = 1120 + Math.cos((a * Math.PI) / 180) * len;
    const ey = 690 + Math.sin((a * Math.PI) / 180) * len;
    body += `<path d="M1120 690 Q${(1120 + ex) / 2 + (r() - 0.5) * 40} ${(690 + ey) / 2 - 20} ${ex} ${ey}" stroke="rgb(${60 + Math.floor(r() * 30)},${120 + Math.floor(r() * 40)},${80 + Math.floor(r() * 30)})" stroke-width="${10 + r() * 6}" stroke-linecap="round" fill="none"/>`;
  }
  // подвесные лампы
  for (const x of [300, 600, 900]) body += `<rect x="${x - 1}" y="0" width="2" height="70" fill="#8a7564"/><path d="M${x - 34} 100 a34 30 0 0 1 68 0z" fill="#d8b27a"/><circle cx="${x}" cy="104" r="16" fill="#fff4cf" filter="url(#glow)"/>`;
  return svg(defs, body);
}

/** Массажный кабинет: приглушённый свет, кушетка с полотенцами, свечи, камни, орхидея. */
export function massageRoom(): string {
  const r = rng(41);
  const defs =
    lin('wallM', [[0, '#5b4636'], [1, '#3a2b20']]) +
    rad('candle', [[0, '#ffd28a', 0.8], [1, '#ffd28a', 0]], 0.75, 0.75, 0.5) +
    lin('towel', [[0, '#fbf7f0'], [1, '#e6ddcf']]) +
    lin('wood', [[0, '#9a6b45'], [1, '#6e4a2e']]);
  let body = `<rect width="${W}" height="${H}" fill="url(#wallM)"/>`;
  for (let x = 0; x < W; x += 40) body += `<rect x="${x}" y="0" width="18" height="560" fill="#6b5240" opacity="${0.25 + r() * 0.2}"/>`;
  body += `<rect x="0" y="560" width="${W}" height="240" fill="#2c2119"/><rect width="${W}" height="${H}" fill="url(#candle)"/>`;
  // кушетка
  body += `<rect x="180" y="470" width="640" height="60" rx="24" fill="url(#towel)"/><rect x="180" y="455" width="640" height="24" rx="12" fill="#efe6d8"/>`;
  body += `<rect x="230" y="530" width="24" height="170" fill="url(#wood)"/><rect x="746" y="530" width="24" height="170" fill="url(#wood)"/><rect x="230" y="640" width="540" height="14" fill="url(#wood)"/>`;
  body += `<rect x="640" y="420" width="150" height="40" rx="16" fill="#c9b49a"/><rect x="650" y="408" width="130" height="26" rx="12" fill="#e9dcc8"/>`;
  // полотенца стопкой и камни
  for (let i = 0; i < 3; i++) body += `<rect x="900" y="${640 - i * 30}" width="170" height="28" rx="12" fill="${['#efe6d8', '#d9c7ad', '#f7f1e7'][i]}"/>`;
  for (let i = 0; i < 5; i++) body += `<ellipse cx="${940 + i * 22}" cy="${540 - i * 14}" rx="${34 - i * 4}" ry="${14 - i * 1.5}" fill="#2b2b2e" stroke="#4a4a4f" stroke-width="2"/>`;
  // свечи
  for (const [x, h] of [[880, 70], [1080, 50], [960, 36]] as Array<[number, number]>) {
    body += `<rect x="${x}" y="${720 - h}" width="40" height="${h}" rx="6" fill="#f6efe2"/><ellipse cx="${x + 20}" cy="${700 - h}" rx="9" ry="16" fill="#ffcf70" filter="url(#glow)"/><ellipse cx="${x + 20}" cy="${704 - h}" rx="5" ry="10" fill="#fff3c2"/>`;
  }
  // орхидея
  body += `<path d="M110 700 h70 l-8 60 h-54z" fill="#e9dccb"/><path d="M145 700 C140 600 150 520 190 470" stroke="#5d7a4a" stroke-width="5" fill="none"/>`;
  for (const [x, y] of [[190, 470], [176, 512], [160, 556], [205, 500]]) body += `<g transform="translate(${x} ${y})">${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="-14" rx="9" ry="16" transform="rotate(${a})" fill="#f3d6e6"/>`).join('')}<circle r="6" fill="#c94f86"/></g>`;
  // мягкий свет сверху
  body += `<ellipse cx="500" cy="60" rx="300" ry="60" fill="#ffe2b3" opacity="0.25" filter="url(#soft)"/>`;
  return svg(defs, body);
}
