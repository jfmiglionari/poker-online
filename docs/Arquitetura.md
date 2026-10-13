# Arquitetura

## Stack
| Camada | Escolha | Por quê |
|---|---|---|
| Servidor | Node.js, Express, Socket.io | Tempo real por WebSocket com pouco código; Express só serve os arquivos estáticos. |
| Front-end | HTML, CSS e JS puro | Sem build e sem framework: o cliente só renderiza o que o servidor manda. |
| Avaliação de mãos | `pokersolver` | Biblioteca pronta e testada; evita reescrever o ranking de mãos. |
| Bot com IA | `@anthropic-ai/sdk`, `zod` | Saída estruturada e validada. Opcional. |

## Componentes
- `server.js`: mantém o estado da mesa (assentos, stacks, cartas, pote, side pots, turno, fase), aplica as regras, controla os timers (início de mão, turno, graça de desconexão) e emite o estado a cada cliente.
- `game/deck.js`: criação e embaralhamento do baralho.
- `public/` (`index.html`, `client.js`, `style.css`): a mesa na tela. Envia ações e exibe o estado recebido. Não decide regra.
- `bot/bot.js`: processo à parte que conecta ao servidor como jogador real. Decide por heurística de jogador amador ou, em modo opcional, pela API da Anthropic. Não faz parte do produto.

## Eventos Socket.io
| Sentido | Evento | Conteúdo |
|---|---|---|
| Cliente para servidor | `identify` | `playerId` guardado no navegador, para reconectar ao assento. |
| Cliente para servidor | `sit`, `leave` | Sentar (com nome e assento) e levantar entre mãos. |
| Cliente para servidor | `action` | `fold`, `check`, `call`, `bet` ou `raise`, com valor quando couber. |
| Cliente para servidor | `rebuy-response` | Aceitar ou recusar a recompra. |
| Servidor para cliente | `state` | Estado público da mesa, com as cartas só do próprio jogador. |
| Servidor para cliente | `your-turn` | Assento da vez e prazo do timer. |
| Servidor para cliente | `hand-result` | Vencedores, mãos reveladas e valores ganhos. |
| Servidor para cliente | `rebuy-offer` | Privado, só para o jogador sem fichas. |

## Fluxo principal
1. Com ao menos dois jogadores ativos, o servidor inicia a mão após uma pequena pausa: move o dealer, posta os blinds e distribui as cartas.
2. A cada vez, o servidor envia `your-turn` e dispara um timer de 20 s.
3. O jogador (ou o bot) envia `action`. O servidor valida contra as regras, atualiza o estado e envia `state` a todos.
4. Ao fim de cada rodada de apostas, abre as cartas comunitárias da fase seguinte.
5. No showdown, `pokersolver` avalia as mãos, o servidor reparte pote e side pots e emite `hand-result`.
6. Quem ficou sem fichas recebe `rebuy-offer`.

## Fluxo do bot com IA
1. Na vez do bot, ele monta o estado da mão: cartas, pote, stack e ações legais.
2. Pede ao modelo uma decisão em formato estruturado (esquema Zod).
3. Valida a decisão contra as ações legais. Se for válida, envia ao servidor.
4. Se não houver chave, se passar de 6 s ou se a resposta for inválida, usa a heurística no lugar.

## Limites conhecidos
- Uma única mesa, em memória: reiniciar o servidor zera tudo.
- Porta fixa em 3000.
- O nome do jogador é pedido por `window.prompt`.
- Duas abas no mesmo navegador compartilham o `playerId`, então a segunda assume o assento da primeira. Para testar com dois jogadores, use uma janela anônima ou o bot.
- O caminho do bot com IA (chamada real à API) ainda não foi exercitado de ponta a ponta; o fallback para a heurística foi testado.
