/**
 * The model behind Nine Zeros: given a number of daily users, what does the system need, what
 * does it cost, and what gives way next. Pure functions, no DOM.
 *
 * It is a model, not a quote. The capacities are textbook rules of thumb and every one of them
 * is an assumption the reader can change. The prices are AWS on-demand list prices for
 * us-east-1, checked on 11 November 2026 (https://aws.amazon.com/ec2/pricing/on-demand/,
 * /rds/postgresql/pricing/, /elasticache/pricing/, /s3/pricing/, /cloudfront/pricing/).
 */

export interface Assumptions {
  /** Requests each daily user makes per day. */
  requestsPerUser: number;
  /** Peak traffic as a multiple of the daily average. */
  peakFactor: number;
  /** Share of requests that only read. */
  readShare: number;
  /** Database queries per request. */
  queriesPerRequest: number;
  /** Share of reads the cache answers, once there is a cache. */
  cacheHitRate: number;
  /** Requests per second one application server can serve flat out. */
  appServerRps: number;
  /** How full a server is allowed to run before another is added. */
  targetUtilisation: number;
  /** Read queries per second one database machine answers. */
  dbReadQps: number;
  /** Writes per second one database primary accepts. */
  dbWriteQps: number;
  /** Terabytes one database machine holds comfortably. */
  dbNodeTb: number;
  /** Megabytes of database rows per user. */
  dbMbPerUser: number;
  /** Megabytes of files (photos, uploads) per user. */
  filesMbPerUser: number;
  /** Kilobytes sent back per request. */
  responseKb: number;
  /** Share of requests that leave a background job. */
  jobShare: number;
  /** Jobs per second one worker finishes. */
  workerJobsPerSecond: number;
  /** Time the server spends on one request when idle, milliseconds. */
  serviceMs: number;
}

export const DEFAULTS: Assumptions = {
  requestsPerUser: 50,
  peakFactor: 3,
  readShare: 0.9,
  queriesPerRequest: 3,
  cacheHitRate: 0.8,
  appServerRps: 700,
  targetUtilisation: 0.6,
  dbReadQps: 4000,
  dbWriteQps: 1500,
  dbNodeTb: 4,
  dbMbPerUser: 2,
  filesMbPerUser: 20,
  responseKb: 20,
  jobShare: 0.1,
  workerJobsPerSecond: 50,
  serviceMs: 20,
};

/** AWS on-demand list prices, us-east-1, US dollars. Hourly unless stated. */
export const PRICES = {
  smallBox: 0.0168, // t4g.small: the one machine that does everything
  appServer: 0.1632, // m7g.xlarge, 4 vCPU, 16 GB
  dbSmall: 0.168, // RDS db.m7g.large
  dbLarge: 0.956, // RDS db.r7g.2xlarge, 64 GB
  cacheNode: 0.219, // ElastiCache cache.r7g.large
  loadBalancer: 0.0225, // Application Load Balancer, per hour, before usage
  storageGbMonth: 0.023, // S3 Standard, per GB per month
  transferGb: 0.085, // CloudFront, first pricing tier, per GB
  hoursPerMonth: 730,
};

export interface Stage {
  /** This stage begins at this many users. */
  from: number;
  title: string;
  /** What changed, and why. */
  text: string;
  /** What gives way if nothing changes. */
  next: string;
}

export const STAGES: Stage[] = [
  {
    from: 1,
    title: 'One machine',
    text: 'The app and the database share one small server. It costs about as much as lunch, and it is the right answer for longer than most people think.',
    next: 'One machine is one point of failure, and the database and the app start fighting for the same memory.',
  },
  {
    from: 1_000,
    title: 'The database moves out',
    text: 'The data gets a machine of its own, with backups. Nothing is faster yet: the point is that losing the app server no longer means losing the data.',
    next: 'There is still only one app server. Deploying means downtime, and one bad night takes the product offline.',
  },
  {
    from: 10_000,
    title: 'Two of everything in front',
    text: 'A load balancer spreads traffic across several app servers, so one can die or be updated without anyone noticing. A CDN starts serving images and scripts from near the user.',
    next: 'Every page still asks the one database for everything. Reads are about to swamp it.',
  },
  {
    from: 100_000,
    title: 'Stop asking the database',
    text: 'A cache answers most reads from memory, and read replicas take the rest. Nine requests in ten never touch the primary database again.',
    next: 'Slow work (emails, image resizing, reports) is still done while the user waits.',
  },
  {
    from: 1_000_000,
    title: 'Do it later',
    text: 'Slow work goes on a queue and workers do it in the background. Files move to object storage. Servers are added and removed automatically as traffic rises and falls.',
    next: 'Writes all land on one primary database, and one machine can only write so fast.',
  },
  {
    from: 10_000_000,
    title: 'Split the data',
    text: 'The database is cut into shards, each holding a slice of the users. A second region comes online so that losing a whole data centre is survivable.',
    next: 'One team can no longer hold the whole system in its head, and users far away feel the distance.',
  },
  {
    from: 100_000_000,
    title: 'Everywhere at once',
    text: 'Several regions serve users from nearby, hundreds of shards hold the data, and the product is many services owned by many teams. Most of the work now is keeping it all consistent.',
    next: 'At this size off-the-shelf parts run out: the companies that got here built their own.',
  },
];

export function stageIndex(users: number): number {
  let i = 0;
  for (let k = 0; k < STAGES.length; k++) if (users >= STAGES[k].from) i = k;
  return i;
}

export interface System {
  users: number;
  stage: number;
  peakRps: number;
  requestsPerDay: number;
  // what exists
  hasSeparateDb: boolean;
  hasLoadBalancer: boolean;
  hasCdn: boolean;
  hasCache: boolean;
  hasQueue: boolean;
  hasObjectStorage: boolean;
  regions: number;
  // how many
  appServers: number;
  loadBalancers: number;
  cacheNodes: number;
  workers: number;
  shards: number;
  replicasPerShard: number;
  dbNodes: number;
  servers: number;
  storageTb: number;
  transferTbMonth: number;
  // money
  cost: { compute: number; database: number; cache: number; storage: number; transfer: number; total: number };
  costPerUser: number;
}

/** The system a careful team would be running at this many daily users. */
export function design(users: number, a: Assumptions = DEFAULTS): System {
  const stage = stageIndex(users);
  const requestsPerDay = users * a.requestsPerUser;
  const peakRps = (requestsPerDay / 86_400) * a.peakFactor;

  const hasSeparateDb = stage >= 1;
  const hasLoadBalancer = stage >= 2;
  const hasCdn = stage >= 2;
  const hasCache = stage >= 3;
  const hasQueue = stage >= 4;
  const hasObjectStorage = stage >= 4;
  const regions = stage >= 6 ? 3 : stage >= 5 ? 2 : 1;
  // With several regions, keep half as much again in hand, so the rest can carry one that is lost
  // (with two regions that means shedding background work while it is down).
  const spare = regions > 1 ? 1.5 : 1;

  const perServer = a.appServerRps * a.targetUtilisation;
  let appServers = Math.ceil((peakRps / perServer) * spare);
  appServers = Math.max(appServers, hasLoadBalancer ? 2 * regions : 1);

  const queries = peakRps * a.queriesPerRequest;
  const writes = queries * (1 - a.readShare);
  const reads = queries * a.readShare * (hasCache ? 1 - a.cacheHitRate : 1);
  const dbTb = (users * a.dbMbPerUser) / 1e6;
  const shards = stage >= 5 ? Math.max(1, Math.ceil(writes / a.dbWriteQps), Math.ceil(dbTb / a.dbNodeTb)) : 1;
  let replicasPerShard = 0;
  if (stage >= 3) {
    const readsPerShard = reads / shards;
    replicasPerShard = Math.max(stage >= 5 ? 2 : 1, Math.ceil(readsPerShard / a.dbReadQps));
  }
  const dbNodes = hasSeparateDb ? shards * (1 + replicasPerShard) : 0;

  const cacheNodes = hasCache ? Math.max(2, Math.ceil((queries * a.readShare * a.cacheHitRate) / 50_000)) : 0;
  const workers = hasQueue ? Math.max(2, Math.ceil((peakRps * a.jobShare) / a.workerJobsPerSecond)) : 0;
  const loadBalancers = hasLoadBalancer ? regions * Math.max(1, Math.ceil(peakRps / regions / 100_000)) : 0;

  const storageTb = dbTb + (users * a.filesMbPerUser) / 1e6;
  const transferTbMonth = (requestsPerDay * 30 * a.responseKb) / 1e9;

  const h = PRICES.hoursPerMonth;
  const compute =
    (hasSeparateDb ? (appServers + workers) * PRICES.appServer : PRICES.smallBox) * h +
    loadBalancers * PRICES.loadBalancer * h;
  const database = dbNodes * (stage >= 3 ? PRICES.dbLarge : PRICES.dbSmall) * h;
  const cache = cacheNodes * PRICES.cacheNode * h;
  const storage = storageTb * 1000 * PRICES.storageGbMonth;
  const transfer = transferTbMonth * 1000 * PRICES.transferGb;
  const total = compute + database + cache + storage + transfer;

  return {
    users, stage, peakRps, requestsPerDay,
    hasSeparateDb, hasLoadBalancer, hasCdn, hasCache, hasQueue, hasObjectStorage, regions,
    appServers, loadBalancers, cacheNodes, workers, shards, replicasPerShard, dbNodes,
    servers: appServers + workers + dbNodes + cacheNodes,
    storageTb, transferTbMonth,
    cost: { compute, database, cache, storage, transfer, total },
    costPerUser: total / users,
  };
}

export interface Strain {
  /** Offered load divided by what the frozen system can serve. */
  utilisation: number;
  /** Typical response time in milliseconds; Infinity once the system cannot keep up. */
  meanMs: number;
  p99Ms: number;
  /** Share of requests that can never be served. */
  dropped: number;
  /** Which part gives way first. */
  bottleneck: 'app servers' | 'database';
}

/**
 * What happens when traffic grows and the system does not: an M/M/1 queue per server.
 * Mean response time is S / (1 - rho) and the 99th percentile is ln(100) times the mean,
 * both exact for that queue (Kleinrock, Queueing Systems, vol. 1).
 */
export function strain(frozen: System, users: number, a: Assumptions = DEFAULTS): Strain {
  const peakRps = ((users * a.requestsPerUser) / 86_400) * a.peakFactor;
  const appCapacity = frozen.appServers * a.appServerRps;
  const queries = peakRps * a.queriesPerRequest;
  const reads = queries * a.readShare * (frozen.hasCache ? 1 - a.cacheHitRate : 1);
  const writes = queries * (1 - a.readShare);
  const dbMachines = Math.max(1, frozen.dbNodes);
  const dbLoad = Math.max(
    writes / (frozen.shards * a.dbWriteQps),
    (reads + writes) / (dbMachines * a.dbReadQps),
  );
  const appLoad = peakRps / appCapacity;
  const utilisation = Math.max(appLoad, dbLoad);
  const over = utilisation >= 1;
  const meanMs = over ? Infinity : a.serviceMs / (1 - utilisation);
  return {
    utilisation,
    meanMs,
    p99Ms: over ? Infinity : meanMs * Math.log(100),
    dropped: over ? 1 - 1 / utilisation : 0,
    bottleneck: dbLoad > appLoad ? 'database' : 'app servers',
  };
}

/** Real systems, from what their own engineers published. Placed on the axis by `users`. */
export interface Landmark {
  name: string;
  when: string;
  users: number;
  headline: string;
  detail: string;
  source: { label: string; url: string };
}

export const LANDMARKS: Landmark[] = [
  {
    name: 'Stack Overflow',
    when: '2016',
    users: 4_200_000,
    headline: '9 web servers',
    detail:
      '209 million requests a day, served by 9 web servers and 4 SQL servers the team owned and tuned by hand. Placed here by request volume. The rule-of-thumb design beside it uses more machines for the same traffic: care counts for more than machine count.',
    source: { label: 'Nick Craver, Stack Overflow: The Architecture, 2016 Edition', url: 'https://nickcraver.com/blog/2016/02/17/stack-overflow-the-architecture-2016-edition/' },
  },
  {
    name: 'Instagram',
    when: 'December 2011',
    users: 14_000_000,
    headline: '3 engineers',
    detail:
      'More than 14 million users, run by three engineers on over 100 rented servers: 25 app servers, 12 database machines each with a replica, and a cache in front.',
    source: { label: 'Instagram Engineering, What Powers Instagram', url: 'https://medium.com/instagram-engineering/what-powers-instagram-hundreds-of-instances-dozens-of-technologies-adf2e22da2ad' },
  },
  {
    name: 'WhatsApp',
    when: 'September 2015',
    users: 900_000_000,
    headline: '50 engineers',
    detail: '900 million users with 50 engineers. They wrote for one platform, tuned every server, and refused features that did not earn their weight.',
    source: { label: 'Wired, Why WhatsApp Only Needs 50 Engineers for Its 900M Users', url: 'https://www.wired.com/2015/09/whatsapp-serves-900-million-users-50-engineers/' },
  },
];

// ---- plain-language numbers ----------------------------------------------------------------

const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function sig(x: number, digits = 3): string {
  if (!Number.isFinite(x)) return '∞';
  if (x === 0) return '0';
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(x))) - (digits - 1));
  const r = Math.round(x / mag) * mag;
  if (Math.abs(r) >= 1000) return grouped.format(r);
  return String(Number(r.toPrecision(digits)));
}

export function words(x: number, digits = 3): string {
  if (x >= 0.9995e9) return `${sig(x / 1e9, digits)} billion`;
  if (x >= 0.9995e6) return `${sig(x / 1e6, digits)} million`;
  return sig(x, digits);
}

export function money(x: number): string {
  if (x >= 0.9995e6) return `$${sig(x / 1e6)} million`;
  if (x >= 100) return `$${sig(x)}`;
  if (x >= 1) return `$${x.toFixed(x >= 10 ? 0 : 2)}`;
  if (x >= 0.01) return `${sig(x * 100, 2)}¢`;
  return `${sig(x * 100, 2)}¢`;
}

export function duration(ms: number): string {
  if (!Number.isFinite(ms)) return 'never';
  if (ms < 1000) return `${sig(ms)} ms`;
  return `${sig(ms / 1000)} s`;
}

/** Snap a continuous slider position (0..9, log10 of users) to a readable whole number of users. */
export function usersAt(position: number): number {
  const raw = Math.pow(10, Math.min(9, Math.max(0, position)));
  if (raw < 10) return Math.round(raw);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)) - 1);
  return Math.round(raw / mag) * mag;
}
