// Bot de teste: conecta como um jogador de verdade via Socket.io (senta, recebe
// 'state'/'your-turn' e manda 'action' igual o client.js faria), só que decidindo
// sozinho. Serve pra ter alguém pra jogar contra durante o desenvolvimento.
//
// Uso: node bot/bot.js ["Nome do bot"] [seatIndex]
//   BOT_SERVER_URL=http://localhost:3000 node bot/bot.js

require('dotenv').config();
const { io } = require('socket.io-client');
const { Hand } = require('pokersolver');
const Anthropic = require('@anthropic-ai/sdk');
const { z } = require('zod');
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');

const SERVER_URL = process.env.BOT_SERVER_URL || 'http://localhost:3000';
const BOT_NAME = process.argv[2] || 'Bot';
const REQUESTED_SEAT = process.argv[3] !== undefined ? Number(process.argv[3]) : null;
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

// Modo IA (opt-in): BOT_AI=1 node bot/bot.js "Bot IA" — decide a ação chamando a API da
// Anthropic em vez da heurística. Sem BOT_AI ou sem ANTHROPIC_API_KEY, o bot roda 100%
// heurístico como antes.
const AI_MODE_REQUESTED = process.env.BOT_AI === '1';
const AI_MODEL = 'claude-haiku-4-5';
const AI_TIMEOUT_MS = 6000; // bem abaixo do TURN_TIMEOUT_MS (20s) do servidor
const anthropic = AI_MODE_REQUESTED && process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
if (AI_MODE_REQUESTED && !anthropic) {
  console.warn(`[${BOT_NAME}] BOT_AI=1 mas ANTHROPIC_API_KEY não está definido — rodando no modo heurístico.`);
}

const ActionDecisionSchema = z.object({
  action: z.enum(['fold', 'check', 'call', 'bet', 'raise']),
  amount: z.number().optional(),
  reasoning: z.string(),
});

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

async function actIfStillMyTurn(idx) {
  const state = latestState;
  if (!state) return;
  if (state.status !== 'playing' || state.currentTurnIndex !== idx) return; // já não é mais a vez dele

  if (anthropic) {
    const decidedByAI = await decideActionWithAI(state, idx);
    if (decidedByAI) return;
  }

  // Sem IA, ou a IA falhou/demorou/sugeriu algo inválido: cai pra heurística — o bot
  // nunca fica sem agir.
  act(latestState, idx);
}

// Monta uma descrição compacta do estado e pede a decisão pra API da Anthropic, validando
// a resposta contra as ações legais antes de mandar pro servidor. Retorna true se mandou
// uma ação (a chamou), false se deve cair pra heurística (falha, timeout ou ação inválida).
async function decideActionWithAI(state, idx) {
  const me = state.seats[idx];
  const highest = Math.max(0, ...state.seats.filter(Boolean).map((s) => s.currentBet));
  const toCall = highest - me.currentBet;
  const minTotal = highest + state.minRaise;
  const maxTotal = me.currentBet + me.stack;
  const canCheck = toCall <= 0;
  const canRaise = maxTotal > highest;

  const situacao = {
    fase: state.phase,
    minhasCartas: me.holeCards.filter(Boolean),
    cartasComunitarias: state.communityCards,
    poteTotal: state.pot,
    meuStack: me.stack,
    quantoFaltaPagar: toCall,
    bigBlind: state.bigBlind,
    totalMinimoParaBetOuRaise: canRaise ? minTotal : null,
    totalMaximoParaBetOuRaise: canRaise ? maxTotal : null,
    acoesLegaisAgora: ['fold', canCheck ? 'check' : 'call', ...(canRaise ? [highest === 0 ? 'bet' : 'raise'] : [])],
  };

  try {
    const response = await anthropic.messages.parse(
      {
        model: AI_MODEL,
        max_tokens: 512,
        system:
          "Você está jogando uma mão de Texas Hold'em No-Limit contra um oponente. " +
          'Responda só com a decisão pra vez atual, descrita em "situacao". ' +
          'Quando a ação for "bet" ou "raise", "amount" é o TOTAL da sua aposta depois da ' +
          'ação (não é o incremento) e tem que estar entre totalMinimoParaBetOuRaise e ' +
          'totalMaximoParaBetOuRaise. Nunca escolha uma ação fora de acoesLegaisAgora.',
        messages: [{ role: 'user', content: JSON.stringify(situacao) }],
        output_config: { format: zodOutputFormat(ActionDecisionSchema) },
      },
      { timeout: AI_TIMEOUT_MS }
    );

    const decision = response.parsed_output;
    if (!decision || !isLegalDecision(decision, { canCheck, canRaise, minTotal, maxTotal, highest })) {
      console.warn(`[${BOT_NAME}] IA sugeriu ação inválida ou vazia, caindo pra heurística.`, decision);
      return false;
    }

    console.log(`[${BOT_NAME}] (IA) ${decision.reasoning}`);
    send(decision.action, decision.amount);
    return true;
  } catch (err) {
    console.warn(`[${BOT_NAME}] falha ao consultar a IA (${err.message}), caindo pra heurística.`);
    return false;
  }
}

function isLegalDecision(decision, { canCheck, canRaise, minTotal, maxTotal, highest }) {
  if (decision.action === 'check' && !canCheck) return false;
  if (decision.action === 'call' && canCheck) return false; // nada a pagar — teria que ser 'check'
  if (decision.action === 'bet' || decision.action === 'raise') {
    if (!canRaise) return false;
    if (typeof decision.amount !== 'number') return false;
    if (decision.amount <= highest) return false;
    if (decision.amount < minTotal && decision.amount < maxTotal) return false; // abaixo do mínimo e não é all-in
    if (decision.amount > maxTotal) return false;
  }
  return true;
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
