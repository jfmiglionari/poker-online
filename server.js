const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createDeck, shuffle } = require('./game/deck');
const { Hand } = require('pokersolver');

const PORT = 3000;
const MAX_SEATS = 9;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const DEFAULT_BUYIN_BB = 50;
const DEFAULT_BUYIN = DEFAULT_BUYIN_BB * BIG_BLIND; // 1000 fichas
const HAND_START_DELAY_MS = 3000;
const SHOWDOWN_DISPLAY_MS = 4000;
const FOLD_WIN_DISPLAY_MS = 2000;
const TURN_TIMEOUT_MS = Number(process.env.TURN_TIMEOUT_MS) || 20000; // env só pra facilitar teste automatizado
const DISCONNECT_GRACE_MS = Number(process.env.DISCONNECT_GRACE_MS) || 60000; // idem

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Estado autoritativo da mesa. Nunca enviar table.deck ao cliente.
const table = {
  status: 'standby', // 'standby' | 'playing'
  seats: new Array(MAX_SEATS).fill(null),
  dealerIndex: -1,
  sbIndex: -1,
  bbIndex: -1,
  phase: null, // 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'
  communityCards: [],
  pot: 0,
  sidePots: [],
  currentTurnIndex: -1,
  turnDeadline: null, // timestamp (ms) em que o timer de turno estoura, ou null se não há vez em aberto
  minRaise: BIG_BLIND,
  deck: [],
};

let handStartTimer = null;
let turnTimer = null;

function seatedCount() {
  return table.seats.filter(Boolean).length;
}

// Primeiro assento em sentido horário a partir de fromIndex (exclusive) que satisfaz predicate.
// Funciona com fromIndex = -1.
function findSeatIndex(fromIndex, predicate) {
  for (let i = 1; i <= MAX_SEATS; i++) {
    const idx = (fromIndex + i + MAX_SEATS) % MAX_SEATS;
    if (table.seats[idx] && predicate(table.seats[idx])) return idx;
  }
  return -1;
}

function nextSeatedIndex(fromIndex) {
  return findSeatIndex(fromIndex, () => true);
}

// Próximo jogador que ainda pode agir nesta mão (não deu fold, não está all-in).
function nextActiveIndex(fromIndex) {
  return findSeatIndex(fromIndex, (seat) => seat.inHand && !seat.folded && !seat.allIn);
}

// Lista de índices ocupados em ordem, começando em startIndex.
function seatOrderFrom(startIndex) {
  const order = [];
  let idx = startIndex;
  const count = seatedCount();
  for (let i = 0; i < count; i++) {
    order.push(idx);
    idx = nextSeatedIndex(idx);
  }
  return order;
}

function postBlind(seatIndex, amount) {
  const seat = table.seats[seatIndex];
  const actual = Math.min(amount, seat.stack);
  seat.stack -= actual;
  seat.currentBet += actual;
  seat.totalContributed += actual;
  table.pot += actual;
  if (seat.stack === 0) seat.allIn = true;
}

function clearTurnTimer() {
  if (turnTimer) {
    clearTimeout(turnTimer);
    turnTimer = null;
  }
  table.turnDeadline = null;
}

// Chamar sempre que table.currentTurnIndex passa a apontar pra um jogador de verdade.
// Cancela qualquer timer pendente da vez anterior e agenda o timeout desta (item 7).
function startTurnTimer() {
  clearTurnTimer();
  if (table.currentTurnIndex === -1) return;
  table.turnDeadline = Date.now() + TURN_TIMEOUT_MS;
  const seatIndex = table.currentTurnIndex;
  turnTimer = setTimeout(() => handleTurnTimeout(seatIndex), TURN_TIMEOUT_MS);
  io.emit('your-turn', { seatIndex, deadline: table.turnDeadline });
}

// Estourou o tempo: ação automática = check se possível, senão fold.
function handleTurnTimeout(seatIndex) {
  turnTimer = null;
  if (table.status !== 'playing' || table.currentTurnIndex !== seatIndex) return; // já não é mais a vez dele
  const seat = table.seats[seatIndex];
  if (!seat) return;

  const toCall = currentHighestBet() - seat.currentBet;
  processPlayerAction(seatIndex, toCall === 0 ? 'check' : 'fold');
}

function startHand() {
  handStartTimer = null;

  if (seatedCount() < 2) {
    table.status = 'standby';
    return;
  }

  table.status = 'playing';
  table.dealerIndex = nextSeatedIndex(table.dealerIndex);

  for (const seat of table.seats) {
    if (!seat) continue;
    seat.inHand = true;
    seat.folded = false;
    seat.allIn = false;
    seat.currentBet = 0;
    seat.holeCards = [];
    seat.hasActedThisRound = false;
    seat.revealAtShowdown = false;
    seat.totalContributed = 0; // pro cálculo de side pots no showdown
  }

  const isHeadsUp = seatedCount() === 2;
  if (isHeadsUp) {
    // Heads-up: dealer é o small blind e age primeiro no pré-flop.
    table.sbIndex = table.dealerIndex;
    table.bbIndex = nextSeatedIndex(table.sbIndex);
  } else {
    table.sbIndex = nextSeatedIndex(table.dealerIndex);
    table.bbIndex = nextSeatedIndex(table.sbIndex);
  }
  table.pot = 0;

  postBlind(table.sbIndex, SMALL_BLIND);
  postBlind(table.bbIndex, BIG_BLIND);
  table.minRaise = BIG_BLIND;

  table.deck = shuffle(createDeck());
  const order = seatOrderFrom(table.sbIndex);
  for (let round = 0; round < 2; round++) {
    for (const idx of order) {
      table.seats[idx].holeCards.push(table.deck.pop());
    }
  }

  table.communityCards = [];
  table.phase = 'preflop';
  table.currentTurnIndex = isHeadsUp ? table.dealerIndex : nextSeatedIndex(table.bbIndex);
  startTurnTimer();

  broadcastState();
}

function scheduleHandStart() {
  if (table.status !== 'standby') return;
  if (seatedCount() < 2) return;
  if (handStartTimer) return;
  handStartTimer = setTimeout(startHand, HAND_START_DELAY_MS);
}

function contendersInHand() {
  return table.seats.filter((s) => s && s.inHand && !s.folded);
}

function currentHighestBet() {
  let max = 0;
  for (const seat of contendersInHand()) max = Math.max(max, seat.currentBet);
  return max;
}

// Termina quando todo mundo que ainda pode agir já agiu nesta rodada e igualou a maior aposta
// (jogadores all-in não precisam agir de novo).
function isBettingRoundComplete() {
  const contenders = contendersInHand();
  if (contenders.length <= 1) return true;
  const highest = currentHighestBet();
  return contenders.every((seat) => seat.allIn || (seat.hasActedThisRound && seat.currentBet === highest));
}

function dealCommunityCards(count) {
  for (let i = 0; i < count; i++) {
    table.communityCards.push(table.deck.pop());
  }
}

// Reinicia os marcadores de aposta da rodada (o pote acumulado não muda).
function startNewBettingRound() {
  for (const seat of table.seats) {
    if (!seat || !seat.inHand || seat.folded) continue;
    seat.currentBet = 0;
    seat.hasActedThisRound = false;
  }
  table.minRaise = BIG_BLIND;
}

// Avança preflop -> flop -> turn -> river -> showdown, revelando cartas e abrindo
// a próxima rodada de apostas (começando pelo primeiro jogador ativo à esquerda do dealer).
// Se restar no máximo 1 jogador que ainda pode apostar (resto all-in), revela o resto
// automaticamente sem rodada de apostas, até o showdown.
function advanceToNextPhase() {
  const contenders = contendersInHand();
  if (contenders.length <= 1) return;

  if (table.phase === 'preflop') {
    dealCommunityCards(3);
    table.phase = 'flop';
  } else if (table.phase === 'flop') {
    dealCommunityCards(1);
    table.phase = 'turn';
  } else if (table.phase === 'turn') {
    dealCommunityCards(1);
    table.phase = 'river';
  } else if (table.phase === 'river') {
    table.phase = 'showdown';
    table.currentTurnIndex = -1;
    clearTurnTimer();
    resolveShowdown();
    return;
  }

  startNewBettingRound();

  const activePlayers = contenders.filter((s) => !s.allIn);
  if (activePlayers.length <= 1) {
    advanceToNextPhase();
    return;
  }

  table.currentTurnIndex = nextActiveIndex(table.dealerIndex);
  startTurnTimer();
}

function endHand() {
  handStartTimer = null;
  clearTurnTimer();
  table.phase = null;
  table.communityCards = [];
  table.currentTurnIndex = -1;
  table.sidePots = [];
  table.status = 'standby';
  for (let idx = 0; idx < table.seats.length; idx++) {
    const seat = table.seats[idx];
    if (!seat) continue;
    // Graça de desconexão já esgotada durante a mão que acabou de terminar: libera agora.
    if (seat.pendingRemoval && !seat.connected) {
      clearSeat(idx);
      continue;
    }
    seat.inHand = false;
    seat.folded = false;
    seat.allIn = false;
    seat.currentBet = 0;
    seat.holeCards = [];
    seat.hasActedThisRound = false;
    seat.revealAtShowdown = false;
    seat.totalContributed = 0;
  }
  scheduleHandStart();
}

// Divide `amount` igualmente entre winnerSeats; a sobra (valor não divisível) vai
// pro primeiro jogador à esquerda do dealer entre os vencedores.
function distributeAmount(amount, winnerSeats) {
  const share = Math.floor(amount / winnerSeats.length);
  const remainder = amount - share * winnerSeats.length;

  for (const seat of winnerSeats) seat.stack += share;

  if (remainder > 0) {
    const order = seatOrderFrom(nextSeatedIndex(table.dealerIndex));
    const firstWinnerIdx = order.find((idx) => winnerSeats.includes(table.seats[idx]));
    if (firstWinnerIdx !== undefined) table.seats[firstWinnerIdx].stack += remainder;
  }
}

// Monta as camadas de pote (principal + side pots) a partir do quanto cada jogador
// contribuiu na mão inteira. Jogadores que deram fold continuam contando pra formar o
// valor de cada camada (a ficha deles já está lá), mas nunca entram em `eligibleSeats`
// (não podem ganhar nada). All-ins com stacks diferentes geram uma camada extra: quem
// contribuiu mais do que o resto conseguiu igualar recebe essa sobra de volta sozinho,
// já que ninguém mais disputou aquele valor.
function buildPots() {
  const participants = table.seats
    .filter((s) => s && s.inHand && s.totalContributed > 0)
    .map((s) => ({ seat: s, remaining: s.totalContributed }));

  const pots = [];
  while (participants.some((p) => p.remaining > 0)) {
    const withChips = participants.filter((p) => p.remaining > 0);
    const layerAmount = Math.min(...withChips.map((p) => p.remaining));
    const potAmount = layerAmount * withChips.length;
    const eligibleSeats = withChips.map((p) => p.seat).filter((s) => !s.folded);
    pots.push({ amount: potAmount, eligibleSeats });
    for (const p of withChips) p.remaining -= layerAmount;
  }
  return pots;
}

// Mostra o estado de "mão encerrada" (currentTurnIndex=-1, resultado disponível) por um
// tempo antes de limpar a mesa e agendar a próxima mão.
function finishHandAfterDelay(delayMs) {
  table.currentTurnIndex = -1;
  clearTurnTimer();
  broadcastState();
  setTimeout(() => {
    endHand();
    broadcastState();
  }, delayMs);
}

// Encerramento antecipado (item 5): todos menos um jogador deram fold, em qualquer fase da
// mão. O vencedor leva o pote inteiro (incluindo side pots) imediatamente, sem revelar
// cartas e sem chegar ao showdown — não há mais ninguém pra disputar nenhuma camada.
function awardPotToSingleWinner(winnerSeat) {
  const amountWon = table.pot;
  distributeAmount(amountWon, [winnerSeat]);
  table.pot = 0;
  io.emit('hand-result', {
    reveals: [],
    winners: [{ name: winnerSeat.name, amountWon, handDescr: null }],
  });
  finishHandAfterDelay(FOLD_WIN_DISPLAY_MS);
}

// Showdown: usa pokersolver pra achar a melhor mão de 5 cartas de cada jogador ainda na mão
// (2 hole cards + 5 comunitárias). Resolve pote principal e side pots separadamente — um
// jogador all-in por menos só concorre às camadas que ele efetivamente contribuiu.
function resolveShowdown() {
  const contenders = contendersInHand();
  if (contenders.length === 0) return;
  if (contenders.length === 1) {
    awardPotToSingleWinner(contenders[0]);
    return;
  }

  const solvedBySeat = new Map(
    contenders.map((seat) => [seat, Hand.solve([...seat.holeCards, ...table.communityCards])])
  );

  const pots = buildPots();
  const winnerResults = [];

  for (const pot of pots) {
    const hands = pot.eligibleSeats.map((s) => solvedBySeat.get(s));
    const winningHands = Hand.winners(hands);
    const winners = pot.eligibleSeats.filter((s) => winningHands.includes(solvedBySeat.get(s)));
    distributeAmount(pot.amount, winners);
    const share = Math.floor(pot.amount / winners.length);
    for (const seat of winners) {
      winnerResults.push({ name: seat.name, amountWon: share, handDescr: solvedBySeat.get(seat).descr });
    }
  }

  for (const seat of contenders) seat.revealAtShowdown = true;
  table.sidePots = pots.map((p) => ({ amount: p.amount, eligiblePlayerIds: p.eligibleSeats.map((s) => s.socketId) }));
  table.pot = 0;

  io.emit('hand-result', {
    reveals: contenders.map((seat) => ({
      name: seat.name,
      holeCards: seat.holeCards,
      handDescr: solvedBySeat.get(seat).descr,
    })),
    winners: winnerResults,
  });

  finishHandAfterDelay(SHOWDOWN_DISPLAY_MS);
}

function applyAction(seatIndex, type, amount) {
  const seat = table.seats[seatIndex];
  const highest = currentHighestBet();
  const toCall = highest - seat.currentBet;

  switch (type) {
    case 'fold': {
      seat.folded = true;
      seat.hasActedThisRound = true;
      return true;
    }
    case 'check': {
      if (toCall !== 0) return false;
      seat.hasActedThisRound = true;
      return true;
    }
    case 'call': {
      if (toCall <= 0) return false;
      const pay = Math.min(toCall, seat.stack);
      seat.stack -= pay;
      seat.currentBet += pay;
      seat.totalContributed += pay;
      table.pot += pay;
      if (seat.stack === 0) seat.allIn = true;
      seat.hasActedThisRound = true;
      return true;
    }
    case 'bet':
    case 'raise': {
      const targetTotal = Number(amount);
      if (!Number.isFinite(targetTotal)) return false;

      const maxTotal = seat.currentBet + seat.stack; // teto: all-in
      const minTotal = highest + table.minRaise;
      const isAllIn = targetTotal >= maxTotal;
      const finalTotal = isAllIn ? maxTotal : targetTotal;

      if (finalTotal <= highest) return false; // não é um raise válido
      if (!isAllIn && finalTotal < minTotal) return false; // abaixo do mínimo (all-in curto é exceção)

      const raiseIncrement = finalTotal - highest;
      const pay = finalTotal - seat.currentBet;
      seat.stack -= pay;
      seat.currentBet = finalTotal;
      seat.totalContributed += pay;
      table.pot += pay;
      if (seat.stack === 0) seat.allIn = true;

      // Reabre a ação pros outros jogadores ainda na mão.
      for (const s of table.seats) {
        if (s && s.inHand && !s.folded && s !== seat) s.hasActedThisRound = false;
      }
      seat.hasActedThisRound = true;
      if (raiseIncrement >= table.minRaise) table.minRaise = raiseIncrement;
      return true;
    }
    default:
      return false;
  }
}

// Aplica a ação de idx e avança o estado da mesa (turno seguinte, próxima fase, fim de mão
// por fold geral, etc). Usado tanto pelo evento 'action' quanto pelo timeout do item 7 —
// o timeout dispara exatamente o mesmo caminho de código de uma ação manual.
function processPlayerAction(idx, type, amount) {
  const applied = applyAction(idx, type, amount);
  if (!applied) return;

  const remaining = contendersInHand();
  if (remaining.length === 1) {
    awardPotToSingleWinner(remaining[0]);
    return;
  }

  if (isBettingRoundComplete()) {
    advanceToNextPhase();
  } else {
    table.currentTurnIndex = nextActiveIndex(idx);
    startTurnTimer();
  }

  broadcastState();
}

function publicSeat(seat, forSocketId) {
  if (!seat) return null;
  const isMe = seat.socketId === forSocketId;
  const showCards = isMe || seat.revealAtShowdown;
  return {
    name: seat.name,
    stack: seat.stack,
    inHand: seat.inHand,
    folded: seat.folded,
    allIn: seat.allIn,
    currentBet: seat.currentBet,
    isMe,
    connected: seat.connected,
    holeCards: showCards ? seat.holeCards : seat.holeCards.map(() => null),
  };
}

function buildStateForSocket(socketId) {
  return {
    status: table.status,
    seats: table.seats.map((s) => publicSeat(s, socketId)),
    dealerIndex: table.dealerIndex,
    sbIndex: table.sbIndex,
    bbIndex: table.bbIndex,
    phase: table.phase,
    communityCards: table.communityCards,
    pot: table.pot,
    sidePots: table.sidePots,
    currentTurnIndex: table.currentTurnIndex,
    turnDeadline: table.turnDeadline,
    minRaise: table.minRaise,
    bigBlind: BIG_BLIND,
  };
}

function broadcastState() {
  for (const [socketId, socket] of io.sockets.sockets) {
    socket.emit('state', buildStateForSocket(socketId));
  }
}

// Libera o assento de verdade (só deve ser chamado entre mãos).
function clearSeat(idx) {
  const seat = table.seats[idx];
  if (seat && seat.disconnectGraceTimer) clearTimeout(seat.disconnectGraceTimer);
  table.seats[idx] = null;
  if (seatedCount() < 2) table.status = 'standby';
}

// Levantar da mesa (voluntário, "leave"): só entre mãos.
function freeSeat(socketId) {
  const idx = table.seats.findIndex((s) => s && s.socketId === socketId);
  if (idx === -1) return;
  if (table.status === 'playing' && table.seats[idx].inHand) {
    // Mão em andamento: não deixa levantar agora.
    return;
  }
  clearSeat(idx);
  broadcastState();
}

// Passou a graça de 60s sem reconectar (item 8). Se a mesa está entre mãos, libera o
// assento na hora; se ainda tem mão rolando, só marca pra liberar assim que ela acabar
// (nunca tira alguém da mesa no meio de uma mão em andamento).
function handleDisconnectGraceExpired(idx) {
  const seat = table.seats[idx];
  if (!seat || seat.connected) return; // já reconectou nesse meio tempo
  seat.disconnectGraceTimer = null;
  if (table.status === 'standby') {
    clearSeat(idx);
    broadcastState();
  } else {
    seat.pendingRemoval = true;
  }
}

io.on('connection', (socket) => {
  socket.emit('state', buildStateForSocket(socket.id));

  // Reconexão (item 8): o cliente manda o id persistido (localStorage) assim que conecta.
  // Se ele já está sentado (playerId bate com algum assento), religa esse assento no socket
  // novo e cancela a graça de desconexão, se houver uma pendente.
  socket.on('identify', ({ playerId }) => {
    if (!playerId) return;
    const idx = table.seats.findIndex((s) => s && s.playerId === playerId);
    if (idx === -1) return;

    const seat = table.seats[idx];
    if (seat.disconnectGraceTimer) {
      clearTimeout(seat.disconnectGraceTimer);
      seat.disconnectGraceTimer = null;
    }
    seat.socketId = socket.id;
    seat.connected = true;
    seat.pendingRemoval = false;
    socket.emit('state', buildStateForSocket(socket.id));
    broadcastState();
  });

  socket.on('sit', ({ seatIndex, name, playerId }) => {
    if (seatIndex < 0 || seatIndex >= MAX_SEATS) return;
    if (!playerId) return; // exige um id persistido (localStorage) pra permitir reconexão depois
    if (table.seats[seatIndex]) return; // assento ocupado
    if (table.seats.some((s) => s && s.playerId === playerId)) return; // esse jogador já está sentado em outro lugar

    const cleanName = (name || 'Jogador').toString().slice(0, 20);
    table.seats[seatIndex] = {
      socketId: socket.id,
      playerId,
      name: cleanName,
      stack: DEFAULT_BUYIN,
      holeCards: [],
      inHand: false,
      folded: false,
      allIn: false,
      currentBet: 0,
      hasActedThisRound: false,
      revealAtShowdown: false,
      totalContributed: 0,
      connected: true,
      disconnectGraceTimer: null,
      pendingRemoval: false,
    };
    broadcastState();
    scheduleHandStart();
  });

  socket.on('action', ({ type, amount }) => {
    const idx = table.seats.findIndex((s) => s && s.socketId === socket.id);
    if (idx === -1) return;
    if (table.status !== 'playing') return;
    if (idx !== table.currentTurnIndex) return;

    const seat = table.seats[idx];
    if (!seat.inHand || seat.folded || seat.allIn) return;

    processPlayerAction(idx, type, amount);
  });

  socket.on('leave', () => {
    freeSeat(socket.id);
  });

  socket.on('disconnect', () => {
    const idx = table.seats.findIndex((s) => s && s.socketId === socket.id);
    if (idx === -1) return;

    // Nunca libera o assento na hora: dá uma graça de DISCONNECT_GRACE_MS pra reconectar
    // (pode ser só uma queda de rede/refresh). Se estiver no meio de uma mão e chegar a vez
    // dele, o timer de turno (item 7) já cuida do fold/check automático sozinho enquanto
    // isso — handleDisconnectGraceExpired decide, quando a graça acabar, se libera na hora
    // (mesa em standby) ou só marca pra liberar assim que a mão atual terminar.
    const seat = table.seats[idx];
    seat.connected = false;
    seat.disconnectGraceTimer = setTimeout(() => handleDisconnectGraceExpired(idx), DISCONNECT_GRACE_MS);
    broadcastState();
  });
});

server.listen(PORT, () => {
  console.log(`Poker table rodando em http://localhost:${PORT}`);
});
