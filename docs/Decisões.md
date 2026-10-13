# Decisões

Uma linha por decisão, a mais nova embaixo. Decisão que muda outra não apaga a antiga: entra uma linha nova.

| Data | Decisão | Por quê | Reabrir quando |
|---|---|---|---|
| 2026-07-23 | Node.js, Express e Socket.io no servidor; JS puro no front. | Tempo real com pouco código e sem etapa de build. O foco é a lógica do jogo. | Se o front ganhar telas que justifiquem um framework. |
| 2026-07-23 | O servidor é a fonte de verdade; o cliente só renderiza e envia intenções. | Impede trapaça e garante que cada jogador veja só as próprias cartas. | Nunca para regra de jogo. |
| 2026-07-24 | Buy-in e blinds em big blinds: 50 BB, blinds fixos 10/20. | Valores simples e proporcionais, sem estrutura de torneio. | Se houver blinds crescentes. |
| 2026-07-24 | Heads-up: o dealer é o small blind e age primeiro no pré-flop. | É a regra padrão do poker para duas pessoas; evita a posição errada com dois jogadores. | Nunca, é regra do jogo. |
| 2026-07-24 | Rebuy privado: o pop-up vai só ao jogador sem fichas; recusar libera o assento. | Não interrompe os outros e não prende assento de quem não quer continuar. | Se houver modo com recompras limitadas. |
| 2026-07-24 | Reconexão por `playerId` no navegador, com 60 s de graça. | Atualizar a página ou perder a conexão não tira o jogador da mesa. | Se houver contas e login. |
| 2026-07-24 | Bot de teste com perfil de jogador amador, não aleatório. | Dá um adversário plausível para testar o fluxo do jogo. | Se o bot virar produto. |
| 2026-09-28 | IA do bot é opt-in (`BOT_AI=1`) e tem fallback para a heurística. | Ninguém gasta crédito de API sem querer, e o bot nunca trava se a API falhar. | Se a IA virar o modo padrão. |
| 2026-09-28 | Modelo `claude-haiku-4-5`. | É rápido e barato; a decisão precisa caber em poucos segundos. | Se a qualidade da decisão importar mais que latência e custo. |
| 2026-09-28 | Saída estruturada com Zod e validação contra as ações legais. | O modelo pode propor jogada inválida; nada chega ao servidor sem ser conferido. | Se o SDK mudar o formato de saída. |
| 2026-09-28 | Timeout de 6 s na chamada à IA. | Fica bem abaixo do timer de turno de 20 s do servidor. | Se o timer de turno mudar. |
| 2026-10-12 | Repositório público como vitrine. | Serve de evidência de projeto desenvolvido com IA. | Se o código passar a conter algo sensível. |
