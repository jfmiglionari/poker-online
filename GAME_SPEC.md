# Especificação — Poker Online (Texas Hold'em No-Limit, mesa única)

## Visão geral

Jogo de poker no navegador, Texas Hold'em No-Limit, com **uma única mesa** de até
9 lugares, fichas virtuais (sem dinheiro real), rodando em Node.js + Express +
Socket.io no backend e HTML/CSS/JS puro no frontend. Objetivo é aprendizado:
o backend é a fonte da verdade de todo o estado do jogo (o cliente nunca decide
nada sozinho, só envia intenções e renderiza o que o servidor manda).

Já existe (não refazer): mesa oval com 9 assentos clicáveis, status
standby/ready conforme número de jogadores sentados (`server.js`,
`public/index.html`, `public/style.css`, `public/client.js`).

## Escopo do MVP — o que ENTRA

- Uma mesa, até 9 jogadores.
- Buy-in fixo, definido **em big blinds**: todo jogador que senta escolhe
  entrar com um valor padrão de **50 BB** (constante `DEFAULT_BUYIN_BB`,
  ex: 50 BB × 20 fichas/BB = 1000 fichas). A UI pode mostrar os stacks tanto
  em fichas quanto em "BB" (ex: "50.0 BB"), como fazem apps de poker reais.
- Blinds fixos, **não sobem com o tempo**: small blind = 10, big blind = 20
  (constantes `SMALL_BLIND` / `BIG_BLIND`).
- **Stack persiste entre mãos** — nunca reseta automaticamente. Fichas
  ganhas ficam, fichas perdidas saem, e assim segue mão após mão.
- **Rebuy (recompra) entre mãos**: quando o stack do jogador chega a 0 ao
  fim de uma mão (em `endHand()`), o servidor marca o assento com
  `awaitingRebuy: true` e manda um evento **privado**, só pro socket
  daquele jogador (`socket.emit`/`io.to(socketId).emit('rebuy-offer', ...)`,
  nunca `io.emit`), oferecendo rebuy. Os demais jogadores nunca recebem
  esse popup — eles só veem esse assento com um badge público (ex: "SEM
  FICHAS"), já que `awaitingRebuy` faz parte do estado público da mesa.
  O cliente responde com `rebuy-response` (`{accept: true|false}`):
  - **Aceitar**: credita `DEFAULT_BUYIN` de novo no stack e limpa
    `awaitingRebuy` — o jogador volta a ser contado como ativo a partir da
    próxima mão, igual quem acabou de sentar.
  - **Recusar**: libera o assento (mesma lógica de levantar da mesa/
    `clearSeat`).
  Assentos com `awaitingRebuy: true` ficam de fora da contagem de
  "jogadores ativos" usada por `startHand()`/`scheduleHandStart()` para
  decidir se uma mão pode começar — se isso deixar menos de 2 jogadores
  ativos na mesa, ela permanece (ou volta) em `standby` até a decisão do
  rebuy ser resolvida (aceitar ou recusar), nunca tentando iniciar mão com
  só 1 jogador ativo. Nunca é permitido adicionar fichas no meio de uma
  rodada de apostas — a oferta de rebuy só existe entre mãos.
- Botão de dealer rotaciona a cada mão entre os jogadores sentados.
- Texas Hold'em completo: pré-flop, flop, turn, river, showdown.
- Ações: fold, check, call, bet, raise, all-in.
- Raise incremental: o jogador escolhe o valor do raise em incrementos de
  meio big blind (0.5 BB) pra cima do mínimo permitido, via input numérico ou
  botões de atalho (ex: "pot", "1/2 pot", "all-in").
- Side pots quando há all-in com stacks diferentes.
- Avaliação de mão e desempate (usar biblioteca pronta, ver seção
  "Avaliação de mãos" — não reinventar isso na mão).
- Timer de turno (ex: 20s) — se estourar, ação automática = check se possível,
  senão fold.
- Reconexão: se o jogador atualizar a página, ele volta pro mesmo assento
  (usar um id persistido em `localStorage`, não só o `socket.id`, que muda a
  cada conexão).
- Jogador pode "levantar da mesa" (stand up) — só entre mãos, nunca no meio
  de uma mão em andamento.
- Se o stack de um jogador chegar a 0 ao fim de uma mão, ele fica marcado
  como "sentado, sem fichas" (`awaitingRebuy: true`, `stack: 0`) e não
  participa das próximas mãos até responder a oferta de rebuy (ver seção
  de rebuy acima). Só é removido do assento se ele mesmo recusar o rebuy
  ou escolher levantar.
- Quando sobrar menos de 2 jogadores ativos sentados (contando só quem não
  está `awaitingRebuy`), mesa volta pro estado standby.

## Escopo do MVP — o que FICA DE FORA (não implementar agora)

- Lobby com múltiplas mesas.
- Login/autenticação real, contas persistentes, dinheiro real.
- Chat entre jogadores.
- Torneios e blinds progressivos (o rebuy simples entre mãos ESTÁ no
  escopo, ver seção acima).
- Histórico de mãos / replay.
- Sons e animações elaboradas (um fade/transição simples é suficiente).

## Arquitetura

- `server.js`: estado autoritativo (assentos, stacks, cartas, pote, turno,
  fase da mão). Nunca envia ao cliente cartas de outros jogadores nem o resto
  do baralho.
- Eventos Socket.io sugeridos:
  - Cliente → servidor: `sit`, `leave`, `action` (`{type: 'fold'|'check'|'call'|'bet'|'raise', amount?}`),
    `rebuy-response` (`{accept: boolean}`).
  - Servidor → cliente: `state` (estado público da mesa + só as cartas do
    próprio jogador), `your-turn` (com prazo do timer), `hand-result`
    (vencedor(es), mãos reveladas no showdown, valor ganho), `rebuy-offer`
    (evento privado, só pro socket do jogador com stack zerado).
- Frontend só renderiza o que recebe; nenhuma lógica de regra de poker no
  cliente.
- `bot/bot.js`: bot de teste (conecta como jogador real via Socket.io) só
  pra ter alguém pra jogar contra durante o desenvolvimento — não faz
  parte do produto. Calibrado propositalmente pra parecer um jogador
  amador com ~3 anos de experiência (leque pré-flop mais largo que o
  ideal, supervaloriza par feito/overpair, paga demais no showdown, poucos
  3-bets, sizing inconsistente, blefes ocasionais desbalanceados) — não é
  um solver nem uma decisão puramente aleatória.

## Modelo de dados sugerido (estado da mesa)

```
table = {
  status: 'standby' | 'playing',
  seats: [ { playerId, name, stack, holeCards, inHand, folded, allIn, currentBet } | null, ... 9 ],
  dealerIndex: number,
  phase: 'preflop' | 'flop' | 'turn' | 'river' | 'showdown',
  communityCards: [...],
  pot: number,
  sidePots: [ { amount, eligiblePlayerIds } ],
  currentTurnIndex: number,
  minRaise: number,
  deck: [...] // nunca enviado ao cliente
}
```

## Fluxo de uma mão completa

1. Mesa tem 2+ jogadores sentados → inicia nova mão automaticamente após
   um pequeno delay (ex: 3s) do fim da mão anterior (ou da entrada do
   segundo jogador).
2. Botão de dealer avança para o próximo jogador sentado (rotação).
3. Cobra small blind do jogador à esquerda do dealer e big blind do
   próximo — descontando do stack e somando ao pote. Se o jogador não tiver
   fichas suficientes pro blind completo, ele entra all-in com o que tem.
4. Embaralha o baralho (Fisher-Yates) e distribui 2 hole cards por jogador
   sentado que está participando da mão.
5. Rodada de apostas pré-flop, começando pelo jogador após o big blind.
6. Revela 3 cartas comunitárias (flop) → nova rodada de apostas, começando
   pelo primeiro jogador ativo à esquerda do dealer.
7. Revela 1 carta (turn) → rodada de apostas.
8. Revela 1 carta (river) → rodada de apostas.
9. Showdown: jogadores que não deram fold revelam as cartas; determina
   vencedor(es) por força de mão; distribui pote principal e side pots
   (em caso de empate, divide igualmente, sobra vai pro primeiro à
   esquerda do dealer).
10. Atualiza stacks, limpa mãos e cartas comunitárias, prepara próxima mão.

Regra de encerramento antecipado: se todos menos um jogador derem fold em
qualquer fase, esse jogador vence o pote imediatamente sem revelar cartas e
sem precisar chegar ao showdown.

## Regras de apostas

- Ordem de ação: sempre em sentido horário a partir de quem está "à
  esquerda" da posição de referência da rodada.
- `call`: iguala a maior aposta corrente da rodada.
- `check`: só permitido se ninguém apostou ainda nessa rodada (ou o
  jogador já igualou o valor, caso do big blind pré-flop).
- `bet`/`raise`: valor mínimo = maior aposta atual + último incremento de
  raise (regra padrão de no-limit hold'em); jogador pode apostar qualquer
  valor acima disso até o seu stack total (all-in).
- Incrementos sugeridos na UI: botões de +0.5 BB, +1 BB, +2 BB, "pot",
  "all-in", além de um input livre.
- Uma rodada de apostas termina quando todos os jogadores ainda na mão
  igualaram a aposta corrente (ou deram fold / estão all-in).

## Avaliação de mãos

Não implementar a lógica de ranking de mãos do zero — é fácil errar
desempates (kicker, straight com Ás baixo, etc). Usar a biblioteca npm
`pokersolver` (ou equivalente) pra:
- Determinar a melhor mão de 5 cartas entre as 7 disponíveis (2 hole + 5
  comunitárias).
- Comparar mãos de múltiplos jogadores e identificar vencedor(es)/empates.

## Casos de borda a tratar

- Jogador desconecta no meio de uma mão: trata como se tivesse dado fold
  automático quando chegar sua vez (mantém o assento por um tempo de
  graça, ex: 60s, pra permitir reconexão antes de liberar o lugar).
- Timeout de turno: ação automática (check se possível, senão fold).
- Todos os jogadores da mesa ficam all-in: revela as cartas restantes
  automaticamente sem mais rodadas de aposta, até o showdown.
- Jogador tenta sentar em assento já ocupado ou sentar em dois lugares:
  servidor rejeita.
- Mesa com apenas 1 jogador: volta pro status `standby`, sem iniciar mão.
- Jogador senta durante uma mão em andamento (3º+ jogador entrando com
  outros dois já jogando): `sit()` sempre cria o assento com
  `inHand: false`, e `startHand()` só marca `inHand: true` pra todo mundo
  no início da mão seguinte — então quem senta no meio de uma mão fica de
  fora automaticamente (sem cartas, sem participar da rodada de apostas)
  até a próxima mão começar, sem precisar de nenhum tratamento especial
  além do badge de UI (ver seção UI/UX).

## UI/UX mínima

- Cartas dos outros jogadores viradas pra baixo até o showdown (ou fold =
  somem). Só o próprio jogador vê suas hole cards.
- Indicador visual de: quem é o dealer (botão "D"), de quem é a vez
  (destaque no assento + timer visível), aposta atual de cada jogador
  (chips na frente do assento), valor do pote central.
- Painel de ações do jogador (fold/check/call/bet/raise) só aparece
  quando é a vez dele, com o valor de call já calculado.
- Ao final da mão, mostrar brevemente as cartas reveladas e o vencedor
  antes de limpar a mesa pra próxima (overlay "WIN" com o valor ganho,
  similar ao exemplo de referência abaixo).
- Assento com `awaitingRebuy: true` (stack zerado, esperando decisão de
  rebuy): badge público "SEM FICHAS" visível pra todos os jogadores. Só o
  próprio dono do assento recebe um modal (não `window.confirm`) com as
  opções "Fazer rebuy" / "Levantar da mesa", disparado pelo evento privado
  `rebuy-offer`.
- Assento sentado mas ainda de fora da mão em andamento (`status ===
  'playing'` e `inHand: false`, caso de quem sentou no meio de uma mão):
  badge "AGUARDANDO PRÓXIMA MÃO" nesse assento.

### Referência visual (mesa real de poker online)

Layout de referência (ex: GGPoker/PPPoker): mesa oval verde, assentos
distribuídos ao redor com avatar circular + nome + stack abaixo de cada
um, botão "D" (dealer) ao lado do assento correspondente, cartas
comunitárias grandes centralizadas com "Total Pot" acima delas, cartas do
jogador vencedor reveladas em destaque com overlay "WIN" + valor ganho ao
fim da mão. Não é necessário replicar avatares/bandeiras/emojis de reação
no MVP — focar em: layout oval, posição dos assentos, stack visível
abaixo do nome, cartas comunitárias centralizadas, indicador de pote e
overlay de resultado da mão. Esses detalhes decorativos (avatares
customizados, emojis, bandeiras, roleta) ficam de fora do escopo do MVP.

## Ordem de implementação recomendada (testar cada etapa antes de avançar)

1. Baralho + distribuição de hole cards (visível só pro dono) + blinds
   fixos debitados dos stacks ao iniciar a mão.
2. Rodada de apostas pré-flop funcional (fold/check/call/bet/raise, sem
   side pot ainda, 2 jogadores só).
3. Flop/turn/river + múltiplas rodadas de aposta.
4. Showdown com `pokersolver` determinando o vencedor e distribuindo o
   pote.
5. Encerramento antecipado por fold geral.
6. Side pots (all-in com stacks diferentes).
7. Timer de turno + timeout automático.
8. Reconexão via id persistido + graça de desconexão.
9. Suporte a mais de 2 jogadores na mesa simultaneamente (3 a 9).
10. Polimento de UI (indicadores visuais, animações simples de carta).
