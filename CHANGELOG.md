# Changelog — Banca Pro

Todas as mudanças relevantes do app ficam registradas aqui, da mais recente para a mais antiga.
O número de versão aparece no rodapé do próprio app, então é sempre possível conferir qual versão
está publicada e comparar com o que está descrito aqui.

## v1.4.0 — 11/07/2026

### Acessibilidade
- Novo arquivo `changelog.html`: o histórico de versões agora também existe como página web,
  com títulos estruturados (H1/H2/H3) navegáveis por leitor de tela — alternativa ao
  `CHANGELOG.md`, que só é confortável de ler em editores de texto simples como o Bloco de Notas.
- Link "🗒️ Versões" adicionado no cabeçalho do app (ao lado de "📖 Guia") e também na tela de
  login, apontando para essa nova página.

## v1.3.0 — 11/07/2026

### Leitor de Bilhete (IA)
- O campo Tipo (Ao Vivo / Pré Live) agora é preenchido automaticamente pela IA ao ler um bilhete
  por foto ou texto. A detecção usa sinais como cronômetro de partida em andamento (ex.: "14'",
  "1°T"), placar parcial visível ou rótulos explícitos de "AO VIVO"/"LIVE". Quando nenhum sinal
  desses aparece, o campo é preenchido como "Pré Live" por padrão. Continua totalmente editável
  antes de salvar, como qualquer outro campo preenchido pela extração.

## v1.2.0 — 11/07/2026

### Leitor de Bilhete (IA)
- Rótulo "DICAS DE APOSTA" (Superbet) agora é reconhecido e ignorado como texto de interface,
  igual já acontecia com "CRIAR APOSTA" — não é mais confundido com dado da aposta.
- Novo reconhecimento do mercado "Cada Equipe Mais de X <Estatística>" (ex.: cartões, gols,
  escanteios, faltas, finalizações, chutes no gol, desarmes, impedimentos, defesas): a IA agora
  identifica corretamente esse formato — que pergunta se AMBOS os times superam individualmente
  um valor de referência — e preenche o mercado correto com a seleção descrevendo a condição
  completa (ex.: mercado "Cartões", seleção "Mais de 0.5 cartões para cada equipe - Sim").

## v1.1.0 — 11/07/2026

### Leitor de Bilhete (IA)
- Nova regra para condições restritas a uma etapa da partida (1º/2º Tempo no futebol; quarto
  específico ou metade do jogo no basquete):
  - Futebol: a estatística (Finalizações, Escanteios, Gols, Cartões, Faltas, Chutes no Gol,
    Impedimentos, Desarmes, Defesas etc.) recebe o sufixo `HT` (1º Tempo) ou `2T` (2º Tempo) na
    seleção, e o mercado "Intervalo" passa a ser marcado junto com o mercado da estatística.
  - Basquete: quando a condição é de um quarto específico (Pontos, Assistências, Rebotes, Cestas
    de 3 Pontos etc.), a seleção recebe o sufixo `Q1`/`Q2`/`Q3`/`Q4` e o mercado "Quarto" passa a
    ser marcado junto. Quando é referente a uma metade do jogo (não um quarto específico), usa o
    mesmo sufixo `HT`/`2T` do futebol, sem marcar mercado extra.
  - A regra combina normalmente com estatísticas por jogador ou por equipe, marcando todos os
    mercados aplicáveis ao mesmo tempo.

## v1.0.0 — 10/07/2026

Primeira versão com número de versão rastreado. Este marco reúne o que já estava em produção até
esta data, com base no que foi acompanhado nas conversas mais recentes:

### Navegação
- App reorganizado em abas no topo — Cadastro, Filtros, Lista, Saldos e Configurações — funcionando
  igual em desktop e celular (antes só o celular tinha navegação por abas, com uma barra fixa embaixo
  da tela; o desktop mostrava tudo empilhado). A barra inferior do celular foi removida.
- Navegação por teclado nas abas (setas ←→, Home/End) e anúncio da aba selecionada para leitor de tela.

### Leitor de Bilhete (IA)
- Leitura automática de bilhetes de aposta via foto/print ou texto colado, pré-preenchendo o
  formulário de cadastro (casa, data/hora, stake, status, eventos com esporte/liga/mercado/seleção/odd).
- Estratégia de provedor: tenta Google Gemini primeiro (gratuito), com fallback automático para
  Anthropic Claude se o Gemini falhar.
- Mapeamento de mercados e sugestão de opções que ainda não existem nas listas do Banca Pro, exibidas
  como chips clicáveis para adicionar rapidamente.

### Infraestrutura
- Hospedado em Cloudflare Workers (arquivos estáticos + rota `/api/ler-bilhete`).
- Chaves de API (Gemini, Anthropic) nunca ficam no navegador — vivem só como variáveis de ambiente
  no Cloudflare.

> Nota: como o rastreamento de versão começa agora, este primeiro registro é um resumo do estado
> atual, não um histórico completo de tudo que já foi feito desde o início do projeto. A partir daqui,
> toda mudança relevante entra como uma entrada nova.

---

## Como usar este changelog daqui pra frente

A cada mudança relevante entregue, um novo bloco de versão é adicionado no topo deste arquivo,
seguindo o padrão:

```
## vX.Y.Z — DD/MM/AAAA
- O que mudou, em linguagem direta.
```

- **X (major)**: mudança estrutural grande ou que quebra algo do funcionamento anterior.
- **Y (minor)**: novo recurso.
- **Z (patch)**: correção de bug ou ajuste pequeno.

O rodapé do app (`index.html`) é atualizado junto, na mesma entrega, para sempre bater com este arquivo.
