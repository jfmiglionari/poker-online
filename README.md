# Poker Online

Mesa de Texas Hold'em No-Limit multiplayer no navegador, em tempo real via WebSocket — construída do zero como projeto de estudo, com o back-end como única fonte de verdade do estado do jogo (o cliente nunca decide regra nenhuma sozinho).

## IA aplicada no projeto

- **Bot com decisão via LLM.** O bot de teste (`bot/bot.js`) pode jogar tomando decisões reais através da API da Anthropic (Claude): a cada rodada, ele monta o estado da mão (cartas, pote, stack, ações legais) e pede pro modelo escolher fold/check/call/bet/raise, com saída estruturada e validada contra as regras da mesa antes de qualquer ação ser enviada ao servidor. Se a chamada falhar ou demorar, o bot cai automaticamente numa heurística de jogador amador — nunca trava esperando a API.
  - Ativar: `ANTHROPIC_API_KEY` no `.env` + `npm run bot:ai`.
- **Projeto desenvolvido com Claude Code**, do design da arquitetura à implementação de cada feature (blinds, side pots, showdown, reconexão, rebuy), documentado incrementalmente em [`GAME_SPEC.md`](./GAME_SPEC.md).

## Funcionalidades

- Mesa com até 9 assentos, buy-in em big blinds, rebuy entre mãos (com pop-up privado só pro jogador afetado).
- Texas Hold'em completo: blinds fixos, pré-flop/flop/turn/river, side pots em all-in com stacks diferentes, showdown com avaliação de mão via `pokersolver`.
- Estado sempre autoritativo no servidor: cada jogador só recebe suas próprias cartas.
- Reconexão automática (refresh/queda de conexão não tira o jogador do assento).
- Bot heurístico "amador" e bot com IA (Claude) pra jogar sem precisar de um segundo humano.

## Rodando localmente

```bash
npm install
npm start          # sobe o servidor em http://localhost:3000
```

Abra `http://localhost:3000` em duas janelas (uma anônima) pra sentar dois jogadores, ou use um bot pra jogar sozinho contra ele:

```bash
npm run bot        # bot heurístico
npm run bot:ai      # bot com decisão via Claude (precisa de ANTHROPIC_API_KEY no .env)
```

## Stack

Node.js, Express, Socket.io, `pokersolver` (avaliação de mãos), `@anthropic-ai/sdk` (bot com IA), HTML/CSS/JS puro no front-end.

## Documentação

A especificação completa do jogo — regras de aposta, fluxo de uma mão, casos de borda (desconexão, all-in, rebuy) — está em [`GAME_SPEC.md`](./GAME_SPEC.md).
