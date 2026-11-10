import { describe, expect, it } from 'vitest';
import { DEFAULTS, design, duration, LANDMARKS, money, PRICES, sig, STAGES, stageIndex, strain, usersAt, words } from '../src/model.ts';

describe('the design at each size', () => {
  it('starts as one small machine that costs about twelve dollars a month', () => {
    const s = design(1);
    expect(s.appServers).toBe(1);
    expect(s.dbNodes).toBe(0);
    expect(s.cost.total).toBeGreaterThan(12);
    expect(s.cost.total).toBeLessThan(13);
  });

  it('adds each part at its stage and never takes one away', () => {
    const flags = ['hasSeparateDb', 'hasLoadBalancer', 'hasCdn', 'hasCache', 'hasQueue', 'hasObjectStorage'] as const;
    let prev = design(1);
    for (let p = 0.1; p <= 9; p += 0.1) {
      const s = design(usersAt(p));
      for (const f of flags) if (prev[f]) expect(s[f]).toBe(true);
      expect(s.regions).toBeGreaterThanOrEqual(prev.regions);
      expect(s.appServers).toBeGreaterThanOrEqual(prev.appServers);
      expect(s.cost.total).toBeGreaterThanOrEqual(prev.cost.total);
      prev = s;
    }
    expect(design(1e9).regions).toBe(3);
    expect(stageIndex(999)).toBe(0);
    expect(stageIndex(1000)).toBe(1);
    expect(stageIndex(1e9)).toBe(STAGES.length - 1);
  });

  it('computes peak traffic from the stated assumptions', () => {
    const s = design(1_000_000);
    expect(s.requestsPerDay).toBe(50_000_000);
    expect(s.peakRps).toBeCloseTo((50_000_000 / 86_400) * 3, 6);
  });

  it('always has enough app servers to stay under the target load', () => {
    for (const u of [1e4, 1e5, 1e6, 1e7, 1e8, 1e9]) {
      const s = design(u);
      const load = s.peakRps / (s.appServers * DEFAULTS.appServerRps);
      expect(load).toBeLessThanOrEqual(DEFAULTS.targetUtilisation + 1e-9);
      // The system it just designed is healthy.
      expect(strain(s, u).utilisation).toBeLessThan(1);
    }
  });

  it('keeps redundancy: two app servers behind a load balancer, replicas on every shard', () => {
    const s = design(10_000);
    expect(s.appServers).toBeGreaterThanOrEqual(2);
    const big = design(1e8);
    expect(big.shards).toBeGreaterThan(1);
    expect(big.replicasPerShard).toBeGreaterThanOrEqual(2);
    expect(big.dbNodes).toBe(big.shards * (1 + big.replicasPerShard));
  });

  it('adds up the bill from the parts', () => {
    const s = design(5_000_000);
    const c = s.cost;
    expect(c.compute + c.database + c.cache + c.storage + c.transfer).toBeCloseTo(c.total, 6);
    expect(c.transfer).toBeCloseTo(s.transferTbMonth * 1000 * PRICES.transferGb, 6);
  });

  it('gets cheaper per user as it grows', () => {
    expect(design(1e9).costPerUser).toBeLessThan(design(1e4).costPerUser);
    expect(design(1e4).costPerUser).toBeLessThan(design(10).costPerUser);
  });

  it('follows changed assumptions', () => {
    const heavy = design(1e6, { ...DEFAULTS, requestsPerUser: 500 });
    expect(heavy.appServers).toBeGreaterThan(design(1e6).appServers * 5);
  });
});

describe('a frozen system under growing traffic', () => {
  const frozen = design(100_000);

  it('follows the M/M/1 queue: response time is service time over one minus load', () => {
    const st = strain(frozen, 100_000);
    expect(st.meanMs).toBeCloseTo(DEFAULTS.serviceMs / (1 - st.utilisation), 9);
    expect(st.p99Ms).toBeCloseTo(st.meanMs * Math.log(100), 9);
    expect(st.dropped).toBe(0);
  });

  it('slows down faster than the load rises', () => {
    let last = 0;
    let lastJump = 0;
    for (const u of [100_000, 150_000, 200_000, 250_000]) {
      const st = strain(frozen, u);
      if (!Number.isFinite(st.meanMs)) break;
      const jump = st.meanMs - last;
      if (last) expect(jump).toBeGreaterThan(lastJump);
      lastJump = last ? jump : 0;
      last = st.meanMs;
    }
  });

  it('fails requests once more arrives than it can serve', () => {
    const st = strain(frozen, 10_000_000);
    expect(st.utilisation).toBeGreaterThan(1);
    expect(st.meanMs).toBe(Infinity);
    expect(st.dropped).toBeCloseTo(1 - 1 / st.utilisation, 9);
  });
});

describe('landmarks and wording', () => {
  it('has a source for every real company and keeps them in order', () => {
    for (const l of LANDMARKS) expect(l.source.url).toMatch(/^https:\/\//);
    const users = LANDMARKS.map((l) => l.users);
    expect([...users].sort((a, b) => a - b)).toEqual(users);
  });

  it('snaps the slider to readable numbers and covers nine zeros', () => {
    expect(usersAt(0)).toBe(1);
    expect(usersAt(9)).toBe(1_000_000_000);
    expect(usersAt(6)).toBe(1_000_000);
    expect(usersAt(6.3)).toBe(2_000_000);
    expect(usersAt(-1)).toBe(1);
  });

  it('writes numbers the way people say them', () => {
    expect(sig(1234567)).toBe('1,230,000');
    expect(sig(1_000_000_000, 2)).toBe('1,000,000,000');
    expect(words(1_740_000)).toBe('1.74 million');
    expect(money(12.26)).toBe('$12');
    expect(money(4_480_000)).toBe('$4.48 million');
    expect(money(0.0045)).toBe('0.45¢');
    expect(duration(57)).toBe('57 ms');
    expect(duration(4200)).toBe('4.2 s');
    expect(duration(Infinity)).toBe('never');
  });
});
