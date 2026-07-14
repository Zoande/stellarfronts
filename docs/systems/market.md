# Market

A galactic resource market with supply/demand price pressure and player auto-trade. Model:
[`src/data/Market.ts`](../../src/data/Market.ts); server processing:
[`server/game/economy-market.ts`](../../server/game/economy-market.ts).

## What trades

Tradeable resources are a subset of the economy's six (energy and research are not freely traded — see
[economy.md](economy.md)). **Energy is the settlement currency**: trades are denominated in energy and
charged a fee (`MARKET_FEE_RATE` = 0.05).

## Pricing

Each `MarketResourceState` has a base price scaled by **temporary** and **persistent** pressure, the
result clamped between `MARKET_MIN_PRICE_MULTIPLIER` (0.25) and `MARKET_MAX_PRICE_MULTIPLIER` (4).

- Buying pushes price up, selling pushes it down: manual trades apply
  `MARKET_MANUAL_PRESSURE_FACTOR` (0.04) per unit, auto-trades `MARKET_AUTO_PRESSURE_FACTOR` (0.01).
- Pressure decays each hour: temporary by `MARKET_TEMPORARY_DECAY_PER_HOUR` (0.96), persistent by
  `MARKET_PERSISTENT_DECAY_PER_HOUR` (0.995) — so sustained trading keeps prices moved while one-off
  trades fade quickly.
- A price snapshot is recorded every `MARKET_PRICE_SNAPSHOT_INTERVAL_HOURS` (6), keeping up to
  `MARKET_PRICE_SNAPSHOT_LIMIT_PER_RESOURCE` (180) points for history charts.

## Trading & auto-trade

`MarketTradeType` is `buy` / `sell` / `auto_buy` / `auto_sell`. Manual trades are immediate; auto-trade
orders (`MarketAutoTradeOrder`) execute a configured amount per hour. Transactions are logged
(`MarketTransactionRecord`) and per-player stats kept (`MarketPlayerStats`). Treaty `tradePrivilege`
articles let allies share a portion of internal supply/demand (see [diplomacy.md](diplomacy.md)).

`processMarketTicks` ([`server/game/economy-market.ts`](../../server/game/economy-market.ts)) decays
pressure, recomputes prices, runs auto-trades, and snapshots — called from `advanceState` on the
economy hour. Commands: `marketTrade`, `addMarketAutoTrade`, `removeMarketAutoTrade`
([`src/game/GameProtocol.ts`](../../src/game/GameProtocol.ts)).

## How to extend / rules

- Tune via the `MARKET_*` constants in [`src/data/Market.ts`](../../src/data/Market.ts), not inline
  literals.
- Trades are server-authoritative and require sufficient energy/resources; no buying on credit.
- New market state needs normalizer defaults so old saves load.

## Key files

- Model + constants: [`src/data/Market.ts`](../../src/data/Market.ts).
- Server: [`server/game/economy-market.ts`](../../server/game/economy-market.ts).
- UI: [`src/ui/MarketPanel.ts`](../../src/ui/MarketPanel.ts).
- Tests: [`server/tests/market.test.ts`](../../server/tests/market.test.ts).
