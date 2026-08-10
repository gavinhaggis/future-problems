'use strict';

/* ---------- Card visual system (deterministic per-card color + animation) ---------- */

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

/* ---------- Deck / card data ---------- */

let CARDS = [];
let CARDS_BY_ID = {};

async function loadCards() {
    const res = await fetch('data/cards.json');
    CARDS = await res.json();
    CARDS_BY_ID = Object.fromEntries(CARDS.map(c => [c.id, c]));
}

function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/* ---------- Game state ---------- */

const HAND_SIZE = 6;

let G = null; // active game state

function newGame(playerNames, targetScore) {
    const deck = shuffled(CARDS.map(c => c.id));
    const players = playerNames.map(name => ({ name, score: 0, hand: [], trophies: [] }));
    for (const p of players) {
        p.hand = deck.splice(0, HAND_SIZE);
    }
    G = {
        players,
        drawPile: deck,
        crisisIndex: 0,
        round: 1,
        targetScore,
        currentTrouble: null,
        proposals: {},      // playerIndex -> [cardId, cardId]
        solveOrder: [],     // indices still needing to lock in, this round
        gameOver: false,
        winner: null,
    };
}

function nonCrisisIndices() {
    return G.players.map((_, i) => i).filter(i => i !== G.crisisIndex);
}

function enoughCardsForRound() {
    // crisis needs 1, and each solver who is short of 6 will need to redraw next time
    return G.drawPile.length >= 1;
}

/* ---------- View plumbing ---------- */

const views = {};
document.querySelectorAll('.view').forEach(v => { views[v.id] = v; });

function show(id) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[id].classList.add('active');
    window.scrollTo(0, 0);
}

/* ---------- TITLE / SETUP ---------- */

document.getElementById('btn-new-session').addEventListener('click', () => {
    show('view-setup');
    renderSetup();
});

let setupNames = ['', '', ''];

function renderSetup() {
    const list = document.getElementById('setup-players');
    list.innerHTML = '';
    setupNames.forEach((name, i) => {
        const row = document.createElement('div');
        row.className = 'player-row';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = `Solver ${i + 1} name`;
        input.value = name;
        input.maxLength = 18;
        input.addEventListener('input', e => { setupNames[i] = e.target.value; });
        row.appendChild(input);
        if (setupNames.length > 3) {
            const rm = document.createElement('button');
            rm.className = 'ghost';
            rm.textContent = '✕';
            rm.addEventListener('click', () => { setupNames.splice(i, 1); renderSetup(); });
            row.appendChild(rm);
        }
        list.appendChild(row);
    });
}

document.getElementById('btn-add-player').addEventListener('click', () => {
    if (setupNames.length >= 8) return;
    setupNames.push('');
    renderSetup();
});

document.getElementById('btn-start-game').addEventListener('click', () => {
    const names = setupNames.map(n => n.trim()).filter(Boolean);
    if (names.length < 3) {
        alert('Need at least 3 solvers to start.');
        return;
    }
    const target = parseInt(document.getElementById('target-score').value, 10) || 3;
    newGame(names, target);
    startRound();
});

/* ---------- Round flow ---------- */

function startRound() {
    G.currentTrouble = null;
    G.proposals = {};
    if (!enoughCardsForRound() || G.players.some(p => p.score >= G.targetScore)) {
        return endGame();
    }
    handoffTo(G.players[G.crisisIndex].name, 'CRISIS — pick up the device and draw the problem.', () => {
        show('view-crisis-draw');
        renderCrisisDraw();
    });
}

function handoffTo(name, subtitle, onContinue) {
    document.getElementById('handoff-name').textContent = name;
    document.getElementById('handoff-subtitle').textContent = subtitle;
    show('view-handoff');
    const btn = document.getElementById('btn-handoff-continue');
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);
    fresh.addEventListener('click', onContinue);
}

function renderCrisisDraw() {
    document.getElementById('crisis-name').textContent = G.players[G.crisisIndex].name;
    document.getElementById('crisis-round-num').textContent = G.round;
    document.getElementById('crisis-pile-count').textContent = G.drawPile.length;
    const zone = document.getElementById('crisis-card-zone');
    zone.innerHTML = '';
    document.getElementById('btn-draw-trouble').style.display = 'inline-block';
    document.getElementById('btn-crisis-ready').style.display = 'none';
}

document.getElementById('btn-draw-trouble').addEventListener('click', () => {
    const id = G.drawPile.shift();
    G.currentTrouble = id;
    const zone = document.getElementById('crisis-card-zone');
    zone.innerHTML = '';
    zone.appendChild(renderCardEl(CARDS_BY_ID[id], { big: true }));
    document.getElementById('btn-draw-trouble').style.display = 'none';
    document.getElementById('btn-crisis-ready').style.display = 'inline-block';
    document.getElementById('crisis-pile-count').textContent = G.drawPile.length;
});

document.getElementById('btn-crisis-ready').addEventListener('click', () => {
    G.solveOrder = nonCrisisIndices();
    advanceSolveQueue();
});

/* ---------- Solve phase ---------- */

function advanceSolveQueue() {
    if (G.solveOrder.length === 0) {
        show('view-reveal');
        renderReveal();
        return;
    }
    const idx = G.solveOrder[0];
    const player = G.players[idx];
    handoffTo(player.name, 'SOLVER — pick two cards to solve the crisis.', () => {
        show('view-solve');
        renderSolveHand(idx);
    });
}

let solveSelection = [];

function renderSolveHand(playerIdx) {
    solveSelection = [];
    const player = G.players[playerIdx];
    document.getElementById('solve-player-name').textContent = player.name;
    const zone = document.getElementById('solve-trouble-zone');
    zone.innerHTML = '';
    zone.appendChild(renderCardEl(CARDS_BY_ID[G.currentTrouble], { big: true }));

    const grid = document.getElementById('solve-hand-grid');
    grid.innerHTML = '';
    player.hand.forEach(cardId => {
        const el = renderCardEl(CARDS_BY_ID[cardId]);
        el.addEventListener('click', () => {
            const i = solveSelection.indexOf(cardId);
            if (i >= 0) {
                solveSelection.splice(i, 1);
                el.classList.remove('selected');
            } else if (solveSelection.length < 2) {
                solveSelection.push(cardId);
                el.classList.add('selected');
            }
            document.getElementById('btn-lock-in').disabled = solveSelection.length !== 2;
        });
        grid.appendChild(el);
    });
    document.getElementById('btn-lock-in').disabled = true;
}

document.getElementById('btn-lock-in').addEventListener('click', () => {
    const idx = G.solveOrder.shift();
    const player = G.players[idx];
    G.proposals[idx] = solveSelection.slice();
    player.hand = player.hand.filter(c => !solveSelection.includes(c));
    advanceSolveQueue();
});

/* ---------- Reveal & Judge ---------- */

function renderReveal() {
    const zone = document.getElementById('reveal-trouble-zone');
    zone.innerHTML = '';
    zone.appendChild(renderCardEl(CARDS_BY_ID[G.currentTrouble], { big: true }));

    const list = document.getElementById('reveal-list');
    list.innerHTML = '';
    Object.entries(G.proposals).forEach(([idxStr, cardIds]) => {
        const idx = parseInt(idxStr, 10);
        const row = document.createElement('div');
        row.className = 'reveal-row';
        const who = document.createElement('div');
        who.className = 'who';
        who.textContent = G.players[idx].name;
        row.appendChild(who);
        const cardsWrap = document.createElement('div');
        cardsWrap.className = 'cards';
        cardIds.forEach(cid => cardsWrap.appendChild(renderCardEl(CARDS_BY_ID[cid])));
        row.appendChild(cardsWrap);
        list.appendChild(row);
    });
}

document.getElementById('btn-goto-judge').addEventListener('click', () => {
    handoffTo(G.players[G.crisisIndex].name, 'CRISIS — choose the winning solution.', () => {
        show('view-judge');
        renderJudge();
    });
});

function renderJudge() {
    const zone = document.getElementById('judge-trouble-zone');
    zone.innerHTML = '';
    zone.appendChild(renderCardEl(CARDS_BY_ID[G.currentTrouble], { big: true }));

    const list = document.getElementById('judge-list');
    list.innerHTML = '';
    Object.entries(G.proposals).forEach(([idxStr, cardIds]) => {
        const idx = parseInt(idxStr, 10);
        const row = document.createElement('div');
        row.className = 'reveal-row';
        const who = document.createElement('div');
        who.className = 'who';
        who.textContent = G.players[idx].name;
        row.appendChild(who);
        const cardsWrap = document.createElement('div');
        cardsWrap.className = 'cards';
        cardIds.forEach(cid => cardsWrap.appendChild(renderCardEl(CARDS_BY_ID[cid])));
        row.appendChild(cardsWrap);
        row.addEventListener('click', () => awardRound(idx));
        list.appendChild(row);
    });
}

function awardRound(winnerIdx) {
    const winner = G.players[winnerIdx];
    winner.score += 1;
    winner.trophies.push(G.currentTrouble);
    show('view-round-result');
    document.getElementById('result-winner-name').textContent = winner.name;
    renderScoreboard('result-scoreboard');
}

document.getElementById('btn-next-round').addEventListener('click', () => {
    // replenish hands for everyone who submitted
    Object.keys(G.proposals).forEach(idxStr => {
        const idx = parseInt(idxStr, 10);
        const player = G.players[idx];
        while (player.hand.length < HAND_SIZE && G.drawPile.length > 0) {
            player.hand.push(G.drawPile.shift());
        }
    });
    G.crisisIndex = (G.crisisIndex + 1) % G.players.length;
    G.round += 1;
    startRound();
});

/* ---------- Scoreboard / End ---------- */

function renderScoreboard(elId) {
    const el = document.getElementById(elId);
    el.innerHTML = '';
    const maxScore = Math.max(...G.players.map(p => p.score));
    G.players.slice().sort((a, b) => b.score - a.score).forEach(p => {
        const row = document.createElement('div');
        row.className = 'score-row' + (p.score === maxScore && maxScore > 0 ? ' leader' : '');
        row.innerHTML = `<span class="name">${escapeHtml(p.name)}</span><span class="pts">${p.score} pt${p.score === 1 ? '' : 's'} <span class="trophy">(${p.trophies.length} 🏆)</span></span>`;
        el.appendChild(row);
    });
}

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function endGame() {
    G.gameOver = true;
    const top = Math.max(...G.players.map(p => p.score));
    const winners = G.players.filter(p => p.score === top);
    document.getElementById('end-winner-name').textContent = winners.map(w => w.name).join(' & ');
    renderScoreboard('end-scoreboard');
    show('view-end');
}

document.getElementById('btn-play-again').addEventListener('click', () => {
    const names = G.players.map(p => p.name);
    const target = G.targetScore;
    newGame(names, target);
    startRound();
});

document.getElementById('btn-new-game').addEventListener('click', () => {
    show('view-title');
});

/* ---------- Boot ---------- */

(async function boot() {
    await loadCards();
    show('view-title');
})();
