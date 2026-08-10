# Future Problems

A free, open-source party game of impossible tomorrows — retro-terminal sci-fi cousin of *Medieval Solutions*.

Round 1's Crisis opens by framing the facility everyone works in — its name, its mission, what it monitors — which stays visible for the rest of the session. Then the loop begins: the Crisis draws a card from the scenario pile and narrates why it's a critical problem of the future. Everyone else is a **Solver** — each secretly picks two cards from their hand as an absurd, dead-serious solution. Best pitch wins the point (and the trophy card). Roles rotate. First to the target score wins.

No art, no accounts, no server. Open `index.html` and play — pass the device around the table.

**[▶ Play](index.html)** · **[How to play](rules.html)**

---

## Version 2 — one link, real multiplayer

Host a room from one device, share a 4-letter code (or link), everyone else joins from their own phone with an alias. No accounts, no database, no server to run or pay for — the host's device holds the game state and talks directly to each guest over WebRTC (via [PeerJS](https://peerjs.com), using its free public broker only to negotiate the connection). Since hands are private per device, solvers pick their two cards simultaneously instead of taking turns — faster than pass-and-play.

- **[host.html](host.html)** — create a room, share the code, run the table.
- **[play.html](play.html)** — join a room with a code + alias.

**Known limitation:** the host's tab is the game — if they close it mid-session, the game ends. There's no host migration in this version. A guest who refreshes can rejoin with the same alias and reattaches to their existing hand/score.

---

## Version 1 — pass-and-play

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

## Project structure

```
future-problems/
├── index.html         # title screen + pass-and-play (v1)
├── host.html          # v2 — create & run a room
├── play.html           # v2 — join a room
├── rules.html          # rules explainer (EN/FI/RO/RU)
├── css/style.css       # terminal design system
├── js/
│   ├── game-core.js    # shared, DOM-free game logic (deck, deal, scoring, card visuals) — used by all three pages
│   ├── net.js           # PeerJS room-code + connection helpers
│   ├── app.js            # pass-and-play driver (index.html)
│   ├── host.js            # networked host driver (host.html)
│   ├── guest.js            # networked guest renderer (play.html)
│   └── vendor/peerjs.min.js  # vendored, no CDN dependency
├── data/cards.json     # 227 card titles
└── LICENSE              # MIT
```

## Credits

Rules and card list adapted from *[Medieval Solutions](https://www.medievalsolutions.com)* by Gavin Hanigan. Contributions welcome.
