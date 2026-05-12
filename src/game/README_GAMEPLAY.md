// src/game/README_GAMEPLAY.md
# Stellarfronts Gameplay Guide

## What is Stellarfronts?
Stellarfronts is a turn-based strategy game set in a procedurally generated galaxy. Players command fleets, capture stars, build starbases, and compete for galactic dominance.

## How to Play
- **Goal:** Achieve the victory condition (e.g., control all stars or complete all objectives).
- **Turns:** Each player takes actions in turns. On your turn, you can move fleets, build ships, and manage resources.
- **Movement:** Fleets travel between stars via hyperlanes. Moving takes several turns depending on distance.
- **Combat:** When fleets from different players meet at a star, combat is resolved automatically.
- **Resources:** Capturing stars increases your resource income, allowing you to build more ships and starbases.
- **Objectives:** Complete special objectives for additional victory paths.
- **Win/Lose:** The game ends in victory if you meet the victory condition, or defeat if all your fleets are destroyed or the max turn limit is reached.

## Victory Conditions
- Control every star in the galaxy.
- Complete all listed objectives.

## Defeat Conditions
- All your fleets are destroyed.
- The maximum number of turns is reached.

## Tips
- Expand early to secure resources.
- Protect your fleets and starbases.
- Plan your moves ahead—travel takes time!
- Watch your objectives for alternate win paths.

---
For more details, see the code in `/src/game/core.ts` and `/src/types/game.ts`.
