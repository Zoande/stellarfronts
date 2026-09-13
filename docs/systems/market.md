# Market

Faction-scoped resource markets with production/upkeep depth, rolling trade pressure, player
auto-trade, and treaty market blocs. Model: [`src/data/Market.ts`](../../src/data/Market.ts);
server processing: [`server/game/economy-market.ts`](../../server/game/economy-market.ts).

## What trades

Food, minerals, consumer goods, and alloys are tradable. Energy is the settlement currency and is
not itself listed; research cannot be bought or sold. Trades pay a 5% energy fee.

## Pricing

Every faction has a private market unless Trade Privilege connects it to other factions. A connected
treaty component is one market bloc, including transitive connections. War suspends the affected
treaty edge. Members pool market calculations, but not stockpiles, orders, statistics, or ownership.

For each resource:

- Baseline supply is five times the bloc's gross monthly production, with a 10-unit minimum.
- Baseline demand is five times the bloc's gross monthly upkeep, with a 10-unit minimum.
- Purchases minus sales from the current and previous four game months form rolling trade balance.
- Positive balance adds demand; negative balance adds supply.
- Price is `base × sqrt(effective demand / effective supply)`, floored at 25% of base with no ceiling.

Base prices are 1.1 energy for food, 1.4 for minerals, 3.2 for goods, and 5.5 for alloys.
Bulk orders use the average of the pre-trade and post-trade marginal prices, so the displayed total
includes slippage. Buying adds the fee and selling subtracts it.

## Trading and persistence

Manual trades execute immediately. Automatic orders execute their configured hourly quantity;
purchases shrink to the maximum affordable amount and sales stop at available stockpile. Both paths
use identical pricing and record their actual average price, fee, and faction-owned trade volume.

Trade volume is stored in monthly faction/resource buckets. Market-bloc quotes aggregate the active
members' buckets dynamically, so treaty joins and splits do not migrate state. Faction-specific price
history is sampled every six game hours and retains five game months.

Save normalization removes legacy global pressure and history, drops energy/research market data,
and preserves eligible player totals, transactions, alerts, and automatic orders.

## Rules

- Trades are server-authoritative and never use credit.
- Use `MarketResourceKind` for market-facing state and commands.
- Keep pricing in shared pure helpers so client previews and server execution remain identical.
- Tune through the `MARKET_*` constants rather than inline values.
