# Modelo de dados

Tudo vive em memória no servidor. Não há banco de dados. O modelo conceitual da mesa está em [`GAME_SPEC.md`](../GAME_SPEC.md); aqui está o que o código mantém hoje.

## Entidades
### Mesa
| Campo | Tipo | Significado |
|---|---|---|
| `status` | `standby` ou `playing` | Se há mão em andamento. |
| `seats` | lista de 9 | Assentos; vazio é `null`. |
| `dealerIndex`, `sbIndex`, `bbIndex` | número | Posições do dealer e dos blinds. |
| `phase` | `preflop`, `flop`, `turn`, `river` ou `showdown` | Fase da mão. |
| `communityCards` | lista | Cartas comunitárias abertas. |
| `pot`, `sidePots` | número, lista | Pote e potes laterais. |
| `currentTurnIndex`, `turnDeadline` | número, timestamp | De quem é a vez e quando o timer estoura. |
| `minRaise` | número | Menor aumento permitido. |
| `deck` | lista | Baralho. Nunca é enviado ao cliente. |

### Assento
| Campo | Significado |
|---|---|
| `name`, `stack` | Nome exibido e fichas. |
| `holeCards` | Cartas privadas. Os outros jogadores recebem `null` no lugar, salvo no showdown. |
| `inHand`, `folded`, `allIn` | Situação na mão atual. |
| `currentBet`, `totalContributed` | Apostado na rodada e na mão. |
| `connected` | Se o jogador está conectado. |
| `awaitingRebuy` | Stack zerado, aguardando resposta ao rebuy. |

O servidor guarda ainda o identificador do jogador e do socket em cada assento. O `playerId` identifica o jogador entre reconexões.

## Parâmetros fixos
Blinds de 10 e 20, buy-in padrão de 50 big blinds (1000 fichas), timer de turno de 20 s, graça de 60 s para reconectar.

## Onde os dados ficam
Só em memória do processo. Nada é gravado em disco. O único dado no navegador é o `playerId` no `localStorage`.
