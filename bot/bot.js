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

// Sem isso o bot fica travado pra sempre no assento assim que o stack zera (nunca
// responde ao rebuy-offer). Sempre aceita, igual um jogador que quer continuar jogando.
socket.on('rebuy-offer', ({ defaultBuyin }) => {
  console.log(`[${BOT_NAME}] recebeu rebuy-offer (+${defaultBuyin}), aceitando...`);
  setTimeout(() => {
    socket.emit('rebuy-response', { accept: true });
  }, 800 + Math.random() * 800);
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
// Propositalmente inflada (jogador amador supervaloriza qualquer par, suited e "tem um Ás") —
// um jogador sólido jogaria um leque bem mais estreito que este.
function estimatePreflopStrength(holeCards) {
  const [a, b] = holeCards;
  const rA = cardRankIndex(a);
  const rB = cardRankIndex(b);

  if (rA === rB) return Math.min(0.55 + (rA / 12) * 0.45, 0.97); // "par é par": piso alto até no 22

  const high = Math.max(rA, rB);
  const low = Math.min(rA, rB);
  let strength = (high / 12) * 0.35 + (low / 12) * 0.15;
  if (a[1] === b[1]) strength += 0.09; // suited empolga mais do que devia
  const gap = high - low;
  if (gap === 1) strength += 0.06;
  else if (gap === 2) strength += 0.03;
  if (high === 12) strength += 0.05; // "tenho um Ás" sempre parece jogável
  return Math.min(strength, 0.95);
}

// 0..1, usando pokersolver a partir do flop em diante (já dá pra formar 5 cartas).
// Amador supervaloriza par no topo/overpair — acha que "fiz um par" já é motivo pra
// segurar a mão até o showdown, então a força aqui é inflada nesses casos.
function estimateStrength(seat, state) {
  const holeCards = seat.holeCards.filter(Boolean);
  if (holeCards.length < 2) return 0.3;
  if (state.communityCards.length === 0) return estimatePreflopStrength(holeCards);

  const solved = Hand.solve([...holeCards, ...state.communityCards]);
  let strength = Math.min(solved.rank / 9, 1);

  if (solved.name === 'Pair' || solved.name === 'Two Pair') {
    const boardRanks = state.communityCards.map(cardRankIndex);
    const topBoardRank = Math.max(...boardRanks);
    const holeRanks = holeCards.map(cardRankIndex);
    const madeTopPairOrBetter = holeRanks.some((r) => r >= topBoardRank);
    const madeOverpair = holeRanks[0] === holeRanks[1] && holeRanks[0] > topBoardRank;
    if (madeTopPairOrBetter || madeOverpair) strength = Math.min(strength + 0.25, 0.85);
  }

  return strength;
}

// Sobe pra um total em BB acima da maior aposta, respeitando o mínimo de raise e o teto
// do stack (all-in). Retorna null se o stack só dá pra pagar all-in (não sobra margem
// pra configurar um raise de verdade).
function computeRaiseTotal(state, me, highest, sizeBB) {
  const bb = state.bigBlind;
  const minTotal = highest + state.minRaise;
  const maxTotal = me.currentBet + me.stack;
  if (minTotal > maxTotal) return null;

  const desired = Math.round(highest + sizeBB * bb);
  return Math.min(Math.max(desired, minTotal), maxTotal);
}

// Amador não é consistente no tamanho da aposta: o "normal" acompanha um pouco a força
// da mão, mas de vez em quando inverte — sub-aposta com mão forte (medo de espantar o
// adversário) ou sobre-aposta com mão média (tentando parecer mais forte do que é).
function pickBetSizeBB(strength) {
  if (Math.random() < 0.3) {
    return strength > 0.75 ? 1 + Math.random() * 1.5 : 6 + Math.random() * 4;
  }
  const base = strength > 0.75 ? 4 : strength > 0.5 ? 2.5 : 2;
  return base + Math.random() * 2;
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
  const isPreflop = state.communityCards.length === 0;
  const bb = state.bigBlind;

  if (toCall <= 0) {
    // Blefe ocasional e desbalanceado: de vez em quando aposta com mão fraca sem
    // nenhuma leitura da mesa por trás — não é um blefe "pensado", é variância de amador.
    const unbalancedBluff = strength < 0.3 && Math.random() < 0.07;
    const wantsToBet = unbalancedBluff || (strength > 0.68 && Math.random() < 0.5);
    const raiseTotal = wantsToBet ? computeRaiseTotal(state, me, highest, pickBetSizeBB(strength)) : null;
    if (raiseTotal !== null) send(highest === 0 ? 'bet' : 'raise', raiseTotal);
    else send('check');
    return;
  }

  const potOdds = toCall / (state.pot + toCall);

  // Leque pré-flop mais largo que o ideal: paga raise pequeno com mão fraca com mais
  // frequência do que um jogador sólido pagaria.
  if (isPreflop && strength < 0.22) {
    const raiseSizeBB = toCall / bb;
    const foldChance = raiseSizeBB <= 3 ? 0.4 : 0.78;
    if (Math.random() < foldChance) {
      send('fold');
      return;
    }
  } else if (!isPreflop && strength < 0.16 && Math.random() < 0.7) {
    send('fold');
    return;
  }

  // Poucos 3-bets/re-raises: mesmo com mão muito forte, prefere só pagar em vez de
  // reabrir a aposta quando já há aposta/raise na sua frente.
  if (strength > 0.8 && Math.random() < 0.2) {
    const raiseTotal = computeRaiseTotal(state, me, highest, pickBetSizeBB(strength));
    if (raiseTotal !== null) {
      send('raise', raiseTotal);
      return;
    }
  }

  // Perto do showdown (river), tende a pagar por curiosidade em vez de foldar pra
  // agressão óbvia — a disciplina de pot odds cai bastante.
  const isRiver = state.phase === 'river';
  const foldMargin = isRiver ? -0.12 : 0.05;
  const foldProbability = isRiver ? 0.25 : 0.5;
  if (strength < potOdds + foldMargin && Math.random() < foldProbability) {
    send('fold');
    return;
  }

  send('call');
}
