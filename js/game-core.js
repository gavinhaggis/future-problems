'use strict';
/* Shared, DOM-free game logic used by both the pass-and-play app (app.js)
   and the networked host driver (host.js). Card data, shuffling, deal,
   and the deterministic per-card visual hash all live here so the two
   modes can't drift apart. */

const HAND_SIZE = 6;

const ACCENTS = ['accent-0','accent-1','accent-2','accent-3','accent-4','accent-5','accent-6','accent-7'];
const ANIMS = ['anim-glitch', 'anim-flicker', 'anim-scan', 'anim-pulse', '', '']; // '' = calm, weighted more likely

function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
}

function cardVisual(card) {
    const h = hashStr(card.en);
    const accent = ACCENTS[h % ACCENTS.length];
    const anim = ANIMS[(h >> 4) % ANIMS.length];
    return { accent, anim };
}

/** Builds a .card DOM element. `card` needs at least {id, en}. */
function renderCardEl(card, { big = false, selected = false } = {}) {
    const { accent, anim } = cardVisual(card);
    const el = document.createElement('div');
    el.className = 'card' + (big ? ' big-card' : '') + (selected ? ' selected' : '');
    el.style.setProperty('--card-accent', `var(--${accent})`);
    el.dataset.cardId = card.id;
    const nameEl = document.createElement('div');
    nameEl.className = 'card-name' + (anim ? ' ' + anim : '');
    nameEl.textContent = card.en.toUpperCase();
    el.appendChild(nameEl);
    return el;
}

let CARDS = [];
let CARDS_BY_ID = {};

async function loadCards(path = 'data/cards.json') {
    const res = await fetch(path);
    CARDS = await res.json();
    CARDS_BY_ID = Object.fromEntries(CARDS.map(c => [c.id, c]));
    return CARDS;
}

function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** Create a fresh game state: shuffles the deck, deals HAND_SIZE to each player. */
function createGameState(playerNames, targetScore) {
    const deck = shuffled(CARDS.map(c => c.id));
    const players = playerNames.map(name => ({ name, score: 0, hand: [], trophies: [] }));
    for (const p of players) {
        p.hand = deck.splice(0, HAND_SIZE);
    }
    return {
        players,
        drawPile: deck,
        crisisIndex: 0,
        round: 1,
        targetScore,
        currentTrouble: null,
        proposals: {},   // playerIndex -> [cardId, cardId]
        gameOver: false,
        facility: null,  // {name, mission, monitors} — set once, by round 1's crisis
    };
}

/** Records the round-1 facility framing. Mutates G. */
function setFacility(G, name, mission, monitors) {
    G.facility = { name: name.trim(), mission: mission.trim(), monitors: monitors.trim() };
}

/** Small persistent context strip shown once the facility has been framed. */
function facilityStripHtml(facility) {
    if (!facility) return '';
    return `<div class="facility-strip">🏭 <b>${escapeHtml(facility.name)}</b> &middot; Mission: ${escapeHtml(facility.mission)} &middot; Monitors: ${escapeHtml(facility.monitors)}</div>`;
}

function nonCrisisIndices(G) {
    return G.players.map((_, i) => i).filter(i => i !== G.crisisIndex);
}

function isGameOver(G) {
    return G.drawPile.length < 1 || G.players.some(p => p.score >= G.targetScore);
}

/** Draws the next problem card from the shared pile. Mutates G. */
function drawTrouble(G) {
    G.currentTrouble = G.drawPile.shift();
    return G.currentTrouble;
}

/** Records a solver's two-card proposal and removes those cards from their hand. Mutates G. */
function lockProposal(G, playerIdx, cardIds) {
    const player = G.players[playerIdx];
    G.proposals[playerIdx] = cardIds.slice();
    player.hand = player.hand.filter(c => !cardIds.includes(c));
}

/** Awards the round to a player: point + trophy card. Mutates G. */
function awardRound(G, winnerIdx) {
    const winner = G.players[winnerIdx];
    winner.score += 1;
    winner.trophies.push(G.currentTrouble);
    return winner;
}

/** Refills everyone who proposed this round back to HAND_SIZE, rotates the crisis, advances the round counter. Mutates G. */
function replenishAndRotate(G) {
    Object.keys(G.proposals).forEach(idxStr => {
        const idx = parseInt(idxStr, 10);
        const player = G.players[idx];
        while (player.hand.length < HAND_SIZE && G.drawPile.length > 0) {
            player.hand.push(G.drawPile.shift());
        }
    });
    G.crisisIndex = (G.crisisIndex + 1) % G.players.length;
    G.round += 1;
    G.currentTrouble = null;
    G.proposals = {};
}

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
