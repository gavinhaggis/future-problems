'use strict';
/* Guest client: dumb renderer driven entirely by messages from the host.
   Holds no authoritative state — just the last state payload, this
   player's own hand, and whether they're currently the crisis. */

let myPeer = null;
let hostConn = null;
let myAlias = null;
let myRoomCode = null;
let myHand = [];      // [{id, en}]
let isCrisis = false;
let lastState = null; // last 'state' payload from host
let hasJoinedOnce = false;
let reconnecting = false;
let lastTroubleSoundFor = null;
let lastResultAnnouncedFor = null;
let lastPresentingAlias = undefined;
let lastFlipCount = 0;
let myProposalReveal = null; // [{id, en}] — my own 2 proposal cards, sent privately when I claim the reveal floor

const views = {};
document.querySelectorAll('.view').forEach(v => { views[v.id] = v; });
function show(id) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[id].classList.add('active');
    window.scrollTo(0, 0);
}

/* ---------- Join ---------- */

(function prefillRoomCode() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    const cached = loadRoomCache();
    if (room) {
        document.getElementById('join-code').value = room.toUpperCase();
    } else if (cached) {
        document.getElementById('join-code').value = cached.room;
        document.getElementById('join-alias').value = cached.alias;
    }
})();

document.getElementById('btn-join-room').addEventListener('click', () => joinRoom(false));

function joinRoom(isReconnect) {
    const code = document.getElementById('join-code').value.trim().toUpperCase();
    const alias = document.getElementById('join-alias').value.trim().slice(0, 18);
    const errEl = document.getElementById('join-error');
    errEl.textContent = '';
    if (code.length !== 4) return (errEl.textContent = 'Enter the 4-letter room code.');
    if (!alias) return (errEl.textContent = 'Enter an alias.');

    myAlias = alias;
    myRoomCode = code;
    document.getElementById('btn-join-room').disabled = true;
    myPeer = connectToRoom(
        code,
        (p, conn) => {
            hostConn = conn;
            conn.on('data', onMessage);
            conn.on('close', onHostDisconnect);
            send(hostConn, 'join', { alias });
        },
        (err) => {
            if (isReconnect) return scheduleReconnect();
            errEl.textContent = 'Could not reach that room: ' + err.message;
            document.getElementById('btn-join-room').disabled = false;
        }
    );
}

function onHostDisconnect() {
    if (!hasJoinedOnce) return;
    scheduleReconnect();
}

function scheduleReconnect() {
    if (reconnecting) return;
    reconnecting = true;
    showReconnectBanner(true);
    setTimeout(() => {
        if (myPeer) { try { myPeer.destroy(); } catch (e) { /* ignore */ } }
        joinRoom(true);
    }, 1500);
}

function showReconnectBanner(visible) {
    let banner = document.getElementById('reconnect-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'reconnect-banner';
        banner.className = 'reconnect-banner';
        banner.textContent = 'Reconnecting to the host...';
        document.body.appendChild(banner);
    }
    banner.style.display = visible ? 'block' : 'none';
}

function onMessage(msg) {
    if (msg.type === 'error') {
        if (reconnecting) return; // stale room state from a dead connection — ignore, keep retrying
        document.getElementById('join-error').textContent = msg.message;
        document.getElementById('btn-join-room').disabled = false;
        show('view-join');
    } else if (msg.type === 'joined') {
        hasJoinedOnce = true;
        reconnecting = false;
        showReconnectBanner(false);
        saveRoomCache(myRoomCode, myAlias);
        keepAwake();
        if (!lastState) show('view-waiting');
        else { show('view-game'); renderGame(); }
    } else if (msg.type === 'lobby') {
        renderWaitingList(msg.players);
    } else if (msg.type === 'role') {
        const wasCrisis = isCrisis;
        isCrisis = !!msg.isCrisis;
        if (isCrisis && !wasCrisis) vibrate([120, 60, 120]);
    } else if (msg.type === 'yourHand') {
        myHand = msg.cards;
    } else if (msg.type === 'state') {
        lastState = msg.payload;
        show('view-game');
        renderGame();
    } else if (msg.type === 'gameOver') {
        lastState = msg.payload;
        allowSleep();
        renderGuestEnd();
    } else if (msg.type === 'nudged') {
        showNudgeToast(msg.from);
    } else if (msg.type === 'yourProposal') {
        myProposalReveal = msg.cards;
    }
}

function renderWaitingList(players) {
    const list = document.getElementById('waiting-list');
    list.innerHTML = '';
    players.forEach(name => {
        const row = document.createElement('div');
        row.className = 'lobby-row';
        row.innerHTML = `<span class="conn-dot"></span>${escapeHtml(name)}${name === myAlias ? ' <span class="dim">(you)</span>' : ''}`;
        list.appendChild(row);
    });
}

/* ---------- Game rendering ---------- */

function renderGame() {
    const s = lastState;
    const el = document.getElementById('game-content');
    let html = `<h2>ROUND ${s.round}</h2>`;
    html += facilityStripHtml(s.facility);
    html += `<div class="scoreboard" id="game-scoreboard"></div>`;

    if (s.phase === 'facility-setup') {
        if (isCrisis) {
            html += `<p>You're the CRISIS. Frame the world before the first crisis.</p>
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
            html += `<p class="dim">${escapeHtml(s.crisisAlias)} is framing the world before the first crisis...</p>`;
        }
    } else if (s.phase === 'crisis-draw') {
        html += `<div id="game-trouble-zone" style="width:100%;display:flex;justify-content:center;"></div>`;
        if (isCrisis) {
            html += s.trouble === null
                ? `<p>You're the CRISIS. Draw the problem card and narrate it to the table.</p><button id="btn-draw-trouble">&gt; DRAW PROBLEM CARD</button>`
                : `<button id="btn-crisis-ready">&gt; NARRATED — START SOLVING</button>`;
        } else {
            html += `<p class="dim">${escapeHtml(s.crisisAlias)} is drawing the crisis...</p>`;
        }
    } else if (s.phase === 'solving') {
        html += `<div id="game-trouble-zone" style="width:100%;display:flex;justify-content:center;"></div>`;
        if (isCrisis) {
            html += `<p class="dim">Solvers are choosing on their own devices...</p>`;
            html += `<div class="queue-list">` + s.scoreboard.filter(p => p.alias !== s.crisisAlias).map(p => {
                const done = s.lockedIn.includes(p.alias);
                const nudgeBtn = done ? '' : `<button class="queue-nudge" data-nudge="${escapeHtml(p.alias)}">\u{1F44B} nudge</button>`;
                return `<div class="queue-row ${done ? 'status-done' : ''}"><span>${escapeHtml(p.alias)}</span><span class="queue-status">${done ? '✓ locked in' : 'thinking...'}${nudgeBtn}</span></div>`;
            }).join('') + `</div>`;
        } else if (s.lockedIn.includes(myAlias)) {
            html += `<p>You're locked in. Waiting on the rest...</p>`;
        } else {
            html += `<p>Pick exactly two cards from your hand:</p><div class="hand-grid" id="game-hand-grid"></div><button id="btn-lock-in" disabled>&gt; LOCK IN</button>`;
        }
    } else if (s.phase === 'reveal-queue') {
        html += `<div id="game-trouble-zone" style="width:100%;display:flex;justify-content:center;"></div>`;
        html += renderRevealQueueHtml(s, isCrisis);
    } else if (s.phase === 'judge') {
        html += `<div id="game-trouble-zone" style="width:100%;display:flex;justify-content:center;"></div>`;
        if (isCrisis) {
            html += `<p>Tap the winning solution:</p><div id="game-judge-list" style="width:100%;"></div>`;
        } else {
            html += `<p class="dim">${escapeHtml(s.crisisAlias)} is judging...</p><div id="game-judge-list" style="width:100%;"></div>`;
        }
    } else if (s.phase === 'result') {
        html += `<h2>&#9733; ${escapeHtml(s.roundWinner || '')} WINS THE ROUND</h2>`;
        html += `<p class="dim">Waiting for the host to start the next round...</p>`;
    }

    el.innerHTML = html;
    renderScoreboardFromPayload('game-scoreboard', s);

    const troubleZone = document.getElementById('game-trouble-zone');
    if (troubleZone && s.trouble) {
        troubleZone.appendChild(renderCardEl(s.trouble, { big: true }));
        if (lastTroubleSoundFor !== s.trouble.id) { lastTroubleSoundFor = s.trouble.id; sfx.trouble(); }
    }

    if (s.phase === 'result') {
        const resultKey = `${s.round}:${s.roundWinner}`;
        if (lastResultAnnouncedFor !== resultKey) {
            lastResultAnnouncedFor = resultKey;
            sfx.fanfare();
            if (s.roundWinner === myAlias) vibrate([80, 40, 80, 40, 200]);
        }
    }

    if (s.phase === 'facility-setup' && isCrisis) {
        const fields = ['fs-name', 'fs-mission', 'fs-monitors'];
        const checkFilled = () => {
            document.getElementById('btn-facility-submit').disabled = !fields.every(id => document.getElementById(id).value.trim());
        };
        fields.forEach(id => document.getElementById(id).addEventListener('input', checkFilled));
        document.getElementById('btn-facility-submit').addEventListener('click', () => {
            send(hostConn, 'action', {
                action: 'setFacility',
                name: document.getElementById('fs-name').value,
                mission: document.getElementById('fs-mission').value,
                monitors: document.getElementById('fs-monitors').value,
            });
        });
    }

    if (s.phase === 'crisis-draw' && isCrisis) {
        const drawBtn = document.getElementById('btn-draw-trouble');
        if (drawBtn) drawBtn.addEventListener('click', () => send(hostConn, 'action', { action: 'drawTrouble' }));
        const readyBtn = document.getElementById('btn-crisis-ready');
        if (readyBtn) readyBtn.addEventListener('click', () => send(hostConn, 'action', { action: 'crisisReady' }));
    }

    if (s.phase === 'solving' && !isCrisis && !s.lockedIn.includes(myAlias)) {
        let selection = [];
        const grid = document.getElementById('game-hand-grid');
        myHand.forEach(card => {
            const cardEl = renderCardEl(card);
            cardEl.addEventListener('click', () => {
                const i = selection.indexOf(card.id);
                if (i >= 0) { selection.splice(i, 1); cardEl.classList.remove('selected'); sfx.drop(); }
                else if (selection.length < 2) { selection.push(card.id); cardEl.classList.add('selected'); sfx.pick(); }
                document.getElementById('btn-lock-in').disabled = selection.length !== 2;
            });
            grid.appendChild(cardEl);
        });
        document.getElementById('btn-lock-in').addEventListener('click', () => {
            sfx.lockIn();
            send(hostConn, 'action', { action: 'propose', cardIds: selection });
        });
    }

    if (s.phase === 'solving' || s.phase === 'reveal-queue') {
        document.querySelectorAll('.queue-nudge').forEach(btn => {
            btn.addEventListener('click', () => send(hostConn, 'action', { action: 'nudge', targetAlias: btn.dataset.nudge }));
        });
    }

    if (s.phase === 'reveal-queue') {
        const rq = s.revealQueue;
        if (rq.presentingAlias !== lastPresentingAlias) {
            lastPresentingAlias = rq.presentingAlias;
            lastFlipCount = 0;
            if (rq.presentingAlias && rq.presentingAlias !== myAlias) { sfx.revealStart(); vibrate([10, 30, 10]); }
        }
        const flippedNow = rq.presentingSlots ? rq.presentingSlots.filter(s2 => s2.flipped).length : 0;
        if (flippedNow > lastFlipCount && rq.presentingAlias !== myAlias) { sfx.flip(); vibrate(15); }
        lastFlipCount = flippedNow;

        const claimBtn = document.getElementById('rq-claim-btn');
        if (claimBtn) claimBtn.addEventListener('click', () => send(hostConn, 'action', { action: 'claimReveal' }));
        document.querySelectorAll('[data-flip-slot]').forEach(el2 => {
            el2.addEventListener('click', () => {
                sfx.flip();
                send(hostConn, 'action', { action: 'flipCard', slot: parseInt(el2.dataset.flipSlot, 10) });
            });
        });
        const doneBtn = document.getElementById('rq-done-btn');
        if (doneBtn && !doneBtn.disabled) doneBtn.addEventListener('click', () => send(hostConn, 'action', { action: 'doneRevealing' }));
    }

    if (s.phase === 'judge') {
        renderProposalList('game-judge-list', s, isCrisis ? (alias) => send(hostConn, 'action', { action: 'judge', winnerAlias: alias }) : null);
    }
}

function renderRevealQueueHtml(s, isCrisis) {
    const rq = s.revealQueue;
    const entry = rq.entries.find(e => e.alias === myAlias);
    const amPresenting = rq.presentingAlias === myAlias;
    const haveRevealed = entry && entry.status === 'done';

    const queueHtml = `<div class="queue-list">` + rq.entries.map(e => {
        const statusLabel = e.status === 'done' ? '✓ presented' : e.status === 'presenting' ? '\u{1F5E3}️ presenting...' : 'waiting';
        const nudgeBtn = (isCrisis && e.status === 'waiting') ? `<button class="queue-nudge" data-nudge="${escapeHtml(e.alias)}">\u{1F44B} nudge</button>` : '';
        const revealedCards = e.status === 'done'
            ? `<div class="cards">${e.cards.map(c => renderCardEl(c).outerHTML).join('')}</div>` : '';
        return `<div class="queue-row status-${e.status}"><div class="queue-row-top"><span>${escapeHtml(e.alias)}</span><span class="queue-status">${statusLabel}${nudgeBtn}</span></div>${revealedCards}</div>`;
    }).join('') + `</div>`;

    if (isCrisis) {
        return `<p class="dim">Watching the reveal...</p>${flipMirrorHtml(rq)}${queueHtml}`;
    }
    if (amPresenting && myProposalReveal) {
        const flipped = rq.presentingSlots ? rq.presentingSlots.filter(s => s.flipped).length : 0;
        const slotsHtml = myProposalReveal.map((card, slot) => {
            const cardHtml = renderCardEl(card).outerHTML;
            const isFlipped = rq.presentingSlots && rq.presentingSlots[slot].flipped;
            return isFlipped
                ? `<div class="flip-slot flipped">${cardHtml}</div>`
                : `<div class="flip-slot mine" data-flip-slot="${slot}">${cardHtml}</div>`;
        }).join('');
        return `<p>Your turn — you can see your own cards below. Tap one to reveal it to the table, narrate as you go.</p><div class="flip-slots">${slotsHtml}</div><button id="rq-done-btn" ${flipped === 2 ? '' : 'disabled'}>&gt; DONE PRESENTING</button>${queueHtml}`;
    }
    if (haveRevealed) {
        return `<p>You've presented.</p>${flipMirrorHtml(rq)}${queueHtml}`;
    }
    if (rq.presentingAlias === null) {
        return `<button id="rq-claim-btn">&gt; I'LL GO</button>${queueHtml}`;
    }
    return `${flipMirrorHtml(rq)}${queueHtml}`;
}

function flipMirrorHtml(rq) {
    if (!rq.presentingAlias) return '';
    const slotsHtml = rq.presentingSlots.map(s => s.flipped
        ? `<div class="flip-slot flipped">${renderCardEl(s.card).outerHTML}</div>`
        : `<div class="flip-slot">?</div>`
    ).join('');
    return `<p class="dim">${escapeHtml(rq.presentingAlias)} is presenting:</p><div class="flip-slots">${slotsHtml}</div>`;
}

function renderProposalList(elId, s, onPick) {
    const list = document.getElementById(elId);
    list.innerHTML = '';
    (s.proposals || []).forEach(p => {
        const row = document.createElement('div');
        row.className = 'reveal-row';
        const who = document.createElement('div');
        who.className = 'who';
        who.textContent = p.alias;
        row.appendChild(who);
        const cardsWrap = document.createElement('div');
        cardsWrap.className = 'cards';
        p.cards.forEach(c => cardsWrap.appendChild(renderCardEl(c)));
        row.appendChild(cardsWrap);
        if (onPick) row.addEventListener('click', () => onPick(p.alias));
        list.appendChild(row);
    });
}

function renderScoreboardFromPayload(elId, s) {
    const el = document.getElementById(elId);
    el.innerHTML = '';
    const maxScore = Math.max(...s.scoreboard.map(p => p.score));
    s.scoreboard.slice().sort((a, b) => b.score - a.score).forEach(p => {
        const row = document.createElement('div');
        row.className = 'score-row' + (p.score === maxScore && maxScore > 0 ? ' leader' : '');
        row.innerHTML = `<span class="name">${escapeHtml(p.alias)}</span><span class="pts">${p.score} pt${p.score === 1 ? '' : 's'} <span class="trophy">(${p.trophies} \u{1F3C6})</span></span>`;
        el.appendChild(row);
    });
}

function renderGuestEnd() {
    const s = lastState;
    const maxScore = Math.max(...s.scoreboard.map(p => p.score));
    const winners = s.scoreboard.filter(p => p.score === maxScore);
    document.getElementById('guest-end-winner-name').textContent = winners.map(w => w.alias).join(' & ');
    renderScoreboardFromPayload('guest-end-scoreboard', s);
    show('view-guest-end');
}

/* ---------- Boot ---------- */

(async function boot() {
    await loadCards();
    show('view-join');
})();
