'use strict';

/* Card data, shuffling, deal, scoring, cardVisual(), and renderCardEl() all
   live in game-core.js (loaded before this file) so the pass-and-play and
   networked modes share one implementation. */

/* ---------- Game state (pass-and-play uses createGameState() from game-core.js) ---------- */

let G = null; // active game state
let solveOrder = []; // indices still needing to lock in, this round (pass-and-play only; sequential by device)

function newGame(playerNames, targetScore) {
    G = createGameState(playerNames, targetScore);
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
    if (isGameOver(G)) {
        return endGame();
    }
    if (G.round === 1 && !G.facility) {
        handoffTo(G.players[G.crisisIndex].name, 'CRISIS — frame the world before the first crisis.', () => {
            show('view-facility-setup');
            renderFacilitySetup();
        });
        return;
    }
    handoffTo(G.players[G.crisisIndex].name, 'CRISIS — pick up the device and draw the problem.', () => {
        show('view-crisis-draw');
        renderCrisisDraw();
    });
}

function renderFacilitySetup() {
    document.getElementById('facility-crisis-name').textContent = G.players[G.crisisIndex].name;
    ['facility-name', 'facility-mission', 'facility-monitors'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('btn-facility-submit').disabled = true;
}

function facilityFieldsFilled() {
    return ['facility-name', 'facility-mission', 'facility-monitors'].every(id => document.getElementById(id).value.trim());
}

['facility-name', 'facility-mission', 'facility-monitors'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
        document.getElementById('btn-facility-submit').disabled = !facilityFieldsFilled();
    });
});

document.getElementById('btn-facility-submit').addEventListener('click', () => {
    setFacility(
        G,
        document.getElementById('facility-name').value,
        document.getElementById('facility-mission').value,
        document.getElementById('facility-monitors').value
    );
    handoffTo(G.players[G.crisisIndex].name, 'CRISIS — pick up the device and draw the problem.', () => {
        show('view-crisis-draw');
        renderCrisisDraw();
    });
});

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
    document.getElementById('crisis-facility-strip').innerHTML = facilityStripHtml(G.facility);
    document.getElementById('crisis-name').textContent = G.players[G.crisisIndex].name;
    document.getElementById('crisis-round-num').textContent = G.round;
    document.getElementById('crisis-pile-count').textContent = G.drawPile.length;
    const zone = document.getElementById('crisis-card-zone');
    zone.innerHTML = '';
    document.getElementById('btn-draw-trouble').style.display = 'inline-block';
    document.getElementById('btn-crisis-ready').style.display = 'none';
}

document.getElementById('btn-draw-trouble').addEventListener('click', () => {
    const id = drawTrouble(G);
    const zone = document.getElementById('crisis-card-zone');
    zone.innerHTML = '';
    zone.appendChild(renderCardEl(CARDS_BY_ID[id], { big: true }));
    document.getElementById('btn-draw-trouble').style.display = 'none';
    document.getElementById('btn-crisis-ready').style.display = 'inline-block';
    document.getElementById('crisis-pile-count').textContent = G.drawPile.length;
});

document.getElementById('btn-crisis-ready').addEventListener('click', () => {
    solveOrder = nonCrisisIndices(G);
    advanceSolveQueue();
});

/* ---------- Solve phase ---------- */

function advanceSolveQueue() {
    if (solveOrder.length === 0) {
        show('view-reveal');
        renderReveal();
        return;
    }
    const idx = solveOrder[0];
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
    document.getElementById('solve-facility-strip').innerHTML = facilityStripHtml(G.facility);
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
    const idx = solveOrder.shift();
    lockProposal(G, idx, solveSelection);
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
        row.addEventListener('click', () => selectWinner(idx));
        list.appendChild(row);
    });
}

function selectWinner(winnerIdx) {
    const winner = awardRound(G, winnerIdx);
    show('view-round-result');
    document.getElementById('result-winner-name').textContent = winner.name;
    renderScoreboard('result-scoreboard');
}

document.getElementById('btn-next-round').addEventListener('click', () => {
    replenishAndRotate(G);
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
