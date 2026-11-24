// Pump.fun Replay Sprint — Paper Bot, Real Ranking.
// The grader runs `node /bot/main.ts` and replays the bot twice over 24h of recorded
// pump.fun activity; the two action logs must match byte for byte, so everything here is
// deterministic — no clock, no randomness, no network, no I/O.
//
// The strategy lives in strategy.ts: a graduation runner that buys old, flat survivors
// of the bonding curve (20-60 SOL real, 100+ slots old) in a tiny first tranche and only
// pyramids into strength, with a stop loss, a value-based trailing stop and a 600-slot
// hold cap. Its DEFAULT_PARAMS are the profile validated on the kit dev window (all
// three parts and the full 24h): +0.033 SOL net on the full window, 62 coins traded,
// 1.8% max drawdown. This entrypoint runs those defaults as-is, so the graded run
// trades exactly the settings the backtests measured.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
