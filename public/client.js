const socket = io();

// Id persistido (não é o socket.id, que muda a cada conexão) — permite voltar pro mesmo
// assento depois de um refresh ou queda de conexão (item 8).
function getPlayerId() {
  let id = localStorage.getItem('pokerPlayerId');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
    localStorage.setItem('pokerPlayerId', id);
  }
  return id;
}
const playerId = getPlayerId();

socket.on('connect', () => {
  socket.emit('identify', { playerId });
});

const MAX_SEATS = 9;
const seatsEl = document.getElementById('seats');
const statusBar = document.getElementById('status-bar');
const potEl = document.getElementById('pot');
const communityCardsEl = document.getElementById('community-cards');
const actionPanelEl = document.getElementById('action-panel');
const handResultEl = document.getElementById('hand-result');
const rebuyModalEl = document.getElementById('rebuy-modal');
const rebuyModalBodyEl = document.getElementById('rebuy-modal-body');

let mySeatIndex = null;
let lastHandResult = null;
let lastState = null;
let rebuyOfferAmount = null;

function seatPosition(index) {
  // distribui os assentos ao redor da elipse da mesa
  const angle = (index / MAX_SEATS) * 2 * Math.PI - Math.PI / 2;
  const rx = 46; // % do raio horizontal
  const ry = 44; // % do raio vertical
  const x = 50 + rx * Math.cos(angle);
  const y = 50 + ry * Math.sin(angle);
  return { x, y };
}

const SUIT_SYMBOL = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED_SUITS = new Set(['h', 'd']);

function formatCard(card) {
  // card = 'Rs' (rank+suit), ex: 'Ah', 'Td'
  const rank = card[0] === 'T' ? '10' : card[0];
  const suit = card[1];
  const span = document.createElement('span');
  span.className = 'card' + (RED_SUITS.has(suit) ? ' red' : '');
  span.textContent = rank + (SUIT_SYMBOL[suit] || suit);
  return span;
}

function formatCardBack() {
  const span = document.createElement('span');
  span.className = 'card back';
  span.textContent = '';
  return span;
}

function renderHoleCards(seat) {
  const wrap = document.createElement('div');
  wrap.className = 'hole-cards';
  if (!seat.inHand || seat.folded) return wrap;

  const revealed = seat.holeCards.length > 0 && seat.holeCards[0] !== null;
  if (revealed) {
    seat.holeCards.forEach((card) => wrap.appendChild(formatCard(card)));
  } else {
    seat.holeCards.forEach(() => wrap.appendChild(formatCardBack()));
  }
  return wrap;
}

function formatBB(stack, bigBlind) {
  if (!bigBlind) return '';
  return (stack / bigBlind).toFixed(1) + ' BB';
}

function avatarInitial(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

function render(state) {
  lastState = state;
  seatsEl.innerHTML = '';
  mySeatIndex = null;

  // Mão acabou de terminar (fold geral ou showdown) e o resultado ainda não foi limpo:
  // currentTurnIndex volta a -1 tanto no showdown quanto no encerramento antecipado por fold.
  const handJustEnded = state.status === 'playing' && state.currentTurnIndex === -1;
  const winnerNames = handJustEnded && lastHandResult ? new Set(lastHandResult.winners.map((w) => w.name)) : new Set();

  state.seats.forEach((seat, index) => {
    const { x, y } = seatPosition(index);
    const div = document.createElement('div');
    div.className = 'seat ' + (seat ? 'occupied' : 'empty');
    if (seat && seat.isMe) {
      div.classList.add('me');
      mySeatIndex = index;
    }
    div.style.left = x + '%';
    div.style.top = y + '%';
    if (index === state.currentTurnIndex) div.classList.add('turn');
    if (seat && winnerNames.has(seat.name)) div.classList.add('winner');

    if (seat) {
      const badges = [];
      if (index === state.dealerIndex) badges.push('<span class="badge dealer">D</span>');
      if (index === state.sbIndex) badges.push('<span class="badge sb">SB</span>');
      if (index === state.bbIndex) badges.push('<span class="badge bb">BB</span>');
      if (seat.folded) badges.push('<span class="badge folded">FOLD</span>');
      if (seat.allIn) badges.push('<span class="badge allin">ALL-IN</span>');
      if (seat.connected === false) badges.push('<span class="badge disconnected">RECONECTANDO</span>');
      if (seat.awaitingRebuy) badges.push('<span class="badge rebuy">SEM FICHAS</span>');
      else if (state.status === 'playing' && !seat.inHand) badges.push('<span class="badge waiting">AGUARDANDO PRÓXIMA MÃO</span>');

      div.innerHTML = `
        <div class="badges">${badges.join('')}</div>
        <div class="avatar">${escapeHtml(avatarInitial(seat.name))}</div>
        <div class="name">${escapeHtml(seat.name)}</div>
        <div class="stack">${seat.stack} <span class="stack-bb">(${formatBB(seat.stack, state.bigBlind)})</span></div>
        ${seat.currentBet > 0 ? `<div class="current-bet"><span class="chip"></span>${seat.currentBet}</div>` : ''}
        ${index === state.currentTurnIndex && state.turnDeadline ? '<div id="seat-timer" class="seat-timer"></div>' : ''}
        ${winnerNames.has(seat.name) ? '<div class="win-tag">WIN</div>' : ''}
      `;
      div.appendChild(renderHoleCards(seat));
    } else {
      div.innerHTML = `<div class="empty-label">Assento ${index + 1}</div><div class="empty-label">(vazio)</div>`;
      div.addEventListener('click', () => trySit(index));
    }

    seatsEl.appendChild(div);
  });

  communityCardsEl.innerHTML = '';
  state.communityCards.forEach((card) => communityCardsEl.appendChild(formatCard(card)));

  if (handJustEnded && lastHandResult) {
    const summary = lastHandResult.winners
      .map((w) => `${w.name} +${w.amountWon}` + (w.handDescr ? ` — ${w.handDescr}` : ' (sem showdown)'))
      .join(' | ');
    handResultEl.innerHTML = `<div class="win-title">WIN</div><div class="win-summary">${escapeHtml(summary)}</div>`;
    handResultEl.style.display = 'block';
  } else {
    handResultEl.style.display = 'none';
    if (!handJustEnded) lastHandResult = null;
  }

  const totalPot = state.pot + state.sidePots.reduce((acc, p) => acc + p.amount, 0);
  potEl.textContent = 'Total Pot: ' + totalPot;
  if (state.sidePots.length > 1) {
    const detail = document.createElement('div');
    detail.className = 'side-pot-detail';
    detail.textContent = state.sidePots.map((p, i) => (i === 0 ? 'principal ' : `side ${i} `) + p.amount).join(' · ');
    potEl.appendChild(detail);
  }

  if (state.status === 'standby') {
    statusBar.textContent = 'Aguardando mais jogadores... (mínimo 2 para começar)';
  } else {
    statusBar.textContent = 'Mão em andamento — fase: ' + state.phase;
  }

  renderActionPanel(state);
  renderRebuyModal(state);
}

// Modal de rebuy (não window.confirm): só aparece pro próprio jogador cujo assento está
// aguardando rebuy. Os demais só veem o badge "SEM FICHAS" nesse assento (renderizado acima).
function renderRebuyModal(state) {
  const mySeat = mySeatIndex !== null ? state.seats[mySeatIndex] : null;
  if (mySeat && mySeat.awaitingRebuy) {
    const amount = rebuyOfferAmount !== null ? rebuyOfferAmount : 'mais';
    rebuyModalBodyEl.textContent = `Adicionar ${amount} fichas e continuar jogando, ou levantar da mesa?`;
    rebuyModalEl.style.display = 'flex';
  } else {
    rebuyModalEl.style.display = 'none';
  }
}

document.getElementById('rebuy-accept').onclick = () => {
  socket.emit('rebuy-response', { accept: true });
};
document.getElementById('rebuy-decline').onclick = () => {
  socket.emit('rebuy-response', { accept: false });
};

function isMyTurn(state) {
  return mySeatIndex !== null && state.currentTurnIndex === mySeatIndex;
}

function highestCurrentBet(state) {
  return Math.max(0, ...state.seats.filter(Boolean).map((s) => s.currentBet));
}

function renderActionPanel(state) {
  if (!isMyTurn(state)) {
    actionPanelEl.style.display = 'none';
    actionPanelEl.innerHTML = '';
    return;
  }

  const me = state.seats[mySeatIndex];
  const highest = highestCurrentBet(state);
  const toCall = highest - me.currentBet;
  const bb = state.bigBlind;
  const minTotal = highest + state.minRaise;
  const maxTotal = me.currentBet + me.stack;
  const canRaise = maxTotal > highest;

  actionPanelEl.style.display = 'flex';
  actionPanelEl.innerHTML = `
    <span id="action-timer" class="action-timer"></span>
    <button id="act-fold">Fold</button>
    <button id="act-call">${toCall > 0 ? 'Call ' + toCall : 'Check'}</button>
    ${canRaise ? `
      <input id="act-amount" type="number" min="${minTotal}" max="${maxTotal}" step="${bb / 2}" value="${Math.min(minTotal, maxTotal)}" />
      <button class="act-quick" data-total="${Math.min(highest + bb / 2, maxTotal)}">+0.5 BB</button>
      <button class="act-quick" data-total="${Math.min(highest + bb, maxTotal)}">+1 BB</button>
      <button class="act-quick" data-total="${Math.min(highest + 2 * bb, maxTotal)}">+2 BB</button>
      <button id="act-pot" class="act-quick">Pot</button>
      <button id="act-allin" class="act-quick">All-in</button>
      <button id="act-raise">${highest === 0 ? 'Bet' : 'Raise'}</button>
    ` : ''}
  `;

  document.getElementById('act-fold').onclick = () => sendAction('fold');
  document.getElementById('act-call').onclick = () => sendAction(toCall > 0 ? 'call' : 'check');

  if (canRaise) {
    const amountInput = document.getElementById('act-amount');
    document.querySelectorAll('.act-quick[data-total]').forEach((btn) => {
      btn.onclick = () => {
        amountInput.value = btn.dataset.total;
      };
    });
    document.getElementById('act-pot').onclick = () => {
      const potSizedTotal = Math.min(highest + (state.pot + toCall), maxTotal);
      amountInput.value = potSizedTotal;
    };
    document.getElementById('act-allin').onclick = () => {
      amountInput.value = maxTotal;
    };
    document.getElementById('act-raise').onclick = () => {
      sendAction(highest === 0 ? 'bet' : 'raise', Number(amountInput.value));
    };
  }
}

function sendAction(type, amount) {
  socket.emit('action', { type, amount });
}

function trySit(index) {
  if (mySeatIndex !== null) return;
  const name = window.prompt('Digite seu nome:', 'Jogador');
  if (name === null) return;
  socket.emit('sit', { seatIndex: index, name, playerId });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function updateTurnTimers() {
  if (!lastState || !lastState.turnDeadline) return;
  const secondsLeft = Math.max(0, Math.ceil((lastState.turnDeadline - Date.now()) / 1000));

  const seatTimerEl = document.getElementById('seat-timer');
  if (seatTimerEl) seatTimerEl.textContent = secondsLeft + 's';

  const actionTimerEl = document.getElementById('action-timer');
  if (actionTimerEl) actionTimerEl.textContent = secondsLeft + 's';
}

setInterval(updateTurnTimers, 250);

socket.on('state', render);
socket.on('hand-result', (result) => {
  lastHandResult = result;
});
socket.on('rebuy-offer', ({ defaultBuyin }) => {
  rebuyOfferAmount = defaultBuyin;
});
