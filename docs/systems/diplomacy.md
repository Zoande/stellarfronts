# Diplomacy

Faction-to-faction relations: border policies, wars, treaties, proposals, peace, and messaging. Model
in [`src/data/Diplomacy.ts`](../../src/data/Diplomacy.ts); command handling in
[`server/game/diplomacy-handlers.ts`](../../server/game/diplomacy-handlers.ts).

## State

`DiplomacyState` ([`src/data/Diplomacy.ts`](../../src/data/Diplomacy.ts)) holds:

- **Border policies** (`DiplomacyBorderPolicy`, `BorderPolicy` = `open` | `closed`) — asymmetric:
  A can close its borders to B without B reciprocating. Affects transit and migration.
- **Wars** (`DiplomacyWar`) — attacker/defender, start/end year, and a pre-war ownership snapshot used
  to restore territory on a status-quo peace.
- **Treaties** (`DiplomacyTreaty`) — a faction pair, `TreatyArticleId` articles (`tradePrivilege`,
  `migrationPact`), start/end year, and a minimum duration (`TREATY_MIN_YEARS` = 1, up to a max).
- **Proposals** (`DiplomacyProposal`, kind `treaty` | `peace`, status pending/accepted/declined/
  cancelled) — offers awaiting a response.
- **Peace terms** (`DiplomacyPeaceTerms`, `PeaceMode` = `whitePeace` | `statusQuo`) — optional system
  transfers (`DiplomacySystemTransferTerm`) and enforced articles.
- **Messages** (`DiplomacyChatMessage`) — bounded per-pair chat history.

## Article effects

`TreatyArticleDefinition` describes what an article does (`TreatyArticleEffect`): e.g. `tradePrivilege`
shares a fraction of internal market supply/demand; `migrationPact` boosts cross-faction migration.
War suspends these articles.

## Commands

The client sends diplomacy commands (`setBorderPolicy`, `declareWar`, `proposeTreaty`,
`respondDiplomacyProposal`, `cancelTreaty`, `cancelDiplomacyProposal`, `proposePeace`,
`sendDiplomacyMessage` — see `ClientCommand` in
[`src/game/GameProtocol.ts`](../../src/game/GameProtocol.ts)); the server validates and applies them in
[`server/game/diplomacy-handlers.ts`](../../server/game/diplomacy-handlers.ts). First contact ("met",
see [galaxy-map-and-visibility.md](galaxy-map-and-visibility.md)) is a precondition for most relations.

## How to extend / rules

- **Add a treaty article:** add the id to `TreatyArticleId`, define it in the article definitions, and
  apply its effect where articles are evaluated (market sharing / migration).
- Peace that transfers systems must keep `starOwnership` and starbase ownership consistent — reuse the
  existing transfer logic rather than mutating ownership ad hoc.
- New diplomacy state needs normalizer defaults so old saves load.

## Key files

- Model: [`src/data/Diplomacy.ts`](../../src/data/Diplomacy.ts).
- Server: [`server/game/diplomacy-handlers.ts`](../../server/game/diplomacy-handlers.ts).
- UI: [`src/ui/DiplomacyPanel.ts`](../../src/ui/DiplomacyPanel.ts).
- Tests: [`server/tests/diplomacy.test.ts`](../../server/tests/diplomacy.test.ts).
