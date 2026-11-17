// Token Radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks EVERY pre-token protocol the snapshot carries (the watchlist is the floor, never
// the ceiling), strongest implied value first. A protocol is pre-token when its record carries no
// token (no market cap, no CoinGecko id, no symbol); protocols whose token already trades are kept
// apart and shown with their market caps, never mixed into the ranking.
//
// Implied value follows only from the snapshot's own figures. The multiple is not a constant and
// not a hand-kept list of names: it is the live market's own median market-cap-to-TVL ratio for the
// protocol's category, computed from the snapshot's live-token rows at run time (at least three live
// rows in the category, else the whole market's median), clamped to [0.05, 1.50]:
//
//   categoryMultiple = median(mcap_usd / tvl_usd) over live rows of the category, or the global median
//   base             = tvl_usd x categoryMultiple
//   growth           = clamp(change_7d, -50, 100) per cent; growthMult = 1 + (growth / 100) x 0.6
//   maturity         = 0.70 + min(age_days, 1460) / 1460 x 0.30   (age_days unknown: 365)
//   chains           = 1 + 0.04 x min(chains.length - 1, 5)
//   implied          = max(1, round(base x growthMult x maturity x chains))
//
// A protocol that has run longer with no token, grown faster this week, or spread across more chains
// scores higher; a category the live market already values richly scores higher. No protocol name
// is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_extra: number;
  multiple_min: number;
  multiple_max: number;
  min_live_per_category: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1460,
  unknown_age_days: 365,
  chain_step: 0.04,
  chain_max_extra: 5,
  multiple_min: 0.05,
  multiple_max: 1.5,
  min_live_per_category: 3,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_live_rows: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chains_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  category_live_rows: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chains_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's market multiple, for the dashboard's model table. */
export interface CategoryMultiple {
  category: string;
  live_rows: number;
  multiple: number;
  fallback: boolean;
}

/** Everything the dashboard needs: the board, the live set, the multiples and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_multiple: number;
  multiples: CategoryMultiple[];
  watchlistSlugs: string[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * The house's own exclusion rule for a launch candidate, from the snapshot's record: a wrapped,
 * staked or bridged product of a token that already trades is not a protocol still waiting on a
 * launch of its own. WBTC is Bitcoin on Ethereum, a bridge is a wrapped asset that already trades,
 * and a liquid-staking receipt is a staked asset that already trades, so none of them ranks here,
 * whatever its TVL. The categories, the wrapped/staked/staking words and the exchange names are
 * the rule the watchlist itself was built with; the snapshot carries no parent-protocol field, so
 * that leg of the rule is the watchlist's own list, which the board always covers whole.
 */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol is one the board may rank: pre-token and not a wrapped, staked or bridged product of a token that already trades. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return false;
  if (VERSIONED.test(p.name)) return false;
  return true;
}

/**
 * The market's multiples, computed from the snapshot's own live-token rows: for each category with
 * at least `min_live_per_category` live rows that carry both a market cap and a TVL, the median of
 * mcap_usd / tvl_usd; every other category falls back to the whole market's median. Both are clamped
 * to [multiple_min, multiple_max]. Nothing here names a protocol.
 */
export function marketMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { global: number; byCategory: Map<string, { multiple: number; live_rows: number; fallback: boolean }> } {
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) continue;
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    if (p.category !== null) {
      const list = byCat.get(p.category) ?? [];
      list.push(ratio);
      byCat.set(p.category, list);
    }
  }
  const clamp = (n: number): number => Math.min(model.multiple_max, Math.max(model.multiple_min, n));
  const global = all.length > 0 ? clamp(median(all)) : 0.25;
  const byCategory = new Map<string, { multiple: number; live_rows: number; fallback: boolean }>();
  for (const [category, ratios] of byCat) {
    if (ratios.length >= model.min_live_per_category) {
      byCategory.set(category, { multiple: clamp(median(ratios)), live_rows: ratios.length, fallback: false });
    }
  }
  return { global, byCategory };
}

/** The multiple one protocol's category carries, with how many live rows set it. */
export function multipleFor(
  category: string | null,
  multiples: { global: number; byCategory: Map<string, { multiple: number; live_rows: number; fallback: boolean }> },
): { multiple: number; live_rows: number; fallback: boolean } {
  if (category !== null) {
    const hit = multiples.byCategory.get(category);
    if (hit !== undefined) return hit;
  }
  return { multiple: multiples.global, live_rows: 0, fallback: true };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: { global: number; byCategory: Map<string, { multiple: number; live_rows: number; fallback: boolean }> },
  model: ModelConstants = MODEL,
): {
  implied: number;
  categoryMultiple: number;
  categoryLiveRows: number;
  categoryFallback: boolean;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainsMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, live_rows, fallback } = multipleFor(protocol.category, multiples);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.max(0, Math.min(protocol.chains.length - 1, model.chain_max_extra));
  const chainsMult = 1 + model.chain_step * extraChains;
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainsMult));
  return { implied, categoryMultiple: multiple, categoryLiveRows: live_rows, categoryFallback: fallback, growthPct, growthMult, maturityMult, chainsMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = marketMultiples(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol in the snapshot, not just the biggest
  // by TVL. The floor is never the whole board: the radar exists to find these early.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiples, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      // Full precision, not rounded: the dashboard recomputes this row from these very numbers
      // and says whether it matches board.json, so a rounded multiple would read as stale data.
      category_multiple: s.categoryMultiple,
      category_live_rows: s.categoryLiveRows,
      growth_pct: round4(s.growthPct),
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      chains_multiplier: s.chainsMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('borrow')) {
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $20 of USDC against it and repay it the same week.`;
  }
  if (c.includes('yield aggregator') || c.includes('curator') || c.includes('allocator') || c.includes('onchain capital')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares in the same wallet.`;
  }
  if (c.includes('dex') || c.includes('amm') || c.includes('swap')) {
    return `Provide $${capital} of liquidity to ${name}'s largest USDC pool on ${chain} and keep the LP tokens.`;
  }
  if (c.includes('yield') || c.includes('leveraged farm')) {
    return `Deposit $${capital} into ${name}'s highest-TVL yield strategy on ${chain} and leave it compounding.`;
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds once in its app.`;
  }
  if (c.includes('liquid staking') || c.includes('restak') || c.includes('staking')) {
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} on ${name} on ${chain} and place one position in a market that settles after a week.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the same wallet.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it for the full period.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for a month.`;
  }
  if (c.includes('index')) {
    return `Buy $${capital} of ${name}'s index token on ${chain} and hold it in the farming wallet.`;
  }
  if (c.includes('launchpad')) {
    return `Commit $${capital} to the next launch on ${name} on ${chain} and complete its participation steps.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second, different action in the same protocol, so the wallet shows more than one activity. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (p.chains.length > 1) {
    const other = p.chains[1]!;
    return `Repeat the same position on ${other} with $${Math.max(25, Math.ceil(capital / 2))} so the wallet's footprint spans two chains.`;
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('borrow')) {
    return `Make one swap inside ${name} on ${chain} so the wallet shows a supply and a swap, not a supply alone.`;
  }
  if (c.includes('dex') || c.includes('amm') || c.includes('swap')) {
    return `Make one single-sided deposit into a second ${name} pool on ${chain} so the wallet holds two positions.`;
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return `Bridge $${Math.max(25, Math.ceil(capital / 2))} back the other way through ${name} so the wallet shows a round trip.`;
  }
  if (c.includes('liquid staking') || c.includes('restak') || c.includes('staking')) {
    return `Delegate a second, smaller stake of $${Math.max(25, Math.ceil(capital / 2))} through ${name} on ${chain} a week later.`;
  }
  return `Use a second feature of ${name} on ${chain} once, such as a swap, a vote or a claim, so the wallet shows two kinds of activity.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. Every step names what to do, what it costs and how long it takes.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, capital, chain),
      cost: `about $${Math.max(25, Math.ceil(capital / 2))} of capital and $2 of gas`,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and never let a week pass with no activity.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; never pay a fee to claim.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    category_live_rows: row.model.category_live_rows,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chains_multiplier: row.model.chains_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const multiples = marketMultiples(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const categories = [...new Set(board.map((r) => r.category ?? 'Other'))].sort();
  const multiplesTable: CategoryMultiple[] = categories.map((category) => {
    const hit = multiples.byCategory.get(category);
    if (hit !== undefined) return { category, live_rows: hit.live_rows, multiple: round4(hit.multiple), fallback: false };
    return { category, live_rows: 0, multiple: round4(multiples.global), fallback: true };
  });
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_multiple: round4(multiples.global),
    multiples: multiplesTable,
    watchlistSlugs: [...snapshot.watchlist],
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
