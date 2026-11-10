/**
 * The living diagram: the system as ink squares on paper, with requests flowing through it as
 * orange dots. Plain 2D canvas, redrawn every frame; a few hundred dots and squares at most.
 */
import { sig, type Strain, type System } from './model.ts';

const INK = '#15140f';
const PAPER = '#f2eee5';
const ACCENT = '#d4491a';
const MUTE = 'rgba(21,20,15,0.6)';
const RULE = 'rgba(21,20,15,0.16)';
const FONT = '"Geist Variable", "Helvetica Neue", Helvetica, Arial, sans-serif';

type NodeId = 'users' | 'cdn' | 'lb' | 'app' | 'cache' | 'workers' | 'db' | 'files';

interface NodeDef {
  id: NodeId;
  x: number;
  y: number;
  /** Most squares drawn before each square starts to stand for ten, a hundred... */
  maxDots: number;
  /** Width to height of the block of squares. */
  aspect: number;
  present: (s: System) => boolean;
  count: (s: System) => number;
  label: (s: System, n: number) => string;
}

const one = (n: number, single: string, many: string) => (n === 1 ? single : many);

const NODES: NodeDef[] = [
  { id: 'users', x: 0.5, y: 0.035, maxDots: 0, aspect: 1, present: () => true, count: () => 0, label: () => 'People' },
  { id: 'cdn', x: 0.13, y: 0.215, maxDots: 0, aspect: 1, present: (s) => s.hasCdn, count: () => 0, label: () => 'CDN, near the user' },
  { id: 'lb', x: 0.5, y: 0.215, maxDots: 40, aspect: 8, present: (s) => s.hasLoadBalancer, count: (s) => s.loadBalancers, label: (_s, n) => one(n, 'load balancer', 'load balancers') },
  {
    id: 'app', x: 0.5, y: 0.405, maxDots: 170, aspect: 6, present: () => true, count: (s) => s.appServers,
    label: (s, n) => (s.hasSeparateDb ? one(n, 'app server', 'app servers') : 'server for everything'),
  },
  { id: 'cache', x: 0.13, y: 0.63, maxDots: 48, aspect: 4, present: (s) => s.hasCache, count: (s) => s.cacheNodes, label: (_s, n) => one(n, 'cache', 'cache machines') },
  { id: 'workers', x: 0.87, y: 0.63, maxDots: 60, aspect: 4, present: (s) => s.hasQueue, count: (s) => s.workers, label: (_s, n) => one(n, 'worker', 'workers') },
  {
    id: 'db', x: 0.5, y: 0.775, maxDots: 180, aspect: 6, present: (s) => s.hasSeparateDb, count: (s) => s.dbNodes,
    label: (s, n) => (s.shards > 1 ? `database machines in ${sig(s.shards)} shards` : one(n, 'database', 'database machines')),
  },
  { id: 'files', x: 0.87, y: 0.86, maxDots: 0, aspect: 1, present: (s) => s.hasObjectStorage, count: () => 0, label: (s) => `${sig(s.storageTb >= 1000 ? s.storageTb / 1000 : s.storageTb, 2)} ${s.storageTb >= 1000 ? 'PB' : 'TB'} of files` },
];

interface NodeView {
  alpha: number;
  shown: number;
  top: number;
  bottom: number;
  cx: number;
}

interface Particle {
  path: NodeId[];
  seg: number;
  t: number;
  speed: number;
  off: number;
  falling: boolean;
  x: number;
  y: number;
  vy: number;
  life: number;
}

function routes(s: System): { path: NodeId[]; w: number }[] {
  const main: NodeId[] = s.hasLoadBalancer ? ['users', 'lb', 'app'] : ['users', 'app'];
  const out: { path: NodeId[]; w: number }[] = [];
  if (s.hasCdn) out.push({ path: ['users', 'cdn'], w: 0.25 });
  if (!s.hasSeparateDb) {
    out.push({ path: main, w: 1 });
    return out;
  }
  const cache = s.hasCache ? 0.5 : 0;
  const jobs = s.hasQueue ? 0.12 : 0;
  const files = s.hasObjectStorage ? 0.1 : 0;
  if (cache) out.push({ path: [...main, 'cache'], w: cache });
  if (jobs) out.push({ path: [...main, 'workers', 'db'], w: jobs });
  if (files) out.push({ path: [...main, 'files'], w: files });
  out.push({ path: [...main, 'db'], w: 1 - cache - jobs - files });
  return out;
}

export class Diagram {
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private views = new Map<NodeId, NodeView>();
  private particles: Particle[] = [];
  private sys!: System;
  private strain: Strain | null = null;
  private position = 0;
  private regionAlpha = 0;
  private last = 0;
  private spawnDebt = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private reduced: boolean,
  ) {
    this.ctx = canvas.getContext('2d')!;
    for (const n of NODES) this.views.set(n.id, { alpha: 0, shown: 1, top: 0, bottom: 0, cx: 0 });
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  set(sys: System, strain: Strain | null, position: number): void {
    this.sys = sys;
    this.strain = strain;
    this.position = position;
  }

  start(): void {
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000 || 0.016);
      this.last = now;
      this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private frame(dt: number): void {
    if (!this.sys) return;
    const { ctx, w, h, sys } = this;
    const ease = (tau: number) => 1 - Math.exp(-dt / tau);
    ctx.clearRect(0, 0, w, h);
    const small = w < 520;
    const cell = Math.max(6, Math.min(11, w / 96));
    const sq = cell * 0.66;

    // ---- ease every node towards what the system now has ----
    for (const n of NODES) {
      const v = this.views.get(n.id)!;
      const present = n.present(sys);
      v.alpha += ((present ? 1 : 0) - v.alpha) * ease(this.reduced ? 0.001 : 0.22);
      const target = Math.max(1, n.count(sys));
      v.shown = Math.exp(Math.log(v.shown) + (Math.log(target) - Math.log(v.shown)) * ease(this.reduced ? 0.001 : 0.16));
      v.cx = n.x * w;
      v.top = n.y * h;
      v.bottom = v.top + 30;
    }
    this.regionAlpha += ((sys.regions > 1 ? 1 : 0) - this.regionAlpha) * ease(0.3);

    // ---- regions: sheets of paper stacked behind the system ----
    if (this.regionAlpha > 0.01) {
      const x0 = w * 0.02;
      const y0 = h * 0.15;
      const fw = w * 0.96;
      const fh = h * 0.83;
      for (let k = Math.min(4, sys.regions - 1); k >= 0; k--) {
        const o = k * Math.min(9, w / 90);
        ctx.globalAlpha = this.regionAlpha * (k === 0 ? 1 : 0.55);
        ctx.fillStyle = PAPER;
        ctx.strokeStyle = k === 0 ? MUTE : RULE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x0 + o, y0 - o, fw - o * 2 - (k ? 0 : 0), fh, 4);
        ctx.fill();
        ctx.stroke();
      }
      ctx.globalAlpha = this.regionAlpha;
      ctx.fillStyle = MUTE;
      ctx.font = `600 ${small ? 10 : 12}px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(`Region 1 of ${sys.regions}: the others are copies of this`, x0 + 14, y0 + fh - 14);
      ctx.globalAlpha = 1;
    }

    // ---- lay out blocks of squares (needed for where the lines join) ----
    const blocks = new Map<NodeId, { cols: number; rows: number; dots: number; unit: number; cell: number }>();
    for (const n of NODES) {
      const v = this.views.get(n.id)!;
      if (n.maxDots === 0) continue;
      let unit = 1;
      while (v.shown / unit > n.maxDots) unit *= 10;
      const dots = v.shown / unit;
      const big = dots < 1.5 ? 3 : dots < 9 ? 1.9 : dots < 30 ? 1.35 : 1;
      const c = cell * big;
      const cols = Math.max(1, Math.min(Math.ceil(dots), Math.ceil(Math.sqrt(Math.ceil(dots) * n.aspect))));
      const rows = Math.ceil(Math.ceil(dots) / cols);
      blocks.set(n.id, { cols, rows, dots, unit, cell: c });
      v.bottom = v.top + 22 + rows * c + (unit > 1 ? 16 : 4);
    }

    // ---- connecting lines ----
    const rs = routes(sys);
    const seen = new Set<string>();
    ctx.lineWidth = 1;
    for (const r of rs) {
      for (let i = 0; i + 1 < r.path.length; i++) {
        const key = `${r.path[i]}>${r.path[i + 1]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const a = this.views.get(r.path[i])!;
        const b = this.views.get(r.path[i + 1])!;
        ctx.globalAlpha = Math.min(a.alpha, b.alpha) * 0.9;
        ctx.strokeStyle = RULE;
        ctx.beginPath();
        const [p0, p1, p2, p3] = this.curve(a, b);
        ctx.moveTo(p0[0], p0[1]);
        ctx.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
        ctx.stroke();
        if (key === 'app>workers') {
          ctx.fillStyle = MUTE;
          ctx.font = `500 ${small ? 10 : 11}px ${FONT}`;
          ctx.textAlign = 'center';
          const m = this.point(a, b, 0.55);
          ctx.fillText('queue', m[0] + 22, m[1] - 4);
        }
      }
    }
    ctx.globalAlpha = 1;

    // ---- requests ----
    this.stepParticles(dt, rs);
    for (const p of this.particles) {
      ctx.globalAlpha = p.falling ? Math.max(0, p.life) : 0.95;
      ctx.fillStyle = p.falling ? INK : ACCENT;
      ctx.beginPath();
      ctx.arc(p.x, p.y, small ? 1.7 : 2.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ---- nodes ----
    const load = this.strain?.utilisation ?? 0;
    for (const n of NODES) {
      const v = this.views.get(n.id)!;
      if (v.alpha < 0.01) continue;
      ctx.globalAlpha = v.alpha;
      const count = Math.round(v.shown);
      const label = n.label(sys, count);
      const fs = small ? 11 : 13;
      ctx.textBaseline = 'alphabetic';
      if (n.maxDots === 0) {
        ctx.font = `600 ${fs}px ${FONT}`;
        const tw = ctx.measureText(label).width;
        if (n.id !== 'users') {
          // A plain tag: paper box with an ink edge.
          ctx.fillStyle = PAPER;
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.roundRect(v.cx - tw / 2 - 12, v.top - 2, tw + 24, 30, 3);
          ctx.fill();
          ctx.stroke();
        }
        ctx.fillStyle = n.id === 'users' ? MUTE : INK;
        ctx.textAlign = 'center';
        ctx.fillText(label, v.cx, v.top + 17);
        continue;
      }
      const b = blocks.get(n.id)!;
      // "5,200 app servers": the number carries the weight.
      const num = sig(count);
      ctx.font = `700 ${fs + 5}px ${FONT}`;
      const nw = ctx.measureText(num).width;
      ctx.font = `500 ${fs}px ${FONT}`;
      const lw = ctx.measureText(label).width;
      const total = nw + 7 + lw;
      // Paper behind the text so lines never run through it.
      ctx.fillStyle = PAPER;
      ctx.fillRect(v.cx - total / 2 - 6, v.top - 4, total + 12, 22);
      ctx.textAlign = 'left';
      ctx.fillStyle = INK;
      ctx.font = `700 ${fs + 5}px ${FONT}`;
      ctx.fillText(num, v.cx - total / 2, v.top + 13);
      ctx.font = `500 ${fs}px ${FONT}`;
      ctx.fillStyle = MUTE;
      ctx.fillText(label, v.cx - total / 2 + nw + 7, v.top + 13);

      const hot = this.strain && ((n.id === 'app' && this.strain.bottleneck === 'app servers') || (n.id === 'db' && this.strain.bottleneck === 'database'));
      const heat = hot ? Math.min(1, Math.max(0, (load - 0.6) / 0.4)) : 0;
      const s = b.cell * 0.66;
      const gx = v.cx - (b.cols * b.cell - (b.cell - s)) / 2;
      const gy = v.top + 22;
      const full = Math.floor(b.dots);
      const group = 1 + sys.replicasPerShard;
      for (let i = 0; i < Math.ceil(b.dots); i++) {
        const x = gx + (i % b.cols) * b.cell;
        const y = gy + Math.floor(i / b.cols) * b.cell;
        const a = i < full ? 1 : b.dots - full;
        ctx.globalAlpha = v.alpha * a;
        const jitter = heat > 0.95 && !this.reduced ? (Math.random() - 0.5) * 1.6 : 0;
        const replica = n.id === 'db' && sys.replicasPerShard > 0 && i % group !== 0;
        if (replica) {
          ctx.strokeStyle = heat > 0.5 ? ACCENT : INK;
          ctx.lineWidth = 1.1;
          ctx.strokeRect(x + 0.55 + jitter, y + 0.55, s - 1.1, s - 1.1);
        } else {
          ctx.fillStyle = heat > 0 && i / Math.max(1, b.dots) < heat ? ACCENT : INK;
          ctx.fillRect(x + jitter, y, s, s);
        }
      }
      ctx.globalAlpha = v.alpha;
      if (b.unit > 1) {
        ctx.font = `500 ${small ? 9.5 : 11}px ${FONT}`;
        ctx.fillStyle = MUTE;
        ctx.textAlign = 'center';
        ctx.fillText(`each square is ${sig(b.unit)} machines`, v.cx, gy + b.rows * b.cell + 11);
      }
    }
    ctx.globalAlpha = 1;
    void sq;
  }

  /** The curve from the foot of one node to the head of another. */
  private curve(a: NodeView, b: NodeView): [number, number][] {
    const y0 = a.bottom + 4;
    const y1 = b.top - 8;
    const mid = (y0 + y1) / 2;
    return [[a.cx, y0], [a.cx, mid], [b.cx, mid], [b.cx, y1]];
  }

  private point(a: NodeView, b: NodeView, t: number): [number, number] {
    const [p0, p1, p2, p3] = this.curve(a, b);
    const u = 1 - t;
    const k0 = u * u * u;
    const k1 = 3 * u * u * t;
    const k2 = 3 * u * t * t;
    const k3 = t * t * t;
    return [k0 * p0[0] + k1 * p1[0] + k2 * p2[0] + k3 * p3[0], k0 * p0[1] + k1 * p1[1] + k2 * p2[1] + k3 * p3[1]];
  }

  private stepParticles(dt: number, rs: { path: NodeId[]; w: number }[]): void {
    if (this.reduced) {
      this.particles.length = 0;
      return;
    }
    const wanted = Math.round((this.w < 520 ? 0.5 : 1) * (10 + this.position * 46));
    const load = this.strain?.utilisation ?? 0;
    const slow = this.strain ? Math.max(0.1, 1 - Math.min(load, 0.93)) : 1;
    // Spawn steadily rather than all at once, so the stream thickens as you drag.
    this.spawnDebt += Math.max(0, wanted - this.particles.length) * dt * 2.2;
    const totalW = rs.reduce((s, r) => s + r.w, 0);
    while (this.spawnDebt >= 1) {
      this.spawnDebt -= 1;
      let pick = Math.random() * totalW;
      let route = rs[0];
      for (const r of rs) {
        pick -= r.w;
        if (pick <= 0) {
          route = r;
          break;
        }
      }
      this.particles.push({
        path: route.path, seg: 0, t: Math.random() * 0.2, speed: 0.75 + Math.random() * 0.5,
        off: Math.random() - 0.5, falling: false, x: 0, y: 0, vy: 0, life: 1,
      });
    }
    const spread = Math.min(this.w * 0.36, 300);
    const keep: Particle[] = [];
    for (const p of this.particles) {
      if (p.falling) {
        p.vy += 900 * dt;
        p.y += p.vy * dt;
        p.x += p.off * 60 * dt;
        p.life -= dt * 1.3;
        if (p.life > 0) keep.push(p);
        continue;
      }
      const a = this.views.get(p.path[p.seg])!;
      const b = this.views.get(p.path[p.seg + 1])!;
      if (b.alpha < 0.3) continue; // that part of the system no longer exists
      const beforeApp = p.path.indexOf('app') > p.seg;
      const len = Math.hypot(b.cx - a.cx, b.top - a.bottom) + 40;
      p.t += (dt * 230 * p.speed * (beforeApp ? slow : 1)) / len;
      if (p.t >= 1) {
        p.seg++;
        p.t = 0;
        const arrived = p.path[p.seg];
        if (arrived === 'app' && this.strain && Math.random() < this.strain.dropped) {
          // More traffic than the system can serve: this request is lost.
          p.falling = true;
          p.vy = -120 - Math.random() * 120;
          p.x = b.cx + p.off * spread * 0.5;
          p.y = b.top - 6;
          keep.push(p);
          continue;
        }
        if (p.seg >= p.path.length - 1) continue;
      }
      const from = this.views.get(p.path[p.seg])!;
      const to = this.views.get(p.path[p.seg + 1])!;
      const pt = this.point(from, to, p.t);
      // People are spread along the top; streams narrow as they join the system.
      const fan = p.seg === 0 ? (1 - p.t) * (1 - p.t) * spread * 2 : 0;
      pt[0] += p.off * (fan + 7);
      p.x = pt[0];
      p.y = pt[1];
      keep.push(p);
    }
    this.particles = keep.length > wanted * 1.6 ? keep.slice(keep.length - Math.ceil(wanted * 1.6)) : keep;
  }
}
