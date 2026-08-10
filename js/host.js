'use strict';
/* Host driver: runs the authoritative game state (from game-core.js) and
   pushes updates to connected guests over PeerJS (net.js). The host's own
   device is always players[0] and is rendered locally — it never sends
   itself network messages, it just re-renders after each local mutation. */

const HOST_IDX = 0;

let peer = null;
let roomCode = null;
let lobby = [];      // {alias, conn} — conn === null for the host's own seat
let spectators = []; // conns watching the TV display — never players
let started = false;
let G = null;
let conns = [];      // index-aligned with G.players; conns[HOST_IDX] is always null
let phase = 'lobby'; // 'crisis-draw' | 'solving' | 'reveal-queue' | 'judge' | 'result' | 'end'
let lastWinnerIdx = null;
let hostSelection = []; // card ids the host has tapped, while solving

// Reveal-queue: players choose when to present, then flip their two cards one at a time.
let revealedIdxs = new Set();
let currentlyRevealingIdx = null;
let flippedSlots = {}; // idx -> [0] or [0,1], in the order flipped

const views = {};
document.querySelectorAll('.view').forEach(v => { views[v.id] = v; });
function show(id) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[id].classList.add('active');
    window.scrollTo(0, 0);
}

/* ---------- Setup ---------- */

document.getElementById('btn-create-room').addEventListener('click', () => {
    const alias = document.getElementById('host-alias').value.trim().slice(0, 18);
    if (!alias) {
        document.getElementById('host-setup-error').textContent = 'Enter an alias first.';
        return;
    }
    document.getElementById('btn-create-room').disabled = true;
    lobby = [{ alias, conn: null }];
    peer = createHostPeer(
        (p, code) => {
            roomCode = code;
            peer.on('connection', setupConnection);
            renderLobby();
            show('view-lobby');
        },
        (err) => {
            document.getElementById('host-setup-error').textContent = 'Could not create room: ' + err.message;
            document.getElementById('btn-create-room').disabled = false;
        }
    );
});

function setupConnection(conn) {
    conn.on('data', (msg) => onMessage(conn, msg));
    conn.on('close', () => onDisconnect(conn));
}

function onDisconnect(conn) {
    spectators = spectators.filter(c => c !== conn);
    if (!started) {
        lobby = lobby.filter(p => p.conn !== conn);
        renderLobby();
    }
    // mid-game player disconnects are left connected in the player list; a rejoin with
    // the same alias (see handleJoin) rebinds a fresh connection to that seat.
}

function onMessage(conn, msg) {
    if (msg.type === 'join') return handleJoin(conn, msg.alias || '');
    if (msg.type === 'spectate') return handleSpectate(conn);
    if (!started) return;
    const idx = conns.indexOf(conn);
    if (idx === -1) return;
    if (msg.type === 'action') return handleAction(idx, msg);
}

function handleSpectate(conn) {
    spectators.push(conn);
    if (!started) {
        send(conn, 'lobby', { players: lobby.map(p => p.alias) });
    } else {
        send(conn, 'state', { payload: publicStatePayload() });
    }
}

function handleJoin(conn, aliasRaw) {
    const alias = aliasRaw.trim().slice(0, 18);
    if (!alias) return send(conn, 'error', { message: 'Enter an alias.' });

    if (!started) {
        if (lobby.some(p => p.alias.toLowerCase() === alias.toLowerCase())) {
            return send(conn, 'error', { message: 'That name is taken — try another.' });
        }
        lobby.push({ alias, conn });
        send(conn, 'joined', { alias });
        renderLobby();
        return;
    }

    const idx = G.players.findIndex(p => p.name.toLowerCase() === alias.toLowerCase());
    if (idx === -1) {
        return send(conn, 'error', { message: 'Game already in progress.' });
    }
    conns[idx] = conn; // rebind (covers page refresh / reconnect)
    send(conn, 'joined', { alias });
    sendRole(idx);
    sendHand(idx);
    sendPublicState();
}

/* ---------- Lobby ---------- */

function renderLobby() {
    document.getElementById('lobby-code').textContent = roomCode;
    document.getElementById('lobby-link').textContent = roomLink(roomCode);
    document.getElementById('lobby-tv-link').href = tvLink(roomCode);
    drawLobbyQR(roomLink(roomCode));
    const list = document.getElementById('lobby-list');
    list.innerHTML = '';
    lobby.forEach(p => {
        const row = document.createElement('div');
        row.className = 'lobby-row';
        row.innerHTML = `<span><span class="conn-dot"></span>${escapeHtml(p.alias)}</span>${p.conn === null ? '<span class="dim">(you)</span>' : ''}`;
        list.appendChild(row);
    });
    document.getElementById('lobby-count').textContent = `${lobby.length} joined — need at least 3`;
    document.getElementById('btn-start-game').disabled = lobby.length < 3;
    broadcastLobby();
}

let qrDrawnFor = null;
function drawLobbyQR(url) {
    if (qrDrawnFor === url || !window.QRCode) return;
    qrDrawnFor = url;
    QRCode.toDataURL(url, { width: 220, margin: 2, color: { dark: '#000000', light: '#ffffff' }, errorCorrectionLevel: 'M' },
        (err, dataUrl) => {
            if (err) return;
            const el = document.getElementById('lobby-qr');
            el.innerHTML = `<img src="${dataUrl}" width="220" height="220" alt="QR code to join room ${roomCode}">`;
        });
}

function broadcastLobby() {
    const names = lobby.map(p => p.alias);
    lobby.forEach(p => { if (p.conn) send(p.conn, 'lobby', { players: names }); });
    spectators.forEach(conn => send(conn, 'lobby', { players: names }));
}

document.getElementById('btn-start-game').addEventListener('click', () => {
    if (lobby.length < 3) return;
    const targetScore = parseInt(document.getElementById('host-target-score').value, 10) || 3;
    G = createGameState(lobby.map(p => p.alias), targetScore);
    conns = lobby.map(p => p.conn);
    started = true;
    beginRound();
});

/* ---------- Round flow ---------- */

function beginRound() {
    if (isGameOver(G)) return endGame();
    phase = (G.round === 1 && !G.facility) ? 'facility-setup' : 'crisis-draw';
    lastWinnerIdx = null;
    revealedIdxs = new Set();
    currentlyRevealingIdx = null;
    flippedSlots = {};
    G.players.forEach((_, i) => { sendRole(i); sendHand(i); });
    sendPublicState();
    show('view-table');
    renderTable();
    keepAwake();
    if (G.crisisIndex === HOST_IDX) vibrate([120, 60, 120]);
}

function handleAction(idx, msg) {
    const isCrisis = idx === G.crisisIndex;
    if (msg.action === 'setFacility' && isCrisis && phase === 'facility-setup') {
        const { name, mission, monitors } = msg;
        if (name && mission && monitors) doSetFacility(name, mission, monitors);
    } else if (msg.action === 'drawTrouble' && isCrisis && phase === 'crisis-draw' && G.currentTrouble === null) {
        doDrawTrouble();
    } else if (msg.action === 'crisisReady' && isCrisis && phase === 'crisis-draw' && G.currentTrouble !== null) {
        doCrisisReady();
    } else if (msg.action === 'propose' && phase === 'solving' && !isCrisis && !(idx in G.proposals)) {
        const cardIds = Array.isArray(msg.cardIds) ? msg.cardIds : [];
        const hand = G.players[idx].hand;
        if (cardIds.length === 2 && cardIds.every(c => hand.includes(c))) {
            doPropose(idx, cardIds);
        }
    } else if (msg.action === 'claimReveal' && phase === 'reveal-queue' && !isCrisis && currentlyRevealingIdx === null && !revealedIdxs.has(idx)) {
        doClaimReveal(idx);
    } else if (msg.action === 'flipCard' && phase === 'reveal-queue' && idx === currentlyRevealingIdx) {
        const slot = msg.slot;
        if ((slot === 0 || slot === 1) && !flippedSlots[idx].includes(slot)) doFlipCard(idx, slot);
    } else if (msg.action === 'doneRevealing' && phase === 'reveal-queue' && idx === currentlyRevealingIdx) {
        if (flippedSlots[idx].length === 2) doDoneRevealing(idx);
    } else if (msg.action === 'nudge' && isCrisis && (phase === 'solving' || phase === 'reveal-queue')) {
        doNudge(msg.targetAlias);
    } else if (msg.action === 'judge' && phase === 'judge' && isCrisis) {
        const winnerIdx = G.players.findIndex(p => p.name === msg.winnerAlias);
        if (winnerIdx !== -1) doJudge(winnerIdx);
    }
}

function doSetFacility(name, mission, monitors) {
    setFacility(G, name, mission, monitors);
    phase = 'crisis-draw';
    sendPublicState();
    renderTable();
}

function doDrawTrouble() {
    drawTrouble(G);
    sfx.trouble();
    sendPublicState();
    renderTable();
}

function doCrisisReady() {
    phase = 'solving';
    sendPublicState();
    renderTable();
    if (G.crisisIndex !== HOST_IDX) vibrate(80);
}

function doPropose(idx, cardIds) {
    lockProposal(G, idx, cardIds);
    if (idx === HOST_IDX) sfx.lockIn();
    sendHand(idx);
    if (nonCrisisIndices(G).every(i => i in G.proposals)) {
        phase = 'reveal-queue';
        if (G.crisisIndex === HOST_IDX) vibrate([100, 50, 100]);
    }
    sendPublicState();
    renderTable();
}

function doClaimReveal(idx) {
    currentlyRevealingIdx = idx;
    flippedSlots[idx] = [];
    sfx.revealStart();
    if (idx !== HOST_IDX) {
        const cards = G.proposals[idx].map(cid => ({ id: cid, en: CARDS_BY_ID[cid].en }));
        send(conns[idx], 'yourProposal', { cards });
    }
    sendPublicState();
    renderTable();
}

function doFlipCard(idx, slot) {
    flippedSlots[idx].push(slot);
    if (idx === HOST_IDX) sfx.flip();
    sendPublicState();
    renderTable();
}

function doDoneRevealing(idx) {
    revealedIdxs.add(idx);
    currentlyRevealingIdx = null;
    if (revealedIdxs.size === nonCrisisIndices(G).length) {
        phase = 'judge';
        if (G.crisisIndex === HOST_IDX) vibrate(80);
    }
    sendPublicState();
    renderTable();
}

function doNudge(targetAlias) {
    const idx = G.players.findIndex(p => p.name === targetAlias);
    if (idx === -1) return;
    if (idx === HOST_IDX) { showNudgeToast(G.players[G.crisisIndex].name); return; }
    send(conns[idx], 'nudged', { from: G.players[G.crisisIndex].name });
}

function doJudge(winnerIdx) {
    awardRound(G, winnerIdx);
    lastWinnerIdx = winnerIdx;
    phase = 'result';
    sfx.judge();
    setTimeout(() => sfx.fanfare(), 150);
    if (winnerIdx === HOST_IDX) vibrate([80, 40, 80, 40, 200]);
    sendPublicState();
    renderTable();
}

function doNextRound() {
    replenishAndRotate(G);
    beginRound();
}

/* ---------- Messaging to guests ---------- */

function sendRole(idx) {
    if (idx === HOST_IDX) return;
    send(conns[idx], 'role', { isCrisis: idx === G.crisisIndex });
}

function sendHand(idx) {
    if (idx === HOST_IDX) return;
    const cards = G.players[idx].hand.map(cid => ({ id: cid, en: CARDS_BY_ID[cid].en }));
    send(conns[idx], 'yourHand', { cards });
}

function publicStatePayload() {
    return {
        round: G.round,
        targetScore: G.targetScore,
        phase,
        crisisAlias: G.players[G.crisisIndex].name,
        facility: G.facility,
        scoreboard: G.players.map(p => ({ alias: p.name, score: p.score, trophies: p.trophies.length })),
        trouble: G.currentTrouble !== null ? { id: G.currentTrouble, en: CARDS_BY_ID[G.currentTrouble].en } : null,
        lockedIn: Object.keys(G.proposals).map(i => G.players[i].name),
        proposals: (phase === 'judge' || phase === 'result')
            ? Object.entries(G.proposals).map(([i, cardIds]) => ({
                alias: G.players[i].name,
                cards: cardIds.map(cid => ({ id: cid, en: CARDS_BY_ID[cid].en })),
              }))
            : null,
        revealQueue: (phase === 'reveal-queue') ? {
            presentingAlias: currentlyRevealingIdx !== null ? G.players[currentlyRevealingIdx].name : null,
            presentingSlots: currentlyRevealingIdx !== null ? [0, 1].map(slot => {
                const cid = G.proposals[currentlyRevealingIdx][slot];
                return flippedSlots[currentlyRevealingIdx].includes(slot) ? { flipped: true, card: { id: cid, en: CARDS_BY_ID[cid].en } } : { flipped: false };
            }) : null,
            entries: nonCrisisIndices(G).map(i => ({
                alias: G.players[i].name,
                status: revealedIdxs.has(i) ? 'done' : (i === currentlyRevealingIdx ? 'presenting' : 'waiting'),
                cards: revealedIdxs.has(i) ? G.proposals[i].map(cid => ({ id: cid, en: CARDS_BY_ID[cid].en })) : null,
            })),
        } : null,
        roundWinner: (phase === 'result' && lastWinnerIdx !== null) ? G.players[lastWinnerIdx].name : null,
    };
}

function sendPublicState() {
    const payload = publicStatePayload();
    conns.forEach((conn, i) => { if (conn) send(conn, 'state', { payload }); });
    spectators.forEach(conn => send(conn, 'state', { payload }));
}

/* ---------- Host's own table rendering ---------- */

function renderTable() {
    const el = document.getElementById('table-content');
    const isCrisis = G.crisisIndex === HOST_IDX;
    const crisisAlias = G.players[G.crisisIndex].name;
    const otherAliases = G.players.filter((_, i) => i !== HOST_IDX).map(p => p.name);

    let html = `<h2>ROUND ${G.round}</h2>`;
    html += facilityStripHtml(G.facility);
    html += `<div class="scoreboard" id="table-scoreboard"></div>`;

    if (phase === 'facility-setup') {
        if (isCrisis) {
            html += `<p>Frame the world before the first crisis.</p>
                <div class="facility-form">
                    <label for="fs-name">Facility name</label>
                    <input type="text" id="fs-name" maxlength="40" placeholder="Helix Orbital Station">
                    <label for="fs-mission">Its mission</label>
                    <input type="text" id="fs-mission" maxlength="60" placeholder="Terraforming the outer colonies">
                    <label for="fs-monitors">What you all monitor</label>
                    <input type="text" id="fs-monitors" maxlength="60" placeholder="Atmospheric integrity">
                </div>
                <button id="btn-facility-submit" disabled>&gt; BEGIN</button>`;
        } else {
            html += `<p class="dim">${escapeHtml(crisisAlias)} is framing the world before the first crisis...</p>`;
        }
    } else if (phase === 'crisis-draw') {
        html += `<div id="table-trouble-zone" style="width:100%;display:flex;justify-content:center;"></div>`;
        if (isCrisis) {
            html += G.currentTrouble === null
                ? `<p>Draw the problem card and narrate it.</p><button id="btn-draw-trouble">&gt; DRAW PROBLEM CARD</button>`
                : `<button id="btn-crisis-ready">&gt; NARRATED — START SOLVING</button>`;
        } else {
            html += `<p class="dim">${escapeHtml(crisisAlias)} is drawing the crisis...</p>`;
        }
    } else if (phase === 'solving') {
        html += `<div id="table-trouble-zone" style="width:100%;display:flex;justify-content:center;"></div>`;
        if (isCrisis) {
            html += `<div class="queue-list">` + nonCrisisIndices(G).map(i => {
                const p = G.players[i];
                const done = i in G.proposals;
                return `<div class="queue-row ${done ? 'status-done' : ''}"><span>${escapeHtml(p.name)}</span><span class="queue-status">${done ? '✓ locked in' : '<button class=\"queue-nudge\" data-nudge=\"' + escapeHtml(p.name) + '\">\u{1F44B} nudge</button>'}</span></div>`;
            }).join('') + `</div>`;
        } else if (HOST_IDX in G.proposals) {
            html += `<p>You're locked in. Waiting on the rest...</p>`;
        } else {
            html += `<p>Pick exactly two cards from your hand:</p><div class="hand-grid" id="table-hand-grid"></div><button id="btn-lock-in" disabled>&gt; LOCK IN</button>`;
        }
    } else if (phase === 'reveal-queue') {
        html += `<div id="table-trouble-zone" style="width:100%;display:flex;justify-content:center;"></div>`;
        html += renderRevealQueueHtml(isCrisis);
    } else if (phase === 'judge') {
        html += `<div id="table-trouble-zone" style="width:100%;display:flex;justify-content:center;"></div>`;
        if (isCrisis) {
            html += `<p>Tap the winning solution:</p><div id="table-judge-list" style="width:100%;"></div>`;
        } else {
            html += `<p class="dim">${escapeHtml(crisisAlias)} is judging...</p><div id="table-judge-list" style="width:100%;"></div>`;
        }
    } else if (phase === 'result') {
        const winnerAlias = lastWinnerIdx !== null ? G.players[lastWinnerIdx].name : '';
        html += `<h2>&#9733; ${escapeHtml(winnerAlias)} WINS THE ROUND</h2>`;
        html += `<button id="btn-next-round">&gt; NEXT ROUND</button>`;
    }

    el.innerHTML = html;
    renderScoreboardInto('table-scoreboard', G);

    const troubleZone = document.getElementById('table-trouble-zone');
    if (troubleZone && G.currentTrouble !== null) {
        troubleZone.appendChild(renderCardEl(CARDS_BY_ID[G.currentTrouble], { big: true }));
    }

    if (phase === 'facility-setup' && isCrisis) {
        const fields = ['fs-name', 'fs-mission', 'fs-monitors'];
        const checkFilled = () => {
            document.getElementById('btn-facility-submit').disabled = !fields.every(id => document.getElementById(id).value.trim());
        };
        fields.forEach(id => document.getElementById(id).addEventListener('input', checkFilled));
        document.getElementById('btn-facility-submit').addEventListener('click', () => {
            doSetFacility(
                document.getElementById('fs-name').value,
                document.getElementById('fs-mission').value,
                document.getElementById('fs-monitors').value
            );
        });
    }

    if (phase === 'crisis-draw' && isCrisis) {
        const drawBtn = document.getElementById('btn-draw-trouble');
        if (drawBtn) drawBtn.addEventListener('click', doDrawTrouble);
        const readyBtn = document.getElementById('btn-crisis-ready');
        if (readyBtn) readyBtn.addEventListener('click', doCrisisReady);
    }

    if (phase === 'solving' && !isCrisis && !(HOST_IDX in G.proposals)) {
        hostSelection = [];
        const grid = document.getElementById('table-hand-grid');
        G.players[HOST_IDX].hand.forEach(cardId => {
            const card = CARDS_BY_ID[cardId];
            const cardEl = renderCardEl(card);
            cardEl.addEventListener('click', () => {
                const i = hostSelection.indexOf(cardId);
                if (i >= 0) { hostSelection.splice(i, 1); cardEl.classList.remove('selected'); sfx.drop(); }
                else if (hostSelection.length < 2) { hostSelection.push(cardId); cardEl.classList.add('selected'); sfx.pick(); }
                document.getElementById('btn-lock-in').disabled = hostSelection.length !== 2;
            });
            grid.appendChild(cardEl);
        });
        document.getElementById('btn-lock-in').addEventListener('click', () => doPropose(HOST_IDX, hostSelection));
    }

    if (phase === 'solving' || phase === 'reveal-queue') {
        document.querySelectorAll('.queue-nudge').forEach(btn => {
            btn.addEventListener('click', () => doNudge(btn.dataset.nudge));
        });
    }

    if (phase === 'reveal-queue') {
        const claimBtn = document.getElementById('rq-claim-btn');
        if (claimBtn) claimBtn.addEventListener('click', () => doClaimReveal(HOST_IDX));
        document.querySelectorAll('[data-flip-slot]').forEach(el2 => {
            el2.addEventListener('click', () => doFlipCard(HOST_IDX, parseInt(el2.dataset.flipSlot, 10)));
        });
        const doneBtn = document.getElementById('rq-done-btn');
        if (doneBtn && !doneBtn.disabled) doneBtn.addEventListener('click', () => doDoneRevealing(HOST_IDX));
    }

    if (phase === 'judge') {
        renderProposalList('table-judge-list', isCrisis ? (idx) => doJudge(idx) : null);
    }

    if (phase === 'result') {
        document.getElementById('btn-next-round').addEventListener('click', doNextRound);
    }
}

function renderRevealQueueHtml(isCrisis) {
    const amPresenting = currentlyRevealingIdx === HOST_IDX;
    const haveRevealed = revealedIdxs.has(HOST_IDX);

    const queueHtml = `<div class="queue-list">` + nonCrisisIndices(G).map(i => {
        const p = G.players[i];
        const status = revealedIdxs.has(i) ? 'done' : (i === currentlyRevealingIdx ? 'presenting' : 'waiting');
        const statusLabel = status === 'done' ? '✓ presented' : status === 'presenting' ? '\u{1F5E3}️ presenting...' : 'waiting';
        const nudgeBtn = (isCrisis && status === 'waiting') ? `<button class="queue-nudge" data-nudge="${escapeHtml(p.name)}">\u{1F44B} nudge</button>` : '';
        const revealedCards = status === 'done'
            ? `<div class="cards">${G.proposals[i].map(cid => renderCardEl(CARDS_BY_ID[cid]).outerHTML).join('')}</div>` : '';
        return `<div class="queue-row status-${status}"><div class="queue-row-top"><span>${escapeHtml(p.name)}</span><span class="queue-status">${statusLabel}${nudgeBtn}</span></div>${revealedCards}</div>`;
    }).join('') + `</div>`;

    if (isCrisis) {
        const mirror = currentlyRevealingIdx !== null ? flipMirrorHtml(currentlyRevealingIdx) : '';
        return `<p class="dim">Watching the reveal...</p>${mirror}${queueHtml}`;
    }
    if (amPresenting) {
        const cardIds = G.proposals[HOST_IDX];
        const flipped = flippedSlots[HOST_IDX] || [];
        const slotsHtml = [0, 1].map(slot => {
            const cardHtml = renderCardEl(CARDS_BY_ID[cardIds[slot]]).outerHTML;
            return flipped.includes(slot)
                ? `<div class="flip-slot flipped">${cardHtml}</div>`
                : `<div class="flip-slot mine" data-flip-slot="${slot}">${cardHtml}</div>`;
        }).join('');
        const doneReady = flipped.length === 2;
        return `<p>Your turn — you can see your own cards below. Tap one to reveal it to the table, narrate as you go.</p><div class="flip-slots">${slotsHtml}</div><button id="rq-done-btn" ${doneReady ? '' : 'disabled'}>&gt; DONE PRESENTING</button>${queueHtml}`;
    }
    if (haveRevealed) {
        const mirror = currentlyRevealingIdx !== null ? flipMirrorHtml(currentlyRevealingIdx) : '<p class="dim">Waiting on the rest...</p>';
        return `<p>You've presented.</p>${mirror}${queueHtml}`;
    }
    if (currentlyRevealingIdx === null) {
        return `<button id="rq-claim-btn">&gt; I'LL GO</button>${queueHtml}`;
    }
    return `${flipMirrorHtml(currentlyRevealingIdx)}${queueHtml}`;
}

function flipMirrorHtml(idx) {
    const cardIds = G.proposals[idx];
    const flipped = flippedSlots[idx] || [];
    const slotsHtml = [0, 1].map(slot => flipped.includes(slot)
        ? `<div class="flip-slot flipped">${renderCardEl(CARDS_BY_ID[cardIds[slot]]).outerHTML}</div>`
        : `<div class="flip-slot">?</div>`
    ).join('');
    return `<p class="dim">${escapeHtml(G.players[idx].name)} is presenting:</p><div class="flip-slots">${slotsHtml}</div>`;
}

function renderProposalList(elId, onPick) {
    const list = document.getElementById(elId);
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
        if (onPick) row.addEventListener('click', () => onPick(idx));
        list.appendChild(row);
    });
}

function renderScoreboardInto(elId, state) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = '';
    const maxScore = Math.max(...state.players.map(p => p.score));
    state.players.slice().sort((a, b) => b.score - a.score).forEach(p => {
        const row = document.createElement('div');
        row.className = 'score-row' + (p.score === maxScore && maxScore > 0 ? ' leader' : '');
        row.innerHTML = `<span class="name">${escapeHtml(p.name)}</span><span class="pts">${p.score} pt${p.score === 1 ? '' : 's'} <span class="trophy">(${p.trophies.length} \u{1F3C6})</span></span>`;
        el.appendChild(row);
    });
}

/* ---------- End ---------- */

function endGame() {
    phase = 'end';
    const top = Math.max(...G.players.map(p => p.score));
    const winners = G.players.filter(p => p.score === top);
    const payload = publicStatePayload();
    conns.forEach((conn, i) => { if (conn) send(conn, 'gameOver', { payload }); });
    spectators.forEach(conn => send(conn, 'gameOver', { payload }));
    allowSleep();
    document.getElementById('host-end-winner-name').textContent = winners.map(w => w.name).join(' & ');
    renderScoreboardInto('host-end-scoreboard', G);
    show('view-host-end');
}

document.getElementById('btn-host-new-room').addEventListener('click', () => {
    window.location.reload();
});

/* ---------- Boot ---------- */

(async function boot() {
    await loadCards();
    show('view-host-setup');
})();
