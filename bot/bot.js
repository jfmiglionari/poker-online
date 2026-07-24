// Bot de teste: conecta como um jogador de verdade via Socket.io (senta, recebe
// 'state'/'your-turn' e manda 'action' igual o client.js faria), só que decidindo
// sozinho. Serve pra ter alguém pra jogar contra durante o desenvolvimento.
//
// Uso: node bot/bot.js ["Nome do bot"] [seatIndex]
//   BOT_SERVER_URL=http://localhost:3000 node bot/bot.js

const { io } = require('socket.io-client');
const { Hand } = require('pokersolver');

const SERVER_URL = process.env.BOT_SERVER_URL || 'http://localhost:3000';
const BOT_NAME = process.argv[2] || 'Bot';
const REQUESTED_SEAT = process.argv[3] !== undefined ? Number(process.argv[3]) : null;
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

// Id persistido "fake" — só precisa ser único por bot pra ele poder reconectar
// no mesmo assento se cair (mesmo mecanismo do client.js/localStorage).
const playerId = `bot-${BOT_NAME}-${Math.random().toString(36).slice(2, 10)}`;

const socket = io(SERVER_URL);

let latestState = null;
let awaitingOwnAction = false;
let sitAttemptInFlight = false;

socket.on('connect', () => {
  console.log(`[${BOT_NAME}] conectado ao servidor (${socket.id})`);
});

socket.on('disconnect', () => {
  console.log(`[${BOT_NAME}] desconectado`);
});

socket.on('hand-result', (result) => {
  const summary = result.winners.map((w) => `${w.name} +${w.amountWon}`).join(', ');
  console.log(`[${BOT_NAME}] mão encerrada: ${summary}`);
});

socket.on('state', (state) => {
  latestState = state;

  const mySeat = state.seats.find((s) => s && s.isMe);
  if (!mySeat) {
    trySit(state);
    return;
  }

  const idx = state.seats.indexOf(mySeat);
  const isMyTurnNow =
    state.status === 'playing' &&
    state.currentTurnIndex === idx &&
    mySeat.inHand &&
    !mySeat.folded &&
    !mySeat.allIn;

  if (isMyTurnNow && !awaitingOwnAction) {
    awaitingOwnAction = true;
    const delay = 700 + Math.random() * 1300; // pausa "pensando", sempre bem abaixo do turn timeout
    setTimeout(() => {
      awaitingOwnAction = false;
      actIfStillMyTurn(idx);
    }, delay);
  } else if (!isMyTurnNow) {
    awaitingOwnAction = false;
  }
});

function trySit(state) {
  if (sitAttemptInFlight) return;
  const seatIndex = REQUESTED_SEAT !== null ? REQUESTED_SEAT : state.seats.findIndex((s) => s === null);
  if (seatIndex === -1 || seatIndex === undefined || state.seats[seatIndex]) return;

  sitAttemptInFlight = true;
  socket.emit('sit', { seatIndex, name: BOT_NAME, playerId });
  setTimeout(() => {
    sitAttemptInFlight = false;
  }, 1000);
}

function actIfStillMyTurn(idx) {
  const state = latestState;
  if (!state) return;
  if (state.status !== 'playing' || state.currentTurnIndex !== idx) return; // já não é mais a vez dele
  act(state, idx);
}

function cardRankIndex(card) {
  return RANKS.indexOf(card[0]);
}

// Sem pokersolver pré-flop (só 2 cartas): heurística simples por par/altura/naipe/conectividade.
function estimatePreflopStrength(holeCards) {
  const [a, b] = holeCards;
  const rA = cardRankIndex(a);
  const rB = cardRankIndex(b);

  if (rA === rB) return 0.5 + (rA / 12) * 0.5; // par: 0.5 (22) a 1.0 (AA)

  const high = Math.max(rA, rB);
  const low = Math.min(rA, rB);
  let strength = (high / 12) * 0.35 + (low / 12) * 0.15;
  if (a[1] === b[1]) strength += 0.06; // suited
  const gap = high - low;
  if (gap === 1) strength += 0.05;
  else if (gap === 2) strength += 0.02;
  return Math.min(strength, 0.95);
}

// 0..1, usando pokersolver a partir do flop em diante (já dá pra formar 5 cartas).
function estimateStrength(seat, state) {
  const holeCards = seat.holeCards.filter(Boolean);
  if (holeCards.length < 2) return 0.3;
  if (state.communityCards.length === 0) return estimatePreflopStrength(holeCards);

  const solved = Hand.solve([...holeCards, ...state.communityCards]);
  return Math.min(solved.rank / 9, 1);
}

// Sobe pra um total "redondo" em BB acima da maior aposta, respeitando o mínimo de raise
// e o teto do stack (all-in). Retorna null se o stack só dá pra pagar all-in (não sobra
// margem pra configurar um raise de verdade).
function computeRaiseTotal(state, me, highest) {
  const bb = state.bigBlind;
  const minTotal = highest + state.minRaise;
  const maxTotal = me.currentBet + me.stack;
  if (minTotal > maxTotal) return null;

  const sizeBB = 2 + Math.floor(Math.random() * 4); // 2 a 5 BB acima da maior aposta
  const desired = highest + sizeBB * bb;
  return Math.min(Math.max(desired, minTotal), maxTotal);
}

function send(type, amount) {
  console.log(`[${BOT_NAME}] ação: ${type}${amount !== undefined ? ' ' + amount : ''}`);
  socket.emit('action', { type, amount });
}

function act(state, idx) {
  const me = state.seats[idx];
  const highest = Math.max(0, ...state.seats.filter(Boolean).map((s) => s.currentBet));
  const toCall = highest - me.currentBet;
  const strength = estimateStrength(me, state);

  if (toCall <= 0) {
    const wantsToBet = strength > 0.72 && Math.random() < 0.55;
    const raiseTotal = wantsToBet ? computeRaiseTotal(state, me, highest) : null;
    if (raiseTotal !== null) send(highest === 0 ? 'bet' : 'raise', raiseTotal);
    else send('check');
    return;
  }

  const potOdds = toCall / (state.pot + toCall);

  if (strength < 0.16 && Math.random() < 0.75) {
    send('fold');
    return;
  }

  if (strength > 0.8 && Math.random() < 0.4) {
    const raiseTotal = computeRaiseTotal(state, me, highest);
    if (raiseTotal !== null) {
      send('raise', raiseTotal);
      return;
    }
  }

  if (strength < potOdds + 0.05 && Math.random() < 0.5) {
    send('fold');
    return;
  }

  send('call');
}
