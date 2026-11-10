/**
 * Writes the README graphics, each in a light and a dark variant, all computed from the model:
 *   assets/hero-*.svg    the name beside the machines needed at each power of ten
 *   assets/stages-*.svg  the seven stages and the real companies on one log axis
 *   assets/queue-*.svg   why a system at 95 percent is not nearly fine (the M/M/1 curve)
 *   assets/bill-*.svg    the monthly bill at each power of ten, and what it is made of
 * Run with `npm run readme`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULTS, design, LANDMARKS, money, sig, STAGES } from '../src/model.ts';

const root = new URL('../', import.meta.url);
const font = readFileSync(new URL('assets/fonts/Geist-readme.woff2', root)).toString('base64');
const THEMES = {
  light: { paper: '#f2eee5', ink: '#15140f', mute: 'rgba(21,20,15,.6)', rule: 'rgba(21,20,15,.16)', accent: '#d4491a' },
  dark: { paper: '#15140f', ink: '#f2eee5', mute: 'rgba(242,238,229,.6)', rule: 'rgba(242,238,229,.2)', accent: '#ff6b3d' },
};
type Theme = (typeof THEMES)['light'];
const LABELS = ['1', '10', '100', '1K', '10K', '100K', '1M', '10M', '100M', '1B'];
const n1 = (v: number) => v.toFixed(1);

const style = (t: Theme, extra = '') => `<style>
@font-face{font-family:G;font-weight:100 900;src:url(data:font/woff2;base64,${font}) format("woff2")}
text{font-family:G,"Helvetica Neue",Helvetica,Arial,sans-serif;fill:${t.ink}}
.cap{font-size:13px;letter-spacing:.18em;font-weight:500}
.sm{font-size:12px;letter-spacing:.04em}
.b{font-size:17px;font-weight:600;letter-spacing:-.3px}
.mute{fill:${t.mute}}
.acc{fill:${t.accent}}
.ln{stroke:${t.ink};fill:none;stroke-width:1.25}
.hair{stroke:${t.rule};fill:none;stroke-width:1}
.rise{animation:rise 1.2s cubic-bezier(.16,1,.3,1) both}
@keyframes rise{from{transform:translateY(40px);opacity:0}}
.col{animation:grow 1.1s cubic-bezier(.16,1,.3,1) both;transform-box:fill-box;transform-origin:bottom}
@keyframes grow{from{transform:scaleY(0)}}
.rule{stroke-dasharray:1400;animation:draw 1.6s cubic-bezier(.87,0,.13,1) both}
@keyframes draw{from{stroke-dashoffset:1400}}
${extra}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>`;

const open = (w: number, h: number, t: Theme, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">\n${style(t, extra)}\n<rect width="${w}" height="${h}" fill="${t.paper}"/>\n`;

// ------------------------------------------------------------------ hero
function hero(t: Theme): string {
  const W = 1280;
  const H = 560;
  const base = 470;
  const x0 = 700;
  const colW = 54;
  const cell = 9;
  let cols = '';
  LABELS.forEach((label, k) => {
    const s = design(10 ** k);
    const machines = s.hasSeparateDb ? s.servers : 1;
    // Square-root scale so one machine and eleven thousand both fit; the caption says so.
    const n = Math.max(1, Math.round(Math.sqrt(machines) * 1.6));
    const x = x0 + k * colW;
    let sq = '';
    for (let i = 0; i < n; i++) sq += `<rect x="${x + (i % 4) * cell}" y="${base - 8 - Math.floor(i / 4) * cell}" width="6.5" height="6.5"/>`;
    cols += `<g class="col" style="animation-delay:${(k * 0.09).toFixed(2)}s" fill="${t.ink}">${sq}</g>`;
    cols += `<text class="sm mute" x="${x + 16}" y="${base + 22}" text-anchor="middle">${label}</text>`;
  });
  const extra = `.dot{animation:run 7s cubic-bezier(.45,0,.55,1) infinite}
@keyframes run{from{transform:translateX(0)}90%,to{transform:translateX(${9 * colW}px)}}`;
  return `${open(W, H, t, extra)}<text class="cap" x="56" y="72">FROM 1 USER TO 1,000,000,000</text>
<g class="rise"><text x="46" y="300" font-size="150" font-weight="500" letter-spacing="-9">Nine</text><text x="46" y="430" font-size="150" font-weight="500" letter-spacing="-9">Zeros</text><circle cx="408" cy="421" r="10" fill="${t.accent}"/></g>
<path class="ln rule" d="M${x0 - 10} ${base}H${x0 + 9 * colW + 44}"/>
${cols}
<circle class="dot" cx="${x0 + 16}" cy="${base}" r="6" fill="${t.accent}"/>
<text class="sm mute" x="${x0 - 10}" y="96">machines needed, on a square-root scale</text>
<text x="${x0 - 10}" y="136" font-size="22" letter-spacing="-.4">One slider. Watch a system grow,</text>
<text x="${x0 - 10}" y="165" font-size="22" letter-spacing="-.4">see <tspan class="acc">what breaks</tspan> and what it costs.</text>
</svg>
`;
}

// ------------------------------------------------------------------ the seven stages
function stages(t: Theme): string {
  const W = 1280;
  const H = 380;
  const x0 = 56;
  const x1 = W - 56;
  const y = 196;
  const X = (users: number) => x0 + (Math.log10(users) / 9) * (x1 - x0);
  let out = '';
  LABELS.forEach((label, k) => {
    const x = x0 + (k / 9) * (x1 - x0);
    out += `<path class="ln" d="M${n1(x)} ${y - 6}V${y + 6}"/><text class="sm mute" x="${n1(x)}" y="${y + 26}" text-anchor="middle">${label}</text>`;
  });
  STAGES.forEach((s, i) => {
    const x = X(s.from);
    const up = i % 2 === 0;
    const yy = up ? y - 92 : y - 48;
    const anchor = i === 0 ? 'start' : 'middle';
    out += `<path class="hair" d="M${n1(x)} ${y - 8}V${yy + 26}"/>`;
    out += `<text class="sm acc" x="${n1(x)}" y="${yy}" text-anchor="${anchor}">Stage ${i + 1}</text>`;
    out += `<text class="b" x="${n1(x)}" y="${yy + 19}" text-anchor="${anchor}">${s.title}</text>`;
  });
  LANDMARKS.forEach((l, i) => {
    const x = X(l.users);
    const yy = y + 74 + (i % 2) * 44;
    const anchor = l.users > 3e8 ? 'end' : 'middle';
    out += `<path class="hair" d="M${n1(x)} ${y + 34}V${yy - 16}"/><rect x="${n1(x - 4)}" y="${y - 4}" width="8" height="8" transform="rotate(45 ${n1(x)} ${y})" fill="${t.accent}"/>`;
    out += `<text class="b" x="${n1(x)}" y="${yy}" text-anchor="${anchor}">${l.name}, ${l.when.split(' ').pop()}</text>`;
    out += `<text class="sm mute" x="${n1(x)}" y="${yy + 17}" text-anchor="${anchor}">${l.headline}</text>`;
  });
  return `${open(W, H, t)}<text class="cap" x="56" y="40">SEVEN STAGES, NINE ZEROS</text>
<text class="sm mute" x="${x1}" y="40" text-anchor="end">daily users, each tick ten times the last · diamonds are real companies</text>
<path class="ln rule" d="M${x0} ${y}H${x1}"/>
${out}
</svg>
`;
}

// ------------------------------------------------------------------ the queue curve
function queue(t: Theme): string {
  const W = 1280;
  const H = 400;
  const x0 = 96;
  const x1 = 820;
  const yBase = 330;
  const yTop = 70;
  const maxTimes = 50;
  const X = (load: number) => x0 + load * (x1 - x0);
  const Y = (times: number) => yBase - (Math.min(times, maxTimes) / maxTimes) * (yBase - yTop);
  let d = '';
  for (let load = 0; load <= 0.98001; load += 0.005) d += `${d ? 'L' : 'M'}${n1(X(load))} ${n1(Y(1 / (1 - load)))}`;
  let out = '';
  for (const load of [0, 0.25, 0.5, 0.75, 1]) {
    out += `<path class="hair" d="M${n1(X(load))} ${yBase}V${yTop}"/><text class="sm mute" x="${n1(X(load))}" y="${yBase + 22}" text-anchor="middle">${load * 100}%</text>`;
  }
  for (const times of [10, 25, 50]) {
    out += `<path class="hair" d="M${x0} ${n1(Y(times))}H${x1}"/><text class="sm mute" x="${x0 - 10}" y="${n1(Y(times) + 4)}" text-anchor="end">${times}×</text>`;
  }
  let pts = '';
  for (const load of [0.5, 0.9, 0.98]) {
    pts += `<circle cx="${n1(X(load))}" cy="${n1(Y(1 / (1 - load)))}" r="5" fill="${t.ink}" stroke="${t.paper}" stroke-width="1.5"/>`;
  }
  const ms = (load: number) => {
    const v = DEFAULTS.serviceMs / (1 - load);
    return v >= 999.5 ? `${sig(v / 1000)} s` : `${sig(v)} ms`;
  };
  const rows: [string, string, string][] = [
    ['50% busy', '2× slower', `a ${DEFAULTS.serviceMs} ms request takes ${ms(0.5)}`],
    ['90% busy', '10× slower', `a ${DEFAULTS.serviceMs} ms request takes ${ms(0.9)}`],
    ['98% busy', '50× slower', `a ${DEFAULTS.serviceMs} ms request takes ${ms(0.98)}`],
    ['100% and over', 'never', 'the queue only grows, and requests start to fail'],
  ];
  let table = '';
  rows.forEach(([a, b, c], i) => {
    const yy = 150 + i * 56;
    table += `<path class="hair" d="M880 ${yy - 30}H1224"/><text class="b" x="880" y="${yy}">${a}</text><text class="b${i === 3 ? ' acc' : ''}" x="1224" y="${yy}" text-anchor="end">${b}</text><text class="sm mute" x="880" y="${yy + 18}">${c}</text>`;
  });
  const extra = `.curve{stroke:${t.accent};stroke-width:2.5;fill:none;stroke-dasharray:1400;animation:draw 2.6s cubic-bezier(.45,0,.55,1) both}`;
  return `${open(W, H, t, extra)}<text class="cap" x="56" y="40">WHY 95 PERCENT IS NOT NEARLY FINE</text>
<text class="sm mute" x="${x0}" y="${yTop - 12}">response time, as a multiple of an idle server</text>
${out}
<path class="ln" d="M${x0} ${yBase}H${x1}"/>
<path class="curve" d="${d}"/>
${pts}
<text class="sm mute" x="${(x0 + x1) / 2}" y="${yBase + 46}" text-anchor="middle">how busy the servers are</text>
<text class="sm mute" x="880" y="100">mean response = service time ÷ (1 − load)</text>
${table}
</svg>
`;
}

// ------------------------------------------------------------------ the bill
function bill(t: Theme): string {
  const W = 1280;
  const H = 380;
  const x0 = 56;
  const colW = (W - 112) / 10;
  const base = 290;
  const maxH = 190;
  const parts: ['compute' | 'database' | 'cache' | 'storage' | 'transfer', string, number][] = [
    ['compute', 'servers', 1], ['database', 'database', 0.72], ['cache', 'cache', 0.5], ['storage', 'storage', 0.34], ['transfer', 'data sent to users', 1],
  ];
  const top = Math.log10(design(1e9).cost.total / 10);
  let out = '';
  LABELS.forEach((label, k) => {
    const s = design(10 ** k);
    const x = x0 + k * colW;
    // Bar height on a log scale of the total; the split inside each bar is its true share.
    const hBar = 12 + (Math.log10(s.cost.total / 10) / top) * (maxH - 12);
    let y = base;
    let bar = '';
    for (const [key, , op] of parts) {
      const hh = (s.cost[key] / s.cost.total) * hBar;
      if (hh < 0.2) continue;
      y -= hh;
      bar += `<rect x="${n1(x + 14)}" y="${n1(y)}" width="${n1(colW - 28)}" height="${n1(hh)}" fill="${key === 'transfer' ? t.accent : t.ink}" opacity="${op}"/>`;
    }
    out += `<g class="col" style="animation-delay:${(k * 0.07).toFixed(2)}s">${bar}</g>`;
    out += `<text class="b" x="${n1(x + colW / 2)}" y="${n1(base - hBar - 12)}" text-anchor="middle">${money(s.cost.total).replace(' million', 'M')}</text>`;
    out += `<text class="sm mute" x="${n1(x + colW / 2)}" y="${base + 22}" text-anchor="middle">${label} ${k === 0 ? "user" : "users"}</text>`;
    out += `<text class="sm acc" x="${n1(x + colW / 2)}" y="${base + 40}" text-anchor="middle">${money(s.costPerUser)} each</text>`;
  });
  let legend = '';
  let lx = 56;
  for (const [key, name, op] of parts) {
    legend += `<rect x="${lx}" y="${H - 26}" width="10" height="10" fill="${key === 'transfer' ? t.accent : t.ink}" opacity="${op}"/><text class="sm mute" x="${lx + 16}" y="${H - 17}">${name}</text>`;
    lx += 34 + name.length * 7.4;
  }
  return `${open(W, H, t)}<text class="cap" x="56" y="40">THE BILL, A MONTH</text>
<text class="sm mute" x="${W - 56}" y="40" text-anchor="end">bar heights on a log scale · the split inside each bar is its true share</text>
<path class="ln rule" d="M56 ${base}H${W - 56}"/>
${out}
${legend}
</svg>
`;
}

for (const [name, t] of Object.entries(THEMES)) {
  writeFileSync(new URL(`assets/hero-${name}.svg`, root), hero(t));
  writeFileSync(new URL(`assets/stages-${name}.svg`, root), stages(t));
  writeFileSync(new URL(`assets/queue-${name}.svg`, root), queue(t));
  writeFileSync(new URL(`assets/bill-${name}.svg`, root), bill(t));
}
console.log('README graphics written');
