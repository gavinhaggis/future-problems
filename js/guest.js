'use strict';
/* Guest client: dumb renderer driven entirely by messages from the host.
   Holds no authoritative state — just the last state payload, this
   player's own hand, and whether they're currently the crisis. */

let myPeer = null;
let hostConn = null;
let myAlias = null;
let myHand = [];      // [{id, en}]
let isCrisis = false;
let lastState = null; // last 'state' payload from host

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
    if (room) document.getElementById('join-code').value = room.toUpperCase();
})();

document.getElementById('btn-join-room').addEventListener('click', joinRoom);

function joinRoom() {
    const code = document.getElementById('join-code').value.trim().toUpperCase();
    const alias = document.getElementById('join-alias').value.trim().slice(0, 18);
    const errEl = document.getElementById('join-error');
    errEl.textContent = '';
    if (code.length !== 4) return (errEl.textContent = 'Enter the 4-letter room code.');
    if (!alias) return (errEl.textContent = 'Enter an alias.');

    myAlias = alias;
    document.getElementById('btn-join-room').disabled = true;
    myPeer = connectToRoom(
        code,
        (p, conn) => {
            hostConn = conn;
            conn.on('data', onMessage);
            conn.on('close', () => { errEl.textContent = 'Lost connection to host.'; });
            send(hostConn, 'join', { alias });
        },
        (err) => {
            errEl.textContent = 'Could not reach that room: ' + err.message;
            document.getElementById('btn-join-room').disabled = false;
        }
    );
}

function onMessage(msg) {
    if (msg.type === 'error') {
        document.getElementById('join-error').textContent = msg.message;
        document.getElementById('btn-join-room').disabled = false;
        show('view-join');
    } else if (msg.type === 'joined') {
        show('view-waiting');
    } else if (msg.type === 'lobby') {
        renderWaitingList(msg.players);
    } else if (msg.type === 'role') {
        isCrisis = !!msg.isCrisis;
    } else if (msg.type === 'yourHand') {
        myHand = msg.cards;
    } else if (msg.type === 'state') {
        lastState = msg.payload;
        show('view-game');
        renderGame();
    } else if (msg.type === 'gameOver') {
        lastState = msg.payload;
        renderGuestEnd();
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
        html += `<p class="dim">Locked in: ${s.lockedIn.length ? escapeHtml(s.lockedIn.join(', ')) : 'nobody yet'}</p>`;
        if (isCrisis) {
            html += `<p class="dim">Solvers are choosing on their own devices...</p>`;
        } else if (s.lockedIn.includes(myAlias)) {
            html += `<p>You're locked in. Waiting on the rest...</p>`;
        } else {
            html += `<p>Pick exactly two cards from your hand:</p><div class="hand-grid" id="game-hand-grid"></div><button id="btn-lock-in" disabled>&gt; LOCK IN</button>`;
        }
    } else if (s.phase === 'reveal') {
        html += `<div id="game-trouble-zone" style="width:100%;display:flex;justify-content:center;"></div>`;
        html += `<p class="dim">Solutions are in — argue your case aloud.</p>`;
        html += `<div id="game-reveal-list" style="width:100%;"></div>`;
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
                if (i >= 0) { selection.splice(i, 1); cardEl.classList.remove('selected'); }
                else if (selection.length < 2) { selection.push(card.id); cardEl.classList.add('selected'); }
                document.getElementById('btn-lock-in').disabled = selection.length !== 2;
            });
            grid.appendChild(cardEl);
        });
        document.getElementById('btn-lock-in').addEventListener('click', () => {
            send(hostConn, 'action', { action: 'propose', cardIds: selection });
        });
    }

    if (s.phase === 'reveal') {
        renderProposalList('game-reveal-list', s, null);
    }

    if (s.phase === 'judge') {
        renderProposalList('game-judge-list', s, isCrisis ? (alias) => send(hostConn, 'action', { action: 'judge', winnerAlias: alias }) : null);
    }
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
