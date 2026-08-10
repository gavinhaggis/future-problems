'use strict';
/* TV display: pure spectator. Joins a room without an alias or a hand —
   just renders whatever public state the host broadcasts, big and clean,
   for a laptop/TV/projector everyone in the room can see. */

let tvPeer = null;
let tvConn = null;
let lastTvState = null;

const views = {};
document.querySelectorAll('.view').forEach(v => { views[v.id] = v; });
function show(id) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[id].classList.add('active');
}

(function prefillRoomCode() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) document.getElementById('tv-code').value = room.toUpperCase();
})();

document.getElementById('btn-tv-connect').addEventListener('click', connect);

function connect() {
    const code = document.getElementById('tv-code').value.trim().toUpperCase();
    const errEl = document.getElementById('tv-error');
    errEl.textContent = '';
    if (code.length !== 4) return (errEl.textContent = 'Enter the 4-letter room code.');

    document.getElementById('btn-tv-connect').disabled = true;
    tvPeer = connectToRoom(
        code,
        (p, conn) => {
            tvConn = conn;
            conn.on('data', onMessage);
            conn.on('close', () => {
                errEl.textContent = 'Lost connection to host.';
                document.getElementById('btn-tv-connect').disabled = false;
                show('view-tv-join');
            });
            send(tvConn, 'spectate', {});
            keepAwake();
        },
        (err) => {
            errEl.textContent = 'Could not reach that room: ' + err.message;
            document.getElementById('btn-tv-connect').disabled = false;
        }
    );
}

function onMessage(msg) {
    if (msg.type === 'lobby') {
        show('view-tv-display');
        renderTvLobby(msg.players);
    } else if (msg.type === 'state' || msg.type === 'gameOver') {
        lastTvState = msg.payload;
        show('view-tv-display');
        renderTvGame(msg.type === 'gameOver');
    }
}

function renderTvLobby(players) {
    const el = document.getElementById('tv-content');
    el.innerHTML = `<h1>WAITING FOR HOST TO START</h1><div class="scoreboard">${
        players.map(name => `<div class="score-row"><span class="name">${escapeHtml(name)}</span></div>`).join('')
    }</div>`;
}

function renderTvGame(isOver) {
    const s = lastTvState;
    const el = document.getElementById('tv-content');
    let html = `<div class="tv-round">ROUND ${s.round}${isOver ? ' — FINAL' : ''}</div>`;
    html += facilityStripHtml(s.facility);

    if (isOver) {
        const maxScore = Math.max(...s.scoreboard.map(p => p.score));
        const winners = s.scoreboard.filter(p => p.score === maxScore).map(p => p.alias).join(' & ');
        html += `<h1 style="text-align:center;">${escapeHtml(winners)} WINS</h1>`;
    } else if (s.phase === 'facility-setup') {
        html += `<p class="status-text">${escapeHtml(s.crisisAlias)} is framing the world before the first crisis...</p>`;
    } else if (s.phase === 'crisis-draw') {
        html += `<div style="width:100%;display:flex;justify-content:center;" id="tv-trouble-zone"></div>`;
        html += `<p class="status-text">${escapeHtml(s.crisisAlias)} is narrating the crisis...</p>`;
    } else if (s.phase === 'solving') {
        html += `<div style="width:100%;display:flex;justify-content:center;" id="tv-trouble-zone"></div>`;
        html += `<p class="status-text">Locked in: ${s.lockedIn.length ? escapeHtml(s.lockedIn.join(', ')) : 'nobody yet'}</p>`;
    } else if (s.phase === 'reveal-queue') {
        html += `<div style="width:100%;display:flex;justify-content:center;" id="tv-trouble-zone"></div>`;
        const rq = s.revealQueue;
        if (rq.presentingAlias) {
            html += `<p class="status-text">${escapeHtml(rq.presentingAlias)} is presenting...</p>`;
            html += `<div class="flip-slots">` + rq.presentingSlots.map(slot => slot.flipped
                ? `<div class="flip-slot flipped">${renderCardEl(slot.card).outerHTML}</div>`
                : `<div class="flip-slot">?</div>`
            ).join('') + `</div>`;
        } else {
            html += `<p class="status-text">Waiting for the next solver to present...</p>`;
        }
        html += `<div class="queue-list">` + rq.entries.map(e => {
            const statusLabel = e.status === 'done' ? '✓ presented' : e.status === 'presenting' ? '\u{1F5E3}️ presenting...' : 'waiting';
            const revealedCards = e.status === 'done'
                ? `<div class="cards">${e.cards.map(c => renderCardEl(c).outerHTML).join('')}</div>` : '';
            return `<div class="queue-row status-${e.status}"><div class="queue-row-top"><span>${escapeHtml(e.alias)}</span><span class="queue-status">${statusLabel}</span></div>${revealedCards}</div>`;
        }).join('') + `</div>`;
    } else if (s.phase === 'judge') {
        html += `<div style="width:100%;display:flex;justify-content:center;" id="tv-trouble-zone"></div>`;
        html += `<p class="status-text">${escapeHtml(s.crisisAlias)} is judging...</p>`;
        html += `<div id="tv-proposal-list" style="width:100%;"></div>`;
    } else if (s.phase === 'result') {
        html += `<h2 style="text-align:center;">&#9733; ${escapeHtml(s.roundWinner || '')} WINS THE ROUND</h2>`;
    }

    html += `<div class="scoreboard" id="tv-scoreboard"></div>`;
    el.innerHTML = html;

    const zone = document.getElementById('tv-trouble-zone');
    if (zone && s.trouble) zone.appendChild(renderCardEl(s.trouble, { big: true }));

    const list = document.getElementById('tv-proposal-list');
    if (list) {
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
            list.appendChild(row);
        });
    }

    const scoreEl = document.getElementById('tv-scoreboard');
    const maxScore = Math.max(...s.scoreboard.map(p => p.score));
    s.scoreboard.slice().sort((a, b) => b.score - a.score).forEach(p => {
        const row = document.createElement('div');
        row.className = 'score-row' + (p.score === maxScore && maxScore > 0 ? ' leader' : '');
        row.innerHTML = `<span class="name">${escapeHtml(p.alias)}${p.alias === s.crisisAlias && !isOver ? ' \u{1F6A8}' : ''}</span><span class="pts">${p.score} pt${p.score === 1 ? '' : 's'} <span class="trophy">(${p.trophies} \u{1F3C6})</span></span>`;
        scoreEl.appendChild(row);
    });

    if (isOver) allowSleep();
}

/* ---------- Boot ---------- */

(async function boot() {
    await loadCards();
    show('view-tv-join');
})();
