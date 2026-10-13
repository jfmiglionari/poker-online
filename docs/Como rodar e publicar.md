# Como rodar e publicar

## Pré-requisitos
Node.js e npm.

## Rodar local
```bash
npm install
npm start          # http://localhost:3000
```
Para jogar sozinho, abra a página e rode um bot em outro terminal:
```bash
npm run bot        # bot heurístico
npm run bot:ai     # bot com decisão via Claude
```
Para sentar dois humanos, use uma janela anônima na segunda vaga (veja Problemas comuns).

## Variáveis de ambiente
| Nome | Para que serve | Onde conseguir |
|---|---|---|
| `ANTHROPIC_API_KEY` | Habilita o bot com IA. Opcional. | Console da Anthropic. Vai no `.env` local, que não é versionado. |
| `BOT_AI` | `1` ativa o modo IA do bot (o script `bot:ai` já define). | Definida na linha de comando. |
| `BOT_SERVER_URL` | Endereço do servidor para o bot. Padrão `http://localhost:3000`. | Opcional. |
| `TURN_TIMEOUT_MS`, `DISCONNECT_GRACE_MS` | Mudam o timer de turno e a graça de reconexão, úteis em teste. | Opcionais. |

Copie `.env.example` para `.env` e preencha só se for usar o bot com IA. Nunca versione o `.env`.

## Publicar
Não há deploy configurado. O projeto roda localmente; o repositório no GitHub é a vitrine do código.

## Problemas comuns
- **A segunda aba assume o assento da primeira.** As abas do mesmo navegador compartilham o `playerId`. Use janela anônima ou o bot.
- **Bot com IA joga como o heurístico.** Sem `ANTHROPIC_API_KEY`, ele avisa no terminal e usa a heurística.
- **Porta 3000 ocupada.** A porta está fixa em `server.js`.
