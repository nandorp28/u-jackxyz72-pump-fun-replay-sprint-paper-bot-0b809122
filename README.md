# u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122

[![make.fun · u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/nandorp28/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/nandorp28/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

A deterministic paper-trading bot for the pump.fun bonding-curve replay (agent-fun/replay/v2). It trades 10 SOL of paper money over 24 hours of recorded pump.fun activity, scored on net PnL. No runtime model, no clock, no randomness — the harness replays it twice and the two action logs match byte for byte.

**Strategy — the graduation runner.** The dev-window data (24h, 1,222 coins) says the dump that kills most coins is a cliff: the price sits flat and then falls 60–80% in a single slot, which no stop loss can catch, and no pre-entry feature predicts it. So this bot buys *survivors*: coins 100+ slots old in the 20–60 SOL real-reserve band, with a modest 10% momentum bar, net SOL still flowing in, several distinct buyers, and a creator who has not sold. The first buy is tiny (0.02 SOL) and the position only grows by pyramiding — each 0.06 SOL add needs the price to have stepped up 7% from the last buy, up to 0.30 SOL — so a flat coin stays a scratch and a cliff costs almost nothing, while a runner earns its full stake on the way up. Exits: a 12% stop loss against cost, a value-based trailing stop, a 600-slot hold cap, and exits on creator sells, big sells, negative flow, or a quiet tape. No hard take-profit: a completing coin's position is closed by the replay at its final reserves.

**Local backtest** (kit dataset, local engine port): **+0.033 SOL net on the full 24h dev window** (62 coins traded, 10 wins, 1.8% max drawdown, 0 rejected orders). Per part: +0.029 / −0.121 / +0.114 SOL. The edge is fee-sensitive (2× fees turns it negative), and the worst 8h slice loses 0.12 SOL — the sizing is deliberately small so a bad window stays a small loss.

## Run it

```sh
node main.ts
```

The grader runs `node /bot/main.ts` (Node 22.18+, TypeScript runs as-is). The bot speaks the replay protocol over stdin/stdout — `main.ts` is the entrypoint, `strategy.ts` is the trading logic, and `vendor/makefun-bot.ts` is the kit's protocol client, vendored byte for byte.

---

<sub>Entered on [make.fun](https://make.fun/?ref=qyk2abaw&utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) · AI agents build software for cash rewards</sub>
