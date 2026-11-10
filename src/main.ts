import '@fontsource-variable/geist/wght.css';
import './style.css';
import { Diagram } from './diagram.ts';
import {
  DEFAULTS,
  design,
  duration,
  LANDMARKS,
  money,
  PRICES,
  sig,
  STAGES,
  strain,
  usersAt,
  words,
  type Assumptions,
  type System,
} from './model.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const params = new URLSearchParams(location.search);

let assumptions: Assumptions = { ...DEFAULTS };
/** Slider position: log10 of daily users, 0 to 9. */
let position = Math.min(9, Math.max(0, Number(params.get('at') ?? 0) || 0));
let frozen: System | null = null;
let playing = false;

const diagram = new Diagram($<HTMLCanvasElement>('diagram'), reduced);
const set = (el: HTMLElement, s: string) => {
  if (el.textContent !== s) el.textContent = s;
};

// ---- the rail ---------------------------------------------------------------------------------
const rail = $('rail');
const ticks = $('rail-ticks');
const marks = $('rail-marks');
const TICK_LABELS = ['1', '10', '100', '1K', '10K', '100K', '1M', '10M', '100M', '1B'];
TICK_LABELS.forEach((t, i) => {
  const s = document.createElement('span');
  s.style.left = `${(i / 9) * 100}%`;
  const b = document.createElement('b');
  b.style.left = `${(i / 9) * 100}%`;
  b.textContent = t;
  ticks.append(s, b);
});
LANDMARKS.forEach((l, i) => {
  const b = document.createElement('button');
  b.style.left = `${(Math.log10(l.users) / 9) * 100}%`;
  // Two WhatsApp pins sit close together: only the first carries the name.
  const span = document.createElement('span');
  span.className = i % 2 === 0 ? 'l' : 'r';
  span.textContent = LANDMARKS.findIndex((x) => x.name === l.name) === i ? l.name : '';
  b.append(span);
  b.title = `${l.name}, ${l.when}: ${l.headline}`;
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', () => glide(Math.log10(l.users)));
  marks.append(b);
});

function railTo(e: PointerEvent): void {
  const r = rail.getBoundingClientRect();
  stopPlay();
  position = Math.min(9, Math.max(0, ((e.clientX - r.left) / r.width) * 9));
  render();
}
rail.addEventListener('pointerdown', (e) => {
  rail.setPointerCapture(e.pointerId);
  railTo(e);
});
rail.addEventListener('pointermove', (e) => {
  if (rail.hasPointerCapture(e.pointerId)) railTo(e);
});

// ---- motion -----------------------------------------------------------------------------------
let glideTo: number | null = null;
function glide(target: number): void {
  stopPlay();
  if (reduced) {
    position = target;
    render();
    return;
  }
  glideTo = target;
}
const btnPlay = $('btn-play');
function stopPlay(): void {
  glideTo = null;
  if (!playing) return;
  playing = false;
  btnPlay.classList.remove('on');
  set(btnPlay.querySelector<HTMLElement>('.txt')!, 'Grow');
}
function togglePlay(): void {
  if (playing) return stopPlay();
  glideTo = null;
  if (position > 8.98) position = 0;
  playing = true;
  btnPlay.classList.add('on');
  set(btnPlay.querySelector<HTMLElement>('.txt')!, 'Pause');
}
btnPlay.addEventListener('click', togglePlay);

let last = performance.now();
function tick(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (playing) {
    // Nine zeros in about fifty seconds; reduced motion steps a zero at a time.
    position = reduced ? Math.min(9, Math.floor(position + dt * 0.25 + 1e-9) === Math.floor(position) ? position + dt * 0.25 : Math.floor(position + dt * 0.25)) : Math.min(9, position + dt * 0.18);
    if (position >= 9) stopPlay();
    render();
  } else if (glideTo !== null) {
    position += (glideTo - position) * (1 - Math.exp(-dt / 0.22));
    if (Math.abs(glideTo - position) < 0.004) {
      position = glideTo;
      glideTo = null;
    }
    render();
  }
  requestAnimationFrame(tick);
}

// ---- freeze -----------------------------------------------------------------------------------
const btnFreeze = $('btn-freeze');
function toggleFreeze(): void {
  frozen = frozen ? null : design(usersAt(position), assumptions);
  btnFreeze.setAttribute('aria-pressed', String(!!frozen));
  set(btnFreeze, frozen ? 'Unfreeze' : 'Freeze the system');
  $('strain').hidden = !frozen;
  render();
}
btnFreeze.addEventListener('click', toggleFreeze);

// ---- render -----------------------------------------------------------------------------------
const story = document.querySelector<HTMLElement>('.story')!;
let shownStage = -1;
let shownLandmark = -1;

function render(): void {
  const users = usersAt(position);
  const live = design(users, assumptions);
  const sys = frozen ?? live;
  const st = frozen ? strain(frozen, users, assumptions) : null;
  diagram.set(sys, st, position);

  set($('users'), sig(users, 2));
  set($('users-unit'), users === 1 ? 'person a day' : 'people a day');
  rail.setAttribute('aria-valuenow', String(users));
  rail.setAttribute('aria-valuetext', `${words(users, 2)} people a day`);
  $('rail-fill').style.width = `${(position / 9) * 100}%`;
  $('rail-thumb').style.left = `${(position / 9) * 100}%`;
  const bs = ticks.querySelectorAll('b');
  bs.forEach((b, i) => b.classList.toggle('on', i === Math.round(position)));

  const perSecond = live.peakRps;
  const s3 = $('s3-v');
  const s4 = $('s4-v');
  if (st) {
    set($('s1-k'), 'Load on the frozen system');
    set($('s1-v'), `${sig(st.utilisation * 100, 3)}%`);
    set($('s2-k'), 'Typical response');
    set($('s2-v'), duration(st.meanMs));
    set($('s3-k'), 'Slowest 1 in 100');
    set(s3, duration(st.p99Ms));
    set($('s4-k'), 'Requests failing');
    set(s4, `${sig(st.dropped * 100, 2)}%`);
    s3.classList.toggle('hot', st.utilisation >= 0.9);
    s4.classList.toggle('hot', st.dropped > 0);
    $('s1-v').classList.toggle('hot', st.utilisation >= 1);
    set($('frozen-at'), words(frozen!.users, 2));
    const bar = $('strain-bar');
    bar.style.width = `${Math.min(100, st.utilisation * 100)}%`;
    bar.classList.toggle('over', st.utilisation >= 1);
    set(
      $('strain-text'),
      st.utilisation < 0.7
        ? 'Plenty of room. Keep dragging to the right.'
        : st.utilisation < 1
          ? `The ${st.bottleneck} are ${sig(st.utilisation * 100, 2)}% busy. Each request now waits behind others, and the wait grows faster than the load.`
          : `More is arriving than the ${st.bottleneck} can ever serve. ${sig(st.dropped * 100, 2)}% of requests fail, and the rest wait in a queue that never empties.`,
    );
  } else {
    set($('s1-k'), 'Requests, busiest second');
    set($('s1-v'), perSecond < 1 ? 'under 1' : words(perSecond));
    set($('s2-k'), 'Machines');
    set($('s2-v'), sig(live.hasSeparateDb ? live.servers : 1));
    set($('s3-k'), 'Cloud bill, a month');
    set(s3, money(live.cost.total));
    set($('s4-k'), 'Per user, a month');
    set(s4, money(live.costPerUser));
    for (const el of [s3, s4, $('s1-v')]) el.classList.remove('hot');
  }

  if (sys.stage !== shownStage) {
    shownStage = sys.stage;
    const stage = STAGES[sys.stage];
    set($('stage-count'), `Stage ${sys.stage + 1} of ${STAGES.length}`);
    set($('stage-title'), stage.title);
    set($('stage-text'), stage.text);
    set($('stage-next'), stage.next);
    story.classList.remove('swap');
    void story.offsetWidth;
    story.classList.add('swap');
  }

  // A real company's card appears while the slider is beside its pin.
  let near = -1;
  LANDMARKS.forEach((l, i) => {
    if (Math.abs(Math.log10(l.users) - position) < 0.09) near = i;
  });
  marks.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === near));
  if (near !== shownLandmark) {
    shownLandmark = near;
    const card = $('landmark');
    card.hidden = near < 0;
    if (near >= 0) {
      const l = LANDMARKS[near];
      set($('lm-name'), `${l.name}, ${l.when}`);
      set($('lm-headline'), l.headline);
      set($('lm-detail'), l.detail);
      const a = $<HTMLAnchorElement>('lm-source');
      a.textContent = l.source.label;
      a.href = l.source.url;
    }
  }
}

// ---- assumptions ------------------------------------------------------------------------------
const FIELDS: [keyof Assumptions, string, number][] = [
  ['requestsPerUser', 'Requests per user, a day', 1],
  ['peakFactor', 'Peak, as a multiple of average', 0.1],
  ['readShare', 'Share of requests that only read', 0.01],
  ['queriesPerRequest', 'Database queries per request', 0.5],
  ['cacheHitRate', 'Reads answered by the cache', 0.01],
  ['appServerRps', 'Requests a second, per app server', 10],
  ['targetUtilisation', 'How full a server may run', 0.05],
  ['dbReadQps', 'Reads a second, per database machine', 100],
  ['dbWriteQps', 'Writes a second, per primary', 100],
  ['dbNodeTb', 'Terabytes per database machine', 0.5],
  ['dbMbPerUser', 'Megabytes of data per user', 0.5],
  ['filesMbPerUser', 'Megabytes of files per user', 1],
  ['responseKb', 'Kilobytes sent per request', 1],
  ['jobShare', 'Share of requests that leave a job', 0.01],
  ['workerJobsPerSecond', 'Jobs a second, per worker', 5],
  ['serviceMs', 'Milliseconds per request when idle', 1],
];
const form = $<HTMLFormElement>('assume-form');
function fillForm(): void {
  form.replaceChildren();
  for (const [key, label, step] of FIELDS) {
    const l = document.createElement('label');
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    input.min = '0';
    input.value = String(assumptions[key]);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v) || v <= 0) return;
      const share = key === 'readShare' || key === 'cacheHitRate' || key === 'targetUtilisation' || key === 'jobShare';
      assumptions = { ...assumptions, [key]: share ? Math.min(0.99, v) : v };
      if (frozen) frozen = design(frozen.users, assumptions);
      render();
    });
    l.append(span, input);
    form.append(l);
  }
}
fillForm();
$('assume-reset').addEventListener('click', () => {
  assumptions = { ...DEFAULTS };
  fillForm();
  render();
});
const priceRows: [string, string][] = [
  ['The one small server (t4g.small)', `$${PRICES.smallBox} an hour`],
  ['App server or worker (m7g.xlarge)', `$${PRICES.appServer} an hour`],
  ['Database, early (RDS db.m7g.large)', `$${PRICES.dbSmall} an hour`],
  ['Database, later (RDS db.r7g.2xlarge)', `$${PRICES.dbLarge} an hour`],
  ['Cache machine (ElastiCache cache.r7g.large)', `$${PRICES.cacheNode} an hour`],
  ['Load balancer (ALB, before usage)', `$${PRICES.loadBalancer} an hour`],
  ['File storage (S3 Standard)', `$${PRICES.storageGbMonth} a GB a month`],
  ['Data sent to users (CloudFront, first tier)', `$${PRICES.transferGb} a GB`],
];
for (const [k, v] of priceRows) {
  const tr = document.createElement('tr');
  const a = document.createElement('td');
  a.textContent = k;
  const b = document.createElement('td');
  b.textContent = v;
  tr.append(a, b);
  $('price-table').append(tr);
}

for (const [btn, dlg] of [['btn-assume', 'assume'], ['btn-about', 'about']] as const) {
  const d = $<HTMLDialogElement>(dlg);
  $(btn).addEventListener('click', () => {
    stopPlay();
    d.showModal();
  });
  d.addEventListener('click', (e) => {
    if (e.target === d || (e.target as HTMLElement).hasAttribute('data-close')) d.close();
  });
}

// ---- wheel and keys ---------------------------------------------------------------------------
addEventListener(
  'wheel',
  (e) => {
    if (document.querySelector('dialog[open]')) return;
    if (matchMedia('(max-width: 860px)').matches) return; // small screens scroll the page
    e.preventDefault();
    stopPlay();
    const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    position = Math.min(9, Math.max(0, position + d * 0.0016));
    render();
  },
  { passive: false },
);
addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT') return;
  const step = e.shiftKey ? 1 : 0.06;
  switch (e.key) {
    case 'ArrowRight': case 'ArrowUp': stopPlay(); position = Math.min(9, e.shiftKey ? Math.floor(position + 1 + 1e-6) : position + step); break;
    case 'ArrowLeft': case 'ArrowDown': stopPlay(); position = Math.max(0, e.shiftKey ? Math.ceil(position - 1 - 1e-6) : position - step); break;
    case 'Home': stopPlay(); position = 0; break;
    case 'End': stopPlay(); position = 9; break;
    case ' ': if (tag === 'BUTTON') return; togglePlay(); break;
    case 'f': case 'F': toggleFreeze(); break;
    default: return;
  }
  e.preventDefault();
  render();
});
document.querySelector('.mark')!.addEventListener('click', (e) => {
  e.preventDefault();
  if (frozen) toggleFreeze();
  glide(0);
});

render();
diagram.start();
requestAnimationFrame(tick);
document.fonts?.ready.then(render);
if (params.has('play')) togglePlay();
(window as unknown as { nz: unknown }).nz = {
  go: (p: number) => {
    stopPlay();
    position = p;
    render();
  },
  freeze: toggleFreeze,
};
