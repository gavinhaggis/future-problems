'use strict';
/* Thin PeerJS wrapper: room codes and connection setup only. All game logic
   lives in game-core.js / host.js / guest.js — this file just gets two
   browsers talking. Uses the free public PeerJS cloud broker (peerjs.com)
   purely to negotiate the initial WebRTC handshake; once connected, players
   talk directly to the host's device, peer-to-peer, no server in between. */

const ROOM_PREFIX = 'futprob-';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L — easy to read aloud

function generateRoomCode(length = 4) {
    let code = '';
    for (let i = 0; i < length; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return code;
}

function roomLink(code) {
    const url = new URL('play.html', window.location.href);
    url.searchParams.set('room', code);
    return url.toString();
}

function tvLink(code) {
    const url = new URL('tv.html', window.location.href);
    url.searchParams.set('room', code);
    return url.toString();
}

/** Host side: opens a Peer whose id encodes the room code. Retries with a new code on collision. */
function createHostPeer(onOpen, onError, attempt = 0) {
    const code = generateRoomCode();
    const peer = new Peer(ROOM_PREFIX + code);
    peer.on('open', () => onOpen(peer, code));
    peer.on('error', (err) => {
        if (err.type === 'unavailable-id' && attempt < 5) {
            peer.destroy();
            createHostPeer(onOpen, onError, attempt + 1);
        } else {
            onError(err);
        }
    });
    return peer;
}

/** Guest side: opens a random Peer, then connects to the host's room-code peer. */
function connectToRoom(code, onConnected, onError) {
    const peer = new Peer();
    peer.on('open', () => {
        const conn = peer.connect(ROOM_PREFIX + code.toUpperCase().trim(), { reliable: true });
        conn.on('open', () => onConnected(peer, conn));
        conn.on('error', onError);
    });
    peer.on('error', onError);
    return peer;
}

function send(conn, type, data = {}) {
    if (conn && conn.open) conn.send({ type, ...data });
}
