/**
 * Writes the README title graphic (light and dark): the name beside ten blocks of squares, one
 * for each power of ten, sized by how many machines the model says that many users need.
 * Run with `npm run readme`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { design } from '../src/model.ts';

const root = new URL('../', import.meta.url);
const font = readFileSync(new URL('assets/fonts/Geist-readme.woff2', root)).toString('base64');
const THEMES = {
  light: { paper: '#f2eee5', ink: '#15140f', mute: 'rgba(21,20,15,.6)', rule: 'rgba(21,20,15,.16)', accent: '#d4491a' },
  dark: { paper: '#15140f', ink: '#f2eee5', mute: 'rgba(242,238,229,.6)', rule: 'rgba(242,238,229,.2)', accent: '#ff6b3d' },
};

function hero(t: (typeof THEMES)['light']): string {
  const W = 1280;
  const H = 560;
  const base = 470;
  const x0 = 700;
  const colW = 54;
  const cell = 9;
  const labels = ['1', '10', '100', '1K', '10K', '100K', '1M', '10M', '100M', '1B'];
  let cols = '';
  labels.forEach((label, k) => {
    const s = design(10 ** k);
    const machines = s.hasSeparateDb ? s.servers : 1;
    // Square-root scale so one machine and eleven thousand both fit; the label says so.
    const n = Math.max(1, Math.round(Math.sqrt(machines) * 1.6));
    const x = x0 + k * colW;
    let sq = '';
    for (let i = 0; i < n; i++) {
      const cx = x + (i % 4) * cell;
      const cy = base - 8 - Math.floor(i / 4) * cell;
      sq += `<rect x="${cx}" y="${cy}" width="6.5" height="6.5"/>`;
    }
    cols += `<g class="col" style="animation-delay:${(k * 0.09).toFixed(2)}s" fill="${t.ink}">${sq}</g>`;
    cols += `<text class="sm mute" x="${x + 16}" y="${base + 22}" text-anchor="middle">${label}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">
<style>
@font-face{font-family:G;font-weight:100 900;src:url(data:font/woff2;base64,${font}) format("woff2")}
text{font-family:G,"Helvetica Neue",Helvetica,Arial,sans-serif;fill:${t.ink}}
.cap{font-size:13px;letter-spacing:.18em;font-weight:500}
.sm{font-size:12px;letter-spacing:.04em}
.mute{fill:${t.mute}}
.acc{fill:${t.accent}}
.ln{stroke:${t.ink};fill:none;stroke-width:1.25}
.rise{animation:rise 1.2s cubic-bezier(.16,1,.3,1) both}
@keyframes rise{from{transform:translateY(40px);opacity:0}}
.col{animation:grow 1.1s cubic-bezier(.16,1,.3,1) both;transform-box:fill-box;transform-origin:bottom}
@keyframes grow{from{transform:scaleY(0)}}
.rule{stroke-dasharray:1300;animation:draw 1.6s cubic-bezier(.87,0,.13,1) both}
@keyframes draw{from{stroke-dashoffset:1300}}
.dot{animation:run 7s cubic-bezier(.45,0,.55,1) infinite}
@keyframes run{from{transform:translateX(0)}90%,to{transform:translateX(${9 * colW}px)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
<rect width="${W}" height="${H}" fill="${t.paper}"/>
<text class="cap" x="56" y="72">FROM 1 USER TO 1,000,000,000</text>
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
for (const [name, t] of Object.entries(THEMES)) writeFileSync(new URL(`assets/hero-${name}.svg`, root), hero(t));
console.log('README graphics written');
