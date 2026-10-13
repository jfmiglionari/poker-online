# Objetivo e concepção

## Para que existe
Uma mesa de Texas Hold'em No-Limit no navegador, em tempo real, feita como projeto de estudo de desenvolvimento com IA. Serve também como exemplo público de IA aplicada: um bot cujas decisões podem vir de um modelo de linguagem.

## Como nasceu
O projeto começou em julho de 2026 como exercício para aprender a construir um jogo multiplayer com o Claude Code. Em outubro de 2026 virou também uma peça de portfólio, publicada neste repositório, por mostrar IA usada no desenvolvimento e dentro do produto.

## O que se decidiu no início
- Uma única mesa, até 9 assentos, fichas virtuais: mantém o escopo pequeno e testável.
- O servidor é a fonte de verdade: o cliente só mostra o estado e envia intenções. Ver `Decisões.md`.
- Front-end em JS puro, sem framework: o foco é a lógica de jogo e a comunicação em tempo real.
- Um bot de teste conecta como jogador de verdade, para que um humano jogue sozinho.

## Requisitos e regras do jogo
A especificação completa (escopo, fluxo da mão, regras de aposta, casos de borda, interface) está em [`GAME_SPEC.md`](../GAME_SPEC.md). Ela é a referência; este `docs/` não a repete.

## O que está fora
Torneios, várias mesas, contas e login, dinheiro real, histórico persistente. O que fica de fora do MVP está listado em `GAME_SPEC.md`.
