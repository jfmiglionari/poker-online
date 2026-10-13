# Histórico

Uma entrada por mudança relevante, a mais nova embaixo.

## 2026-07-23 · Mesa inicial
- **Antes:** não havia projeto.
- **Depois:** mesa com assentos, blinds, cartas privadas e apostas de pré-flop.
- **Por quê:** base do jogo.

## 2026-07-24 · Bot de teste
- **Antes:** só era possível jogar com duas janelas de navegador.
- **Depois:** `bot/bot.js` conecta como jogador de verdade e joga sozinho.
- **Por quê:** testar e jogar sem uma segunda pessoa.

## 2026-07-24 · Rebuy, bot amador e indicador de espera
- **Antes:** jogador sem fichas ficava travado; bot com decisões simples.
- **Depois:** fluxo de rebuy privado, bot com perfil de jogador amador e aviso para quem senta no meio de uma mão.
- **Por quê:** manter a mesa em andamento e dar um adversário mais realista.

## 2026-09-28 · Bot com decisão por IA e README
- **Antes:** o bot decidia só pela heurística.
- **Depois:** modo opcional que consulta a API da Anthropic, com saída estruturada, validação e fallback para a heurística. README do projeto.
- **Por quê:** mostrar IA aplicada ao produto sem criar dependência de chave.

## 2026-10-12 · Repositório público
- **Antes:** sem política de arquivos de trabalho fora do git.
- **Depois:** `.gitignore` ajustado para manter notas internas e dados fora do repositório público.
- **Por quê:** o repositório é uma vitrine.

## 2026-10-13 · Pasta docs/
- **Antes:** a documentação era o README e o `GAME_SPEC.md`.
- **Depois:** `docs/` com objetivo, arquitetura, modelo de dados, como rodar, decisões e histórico.
- **Por quê:** quem chega ao projeto entende o porquê das escolhas sem ler o código.
