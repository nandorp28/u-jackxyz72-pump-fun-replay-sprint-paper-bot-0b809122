// Graduation runner for the pump.fun bonding-curve replay (agent-fun/replay/v2).
//
// What the dev-window data says (24h, 1,222 universe coins, analysed from the kit dataset):
//   - Only 3.1% of coins ever complete (graduate at ~85 SOL real). Of the 106 coins that
//     reach 30 SOL real, 33% complete and the median best price within 600 slots after
//     that point is +47% — but an offline barrier study overstates the edge: stops do not
//     fill at the barrier, they fill two slots after the dump, and the dump is a cliff —
//     the price sits flat and then falls 60-80% in a single slot. No pre-entry feature
//     predicts the cliff (holder concentration, buyer counts and creator buys are the
//     same for coins that crater and coins that run), and a quiet tape only sometimes
//     precedes it. So the edge has to come from size, not from picking: the first buy is
//     tiny and the position only grows on +10% price steps, so a coin that never moves
//     stays a 0.02 SOL scratch and a cliff costs almost nothing, while a runner earns
//     its full stake on the way up.
//   - Age is the one filter that does cut the crater rate: coins entering the 20-60 SOL
//     band crater 50% of the time at age 25-50 slots but only 23% at age 200-500 and
//     14% at age 500-1000, while the runner rate only falls from 23% to 14%. Hot coins
//     (50-200% momentum over 100 slots) crater at 52% and only run at 22%; flat
//     survivors are the trade. So this bot enters old, flat coins in the band —
//     survivors of the dump window — and lets the replay close the position when the
//     curve completes, which is exactly the run it is riding.
//   - The micro-spike game is a loser: entries in the first 150 slots hit +15% before
//     -8% only a third of the time, and every (TP, SL) barrier pair is breakeven at best
//     after the ~3% round-trip cost. The two pilot archetypes bracket the wrong timing
//     for the same reason: the sniper exits after 10 slots (before the median 155-slot
//     peak) and the momentum pilot enters at age 500 (after the peak) and loses 95% on
//     the dev window. This bot does neither: it waits for a coin to prove it can survive,
//     then rides it with a trailing stop.
//
// Entry: a coin becomes a candidate when its real SOL reserve first enters the entry band
// (minRealSol..maxRealSol) while its price is still rising over a momentum window, net SOL
// is still flowing in, several distinct wallets bought recently, and its creator has not
// sold. One entry per coin. The first buy is small (firstBuySol): a coin that has just
// reached the band can still be a bundled launch about to dump, and the dump is a cliff —
// the price sits flat and then falls 60-80% in a single slot, which no stop loss can catch
// (the exit fills after the crater). So the position only grows by pyramiding: each add needs the price to
// have stepped up from the last buy, so a flat coin stays at the small first buy and a
// cliff costs little, while a runner earns its full stake on the way up. The replay closes
// the position when the curve completes, which is exactly the run this bot is riding.
// Every buy is far above the 0.01 SOL the guardrail counts, and the fee math favours the
// size: a 0.30 SOL trade pays ~1.4% all-in per side against ~2.3% for a 0.01 SOL trade.
//
// Exits: a stop loss against cost, a trailing stop once the position is up trailArm, a time
// limit, an exit when the creator sells or a big sell lands, and an exit when recent net
// flow turns negative. There is no hard take-profit: a completing coin's position is closed
// by the replay at its final reserves, which is exactly the run this bot is riding.
//
// Guardrail pacing: the run must end with round trips of >= 0.01 SOL on >= 20 coins. The
// entry band yields ~60 coins a day on the dev window, so the pace logic mostly stays
// quiet; when the bot's own coins lag a pace set in block time it opens tiny 0.01 SOL
// probe round trips on liquid coins and sells them as soon as the buy lands. The relaxed
// entry bars are deliberately set equal to the strict bars — loosening the entry to chase
// the pace was measured to lose money (young, low-reserve entries are the crater coins),
// so the pace never buys a worse coin, it only probes.
//
// Deterministic by construction: no clock, no randomness, no I/O; iteration only over
// insertion-ordered maps fed by the batch stream. All sizing uses the harness's own caps.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Slots since the CreateEvent before an entry is allowed: the crater rate falls from
      50% at age 25-50 to 23% at age 200-500 and 14% at age 500-1000, so a coin must
      first survive the bundled-launch dump window. */
  minAge: number;
  /** Real SOL reserve band at entry. */
  minRealSol: number;
  maxRealSol: number;
  /** Momentum window (slots) and the rise the price must show over it. */
  momWindow: number;
  minMomUp: number;
  /** Net SOL over the flow window, at least this. */
  flowWindow: number;
  minFlowSol: number;
  /** Distinct buyers and buy trades in the recent window. */
  recentWindow: number;
  minBuyers: number;
  minBuys: number;
  /** Largest single wallet's share of recent buy SOL, at most this. */
  maxTopShare: number;
  /** SOL for the first buy, each add, and the whole position. */
  firstBuySol: number;
  addSol: number;
  maxStakeSol: number;
  /** An add needs the price at least this far above the last buy's decision price. */
  addStep: number;
  /** Slots to wait after the previous buy before adding. */
  addDelay: number;
  /** An add needs net SOL over the last addWindow slots at least this. */
  addWindow: number;
  addMinFlowSol: number;
  /** Smallest buy worth sending (the guardrail counts round trips of >= 0.01 SOL). */
  minBuySol: number;
  /** Slippage on buys and sells (bps); wide open so fills land on fast coins. */
  buySlipBps: number;
  sellSlipBps: number;
  /** Exits, as fractions of cost / peak value. The trailing stop is value-based and
      arms only once the position itself is up trailArm — on a pyramided position the
      adds lift the cost basis, so it rarely arms and the position rides the noise; a
      price-based trail was tried and lost money by selling runners on their first
      pullback. */
  stopLoss: number;
  trailArm: number;
  trail: number;
  /** Sell everything once value reaches cost * (1 + hardTp); 0 = off. */
  hardTp: number;
  /** Exit after holding this many slots. */
  maxHold: number;
  /** Exit when the creator sells while held. */
  exitOnDevSell: boolean;
  /** Exit on any single recorded sell of at least this many SOL. */
  bigSellSol: number;
  /** Exit when net SOL over the last exitFlowWindow slots falls below minus this. */
  exitFlowWindow: number;
  exitFlowSol: number;
  /** Exit when no trade has hit the coin for this many slots. */
  staleSlots: number;
  /** Exit when no BUY has hit the coin for this many slots: a coin whose buyers have
      stopped coming is about to be dumped — the cliff follows a quiet tape (craters
      average 1 buy in the 10 slots before the dump; runners average 10). The same bar
      gates entries: only coins with a buy inside the window may be bought. */
  quietSlots: number;
  /** Most entries per coin over the run. */
  maxEntries: number;
  /** Most SOL at cost across all positions at once (a drawdown guard). */
  maxExposureSol: number;
  /** Guardrail pacing: coins target over paceSecs of block time. */
  targetCoins: number;
  paceSecs: number;
  /** Relaxed entry when behind pace: kept equal to the strict bars on purpose — see the
      guardrail note at the top of the file. */
  relaxedMinRealSol: number;
  relaxedMinMomUp: number;
  relaxedMinAge: number;
  /** Probe round trips when still behind pace: size and most open at once. */
  probeSol: number;
  maxProbes: number;
}

export const DEFAULT_PARAMS: Params = {
  minAge: 100,
  minRealSol: 20,
  maxRealSol: 60,
  momWindow: 100,
  minMomUp: 0.1,
  flowWindow: 30,
  minFlowSol: 0,
  recentWindow: 100,
  minBuyers: 6,
  minBuys: 8,
  maxTopShare: 0.7,
  firstBuySol: 0.02,
  addSol: 0.06,
  maxStakeSol: 0.3,
  addStep: 0.07,
  addDelay: 2,
  addWindow: 30,
  addMinFlowSol: 0,
  minBuySol: 0.01,
  buySlipBps: 10_000,
  sellSlipBps: 10_000,
  stopLoss: 0.12,
  trailArm: 0.15,
  trail: 0.1,
  hardTp: 0,
  maxHold: 600,
  exitOnDevSell: true,
  bigSellSol: 5,
  exitFlowWindow: 30,
  exitFlowSol: 1,
  staleSlots: 300,
  quietSlots: 12,
  maxEntries: 1,
  maxExposureSol: 2,
  targetCoins: 25,
  paceSecs: 21_600,
  relaxedMinRealSol: 20,
  relaxedMinMomUp: 0.1,
  relaxedMinAge: 100,
  probeSol: 0.01,
  maxProbes: 1,
};

const LAMPORTS = 1e9;
const CURVE_FEE_BPS = 125n;
const BPS = 10_000n;

interface Trade {
  slot: number;
  buy: boolean;
  sol: number;
  user: string;
  price: number;
}

interface Book {
  created: number | null;
  creator: string | null;
  trades: Trade[];
  devSold: boolean;
  entries: number;
  lastTradeSlot: number;
  lastBuySlot: number;
  done: boolean;
}

interface Held {
  opened: number;
  peakValue: number;
  invested: number;
  exiting: boolean;
  filled: boolean;
  txPaid: number;
  best: number;
  /** Decision price of the last buy; adds need the price to step up from it. */
  lastAddPrice: number;
  /** Slot of the last buy; adds wait addDelay after it. */
  lastAddSlot: number;
}

/** What selling `tokens` against (vq, vt) would pay after curve fees (95 + 30 bps). */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const q = (tokens * vq) / (vt + tokens);
  return q - (q * CURVE_FEE_BPS + BPS - 1n) / BPS;
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const books = new Map<Pubkey, Book>();
  const held = new Map<Pubkey, Held>();
  /** Probe round trips in flight, by mint: false while buying, true once selling. */
  const probes = new Map<Pubkey, boolean>();
  /** The bot's own filled orders and the coins they were on (harness closes excluded). */
  let myFills = 0;
  const myCoins = new Set<Pubkey>();
  let firstTime: number | null = null;
  let lastTime: number | null = null;

  const bookOf = (mint: Pubkey): Book => {
    let b = books.get(mint);
    if (b === undefined) {
      b = { created: null, creator: null, trades: [], devSold: false, entries: 0, lastTradeSlot: -1e12, lastBuySlot: -1e12, done: false };
      books.set(mint, b);
    }
    return b;
  };

  /** Net recorded SOL (buys minus sells) over the last `w` slots. */
  const flow = (b: Book, now: number, w: number): number => {
    let net = 0;
    for (let i = b.trades.length - 1; i >= 0; i--) {
      const tr = b.trades[i]!;
      if (tr.slot <= now - w) break;
      net += tr.buy ? tr.sol : -tr.sol;
    }
    return net;
  };

  /** Price at the start of the momentum window (the earliest trade still in it). */
  const windowStartPrice = (b: Book, now: number, w: number): number => {
    let start = -1;
    for (const tr of b.trades) {
      if (tr.slot <= now - w) continue;
      if (start < 0) start = tr.price;
    }
    return start;
  };

  /** Entry signal on a coin's book at slot `now`. Relaxed mode uses the same bars. */
  const entrySignal = (b: Book, now: number, rqSol: number, relaxed: boolean): boolean => {
    const minRq = relaxed ? p.relaxedMinRealSol : p.minRealSol;
    const minUp = relaxed ? p.relaxedMinMomUp : p.minMomUp;
    const minAge = relaxed ? p.relaxedMinAge : p.minAge;
    if (b.created === null || now - b.created < minAge) return false;
    if (now - b.lastBuySlot > p.quietSlots) return false;
    if (rqSol < minRq || rqSol > p.maxRealSol) return false;
    if (b.devSold) return false;
    if (b.entries >= p.maxEntries) return false;
    const startPrice = windowStartPrice(b, now, p.momWindow);
    if (startPrice <= 0) return false;
    let lastPrice = 0;
    let buys = 0;
    let buySol = 0;
    const byUser = new Map<string, number>();
    for (const tr of b.trades) {
      if (tr.slot <= now - p.recentWindow) continue;
      lastPrice = tr.price;
      if (tr.buy) {
        buys++;
        buySol += tr.sol;
        byUser.set(tr.user, (byUser.get(tr.user) ?? 0) + tr.sol);
      }
    }
    if (lastPrice < startPrice * (1 + minUp)) return false;
    if (buys < p.minBuys || byUser.size < p.minBuyers) return false;
    if (flow(b, now, p.flowWindow) < p.minFlowSol) return false;
    let top = 0;
    for (const v of byUser.values()) if (v > top) top = v;
    if (buySol > 0 && top > p.maxTopShare * buySol) return false;
    return true;
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const bigSell = new Set<Pubkey>();
      const traded = new Set<Pubkey>();
      for (const f of batch.fills) {
        if (f.status === 'filled' && !f.client_id.startsWith('_')) {
          myFills++;
          myCoins.add(f.mint);
          const h = held.get(f.mint);
          if (h !== undefined) h.txPaid += Number(f.tx_fee_lamports) / LAMPORTS;
        }
        if (f.client_id.startsWith('_') && f.side === 'sell') {
          // Harness close (complete / flatten / writeoff): the position is gone.
          held.delete(f.mint);
          probes.delete(f.mint);
        }
      }
      for (const e of batch.events) {
        if (e.block_time !== null) {
          if (firstTime === null) firstTime = e.block_time;
          if (lastTime === null || e.block_time > lastTime) lastTime = e.block_time;
        }
        if (e.event === 'CreateEvent') {
          const b = bookOf(e.mint);
          b.created = e.slot;
          b.creator = e.creator;
        } else if (e.event === 'TradeEvent') {
          const b = bookOf(e.mint);
          const sol = Number(e.sol_amount) / LAMPORTS;
          b.trades.push({ slot: e.slot, buy: e.is_buy, sol, user: e.user, price: Number(e.virtual_quote_reserves) / Math.max(1, Number(e.virtual_token_reserves)) });
          b.lastTradeSlot = e.slot;
          if (e.is_buy) b.lastBuySlot = e.slot;
          if (b.creator !== null && e.user === b.creator && !e.is_buy) b.devSold = true;
          traded.add(e.mint);
          if (!e.is_buy && sol >= p.bigSellSol) bigSell.add(e.mint);
        } else if (e.event === 'CompleteEvent') {
          bookOf(e.mint).done = true;
        }
      }
      // Trim tapes to the longest window any rule reads, plus a margin.
      const keep = Math.max(p.momWindow, p.recentWindow, p.flowWindow, p.exitFlowWindow) + 10;
      for (const mint of traded) {
        const b = books.get(mint)!;
        let cut = 0;
        while (cut < b.trades.length && b.trades[cut]!.slot <= now - keep) cut++;
        if (cut > 0) b.trades.splice(0, cut);
      }
      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));
      const pendingByMint = new Map<Pubkey, number>();
      for (const po of state.pending.values()) pendingByMint.set(po.order.mint, (pendingByMint.get(po.order.mint) ?? 0) + 1);

      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = Number(state.txFeeLamports()) / LAMPORTS;
      const txLamports = state.txFeeLamports();

      // Pacing: are the bot's own coins behind the target for the elapsed block time?
      let relaxed = false;
      if (firstTime !== null && lastTime !== null) {
        const pace = Math.min(1, (lastTime - firstTime) / p.paceSecs);
        if (myCoins.size < Math.ceil(p.targetCoins * pace)) relaxed = true;
      }

      // Exits first.
      for (const [mint, h] of held) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) {
            held.delete(mint);
          }
          continue;
        }
        h.filled = true;
        if (curve === undefined || curve.complete) continue;
        const mk = marks.get(mint);
        const vq = mk ? BigInt(mk.virtual_quote_reserves) : curve.virtual_quote_reserves;
        const vt = mk ? BigInt(mk.virtual_token_reserves) : curve.virtual_token_reserves;
        const value = Number(sellValue(pos.token_amount, vq, vt) - txLamports) / LAMPORTS;
        const cost = Number(pos.cost_lamports) / LAMPORTS + h.txPaid;
        if (value > h.best) h.best = value;
        if (value > h.peakValue) h.peakValue = value;
        const b = bookOf(mint);
        let exit = h.exiting;
        if (!exit && cost > 0 && value < cost * (1 - p.stopLoss)) exit = true;
        if (!exit && p.hardTp > 0 && cost > 0 && value >= cost * (1 + p.hardTp)) exit = true;
        if (!exit && h.best >= cost * (1 + p.trailArm) && value < h.best * (1 - p.trail)) exit = true;
        if (!exit && p.exitOnDevSell && b.devSold) exit = true;
        if (!exit && bigSell.has(mint)) exit = true;
        if (!exit && flow(b, now, p.exitFlowWindow) < -p.exitFlowSol) exit = true;
        if (!exit && now - h.opened > p.maxHold) exit = true;
        if (!exit && now - b.lastTradeSlot >= p.staleSlots) exit = true;
        if (!exit && now - b.lastBuySlot >= p.quietSlots) exit = true;
        if (!exit) continue;
        h.exiting = true;
        if (pendingByMint.has(mint)) {
          let sellPending = false;
          for (const po of state.pending.values()) if (po.order.mint === mint && po.order.side === 'sell') sellPending = true;
          if (sellPending) continue;
        }
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: p.sellSlipBps });
      }

      // Probe round trips: sell the whole probe as soon as its buy has landed.
      for (const [mint, selling] of probes) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) probes.delete(mint);
          continue;
        }
        if (curve === undefined || curve.complete || pendingByMint.has(mint)) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: p.sellSlipBps });
        if (!selling) probes.set(mint, true);
      }

      // Cash and room, shared by the confirmation adds and the new entries below.
      let free = Number(state.freeCashLamports()) / LAMPORTS;
      let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
      let exposure = 0;
      for (const [mint, h] of held) exposure += Math.max(h.invested, Number(state.positions.get(mint)?.cost_lamports ?? 0n) / LAMPORTS);

      // Adds: pyramid into strength only — each add needs the price to have stepped up
      // from the last buy and net SOL still flowing in, so a flat coin stays small.
      for (const [mint, h] of held) {
        if (orders.length >= cap) break;
        if (h.exiting || !h.filled) continue;
        if (h.invested >= p.maxStakeSol - p.minBuySol) continue;
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined || curve === undefined || curve.complete) continue;
        if (pendingByMint.has(mint)) continue;
        if (now - h.lastAddSlot < p.addDelay) continue;
        const price = Number(curve.virtual_quote_reserves) / Math.max(1, Number(curve.virtual_token_reserves));
        if (price < h.lastAddPrice * (1 + p.addStep)) continue;
        const b = bookOf(mint);
        if (flow(b, now, p.addWindow) < p.addMinFlowSol) continue;
        if (Number(curve.real_quote_reserves) / LAMPORTS > p.maxRealSol) continue;
        const capSol = Math.floor(Number(state.maxBuyLamports(mint))) / LAMPORTS;
        let amount = Math.min(capSol, p.addSol, p.maxStakeSol - h.invested, p.maxExposureSol - exposure);
        if (amount > free - tx) amount = free - tx;
        if (amount < p.minBuySol) continue;
        orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(amount * LAMPORTS)), max_slippage_bps: p.buySlipBps });
        free -= amount + tx;
        exposure += amount;
        h.invested += amount;
        h.lastAddPrice = price;
        h.lastAddSlot = now;
      }

      // Then entries.
      for (const mint of traded) {
        if (orders.length >= cap) break;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (pendingByMint.has(mint) || probes.has(mint) || held.has(mint)) continue;
        if (slotsLeft <= 0) continue;
        const b = books.get(mint)!;
        if (!entrySignal(b, now, Number(curve.real_quote_reserves) / LAMPORTS, relaxed)) continue;
        const capSol = Math.floor(Number(state.maxBuyLamports(mint))) / LAMPORTS;
        let amount = Math.min(capSol, p.firstBuySol, p.maxExposureSol - exposure);
        if (amount > free - tx) amount = free - tx;
        if (amount < p.minBuySol) continue;
        const lamports = BigInt(Math.floor(amount * LAMPORTS));
        const price = Number(curve.virtual_quote_reserves) / Math.max(1, Number(curve.virtual_token_reserves));
        orders.push({ side: 'buy', mint, quote_lamports: lamports, max_slippage_bps: p.buySlipBps });
        free -= amount + tx;
        exposure += amount;
        held.set(mint, { opened: now, peakValue: 0, invested: amount, exiting: false, filled: false, txPaid: 0, best: 0, lastAddPrice: price, lastAddSlot: now });
        b.entries++;
        slotsLeft--;
      }

      // Guardrail pacing: open a probe when the bot's coins lag the pace.
      if (relaxed && probes.size < p.maxProbes && slotsLeft > 0) {
        const minRq = (p.probeSol * Number(BPS)) / state.hello.caps.max_order_bps_of_real_reserve;
        for (const mint of traded) {
          if (orders.length >= cap || probes.size >= p.maxProbes) break;
          if (held.has(mint) || probes.has(mint) || pendingByMint.has(mint) || state.positions.has(mint)) continue;
          if (myCoins.has(mint)) continue;
          const curve = state.curves.get(mint);
          if (curve === undefined || curve.complete) continue;
          if (Number(curve.real_quote_reserves) / LAMPORTS < minRq * 1.5) continue;
          if (free < p.probeSol + 2 * tx) break;
          orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(p.probeSol * LAMPORTS)), max_slippage_bps: p.buySlipBps });
          probes.set(mint, false);
          free -= p.probeSol + tx;
        }
      }
      return orders;
    },

    onDone(state: BotState): void {
      const cashSol = Number(state.cash) / LAMPORTS;
      console.error(`[grad-runner] done: cash ${cashSol.toFixed(4)} SOL, my fills ${myFills}, my coins ${myCoins.size}, open positions ${state.positions.size}`);
    },
  };
}
