# Future Problems

A free, open-source party game of impossible tomorrows — retro-terminal sci-fi cousin of *Medieval Solutions*.

One player is the **Crisis** — they draw a card from the scenario pile and narrate why it's a critical problem of the future. Everyone else is a **Solver** — each secretly picks two cards from their hand as an absurd, dead-serious solution. Best pitch wins the point (and the trophy card). Roles rotate. First to the target score wins.

No art, no accounts, no server. Open `index.html` and play — pass the device around the table.

**[▶ Play](index.html)** · **[How to play](rules.html)**

---

## Version 1 — pass-and-play (this version)

- Pure static site: HTML/CSS/vanilla JS, no build step, no dependencies.
- One shared device, passed around the table. Privacy between hands is handled with "pass the device, tap to reveal" gates.
- 227 cards, sourced from `data/cards.json`. Card names only — the game runs on the players' imaginations, not flavour text.
- Visual identity: CRT terminal aesthetic (VT323 font, scanlines, neon accents). Every card gets a deterministic accent colour and text animation (glitch / flicker / scan / pulse) derived from its own name, so the deck has visual variety without any art assets.

### Running locally

Card data is loaded via `fetch()`, so open it through a local server rather than `file://`:

```sh
cd future-problems
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

### Deploying

Push to GitHub and enable GitHub Pages on the repo (Settings → Pages → deploy from branch, root). No build step required.

---

## Version 2 — planned: one link, real multiplayer

Goal: a single shareable room link, players join from their own phones with an alias, no pass-and-play. Planned approach:

- Keep this same static frontend and game logic.
- Add a serverless realtime backend (Firebase Realtime Database or Supabase — both free at this scale) for room state sync, so no server needs to be run or paid for.
- Split the single shared view into per-player views (each phone shows only its own hand), with the Crisis/Judge actions gated to whoever holds that role.

---

## Project structure

```
future-problems/
├── index.html       # the game
├── rules.html        # rules explainer (EN/FI/RO/RU)
├── css/style.css     # terminal design system
├── js/app.js         # game state machine + rendering
├── data/cards.json   # 227 card titles
└── LICENSE            # MIT
```

## Credits

Rules and card list adapted from *Medieval Solutions* by Gavin Haggis. Contributions welcome — this is meant as a gift, not a product.
