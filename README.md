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
- **[tv.html](tv.html)** — read-only scoreboard + live crisis card for a laptop, TV, or projector. Joins the room as a pure spectator (no alias, no hand) — put it up where everyone can see it.

**Reveal, your way:** once everyone's locked in a solution, nobody's forced into a fixed order. Any solver can claim the floor ("I'll go"), then flips their two cards one at a time — narrating between flips — while everyone else (including the crisis and the TV display) watches live. The crisis can nudge whoever's stuck thinking. Pacing and tension are the point, not a side effect.

**Feel:**
- Card picks, lock-ins, crisis reveals, and round wins all get a small synthesized sound cue (Web Audio oscillators — no audio files shipped) and, on phones that support it, a haptic buzz. Mute with the 🔊 button in the corner (persisted per device).
- The screen stays awake for the duration of a game (Wake Lock API) so it doesn't dim mid-turn — released automatically when the game ends.
- A guest's room + alias is cached locally, so a dropped WebRTC connection (phone locked, backgrounded, flaky WiFi) reconnects and reattaches to the same hand/score automatically instead of booting them back to the join screen.

**Known limitation:** the host's tab is the game — if they close it mid-session, the game ends. There's no host migration in this version.

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
├── tv.html              # v2 — read-only TV/laptop scoreboard display
├── rules.html            # rules explainer (EN/FI/RO/RU)
├── css/style.css         # terminal design system
├── js/
│   ├── game-core.js      # shared, DOM-free game logic (deck, deal, scoring, card visuals) — used by every page
│   ├── net.js              # PeerJS room-code + connection helpers
│   ├── polish.js            # shared: synthesized SFX, vibration, wake lock, room-reconnect cache
│   ├── app.js                 # pass-and-play driver (index.html)
│   ├── host.js                  # networked host driver (host.html)
│   ├── guest.js                   # networked guest renderer (play.html)
│   ├── tv.js                        # networked spectator renderer (tv.html)
│   └── vendor/                        # vendored, no CDN dependency
│       ├── peerjs.min.js
│       └── qrcode.min.js
├── data/cards.json     # 227 card titles
└── LICENSE              # MIT
```

## Credits

Rules and card list adapted from *[Medieval Solutions](https://www.medievalsolutions.com)* by Gavin Hanigan. Contributions welcome.
