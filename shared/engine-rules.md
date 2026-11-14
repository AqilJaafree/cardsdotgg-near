# Cardsdotgg engine rulings

These are the battle engine rulings; card stats and abilities are in `cards.json`.

- **E1** End of round runs heals, then stat growth, then swaps, then debuff timers. Within each step: side A then side B, slots 1 to 3.
- **E2** Start-of-round abilities run side A then side B, slots 1 to 3, then the tie roll.
- **E3** Action order is computed once per round, after step 1, and not re-sorted. A card that is gone by its turn is skipped.
- **E4** Rolls happen only when a rule calls for them, in this order per hit: variance, crit, 2x Long, then Hedge. Hedge rolls only when the target is Basis Mantis. Recursive Loop repeats the sequence per hit.
- **E5** Effective stat = (base + flat bonuses) x (10000 + sum of bps modifiers) / 10000, with floor division.
- **E6** Heals cap at max HP and never affect fainted cards. Halving is a flag on the target, used up by its next heal; it does not affect shields, because the "Ability rules" table overrides the deck table.
- **E7** Backstop protects only against hits from an enemy attack. Reflect and 2x Long self-damage can faint the card. If this empties both sides in the same action, the match is a draw.
- **E8** Audit: when a crit roll succeeds and the defending side has a living active Ledger Owl with Audit unused, the hit is normal and Audit is used up. The crit roll is still consumed.
- **E9** `hpShare` = sum(current HP) x 10000 / sum(max HP) across all 8 cards, with floor division. Fainted cards count as 0.

## Added by Agent A during the build

- **E10** Arbitrage compares against enemy active cards' base SPD, which avoids recursion in Basis Kestrel mirrors.
- **E11** Each Recursive Loop hit picks its target again, so the second hit lands on the refilled card if the first hit caused a faint. The second hit is skipped if the Kraken has fainted.
- **E12** After-hit effects (Backstop, Liquidation Strike, reflect, lifesteal, Widen, Halving) need damage above 0, so a dodge or a Peg Shield block triggers none of them. Reflect and lifesteal use the computed damage, not capped at the target's remaining HP. 2x Long self-damage applies last.
- **E13** End-of-round heals and growth apply to active cards only. Bench cards do nothing.
- **E14** A Redeem or Rebalance that finds no living bench card is not used up. Rebalance may move the Fox itself.
- **E15** In an attack log entry, a fainted target is handled after the entry, so refills appear as separate `kind` 3 entries that follow it.
