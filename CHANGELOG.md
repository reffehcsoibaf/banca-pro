# Changelog — Banca Pro

Todas as mudanças relevantes do app ficam registradas aqui, da mais recente para a mais antiga.
O número de versão aparece no rodapé do próprio app, então é sempre possível conferir qual versão
está publicada e comparar com o que está descrito aqui.

## v1.9.1 — 18/07/2026

### Acessibilidade
- Cada linha da tabela na aba Lista agora é focável por inteiro (não só os botões ✓/✗/✏️/🗑️
  dentro dela). Um único `Tab` já "seleciona" a linha inteira como a "aposta em foco" para os
  atalhos `Alt+G`/`Alt+P`/`Alt+E`/`Alt+X` — não é mais preciso entrar em um botão específico. Ao
  mudar de linha, um aviso sonoro confirma qual aposta está em foco. Isso também vale para quem
  navega pela tabela com o NVDA usando `Ctrl+Alt+Setas`: ao chegar na linha desejada, um `Enter`
  (sozinho, como passo separado) já define a aposta em foco.
- Novo atalho `Alt+L` (Localizar): abre uma caixa para digitar o Identificador (ou parte dele) da
  aposta desejada. Funciona de qualquer aba — leva direto até a linha correspondente na aba Lista,
  já em foco, pronta para os atalhos de ação. Se o texto digitado corresponder a mais de uma
  aposta, o app pede um termo mais específico em vez de agir sobre a errada.

## v1.9.0 — 18/07/2026

### Navegação
- Ordem das abas alterada: **Lista** agora vem em segundo lugar (antes de Filtros), e **Filtros**
  passou para a terceira posição. Nova ordem: Cadastro, Lista, Filtros, Saldos, Configurações.
  Os atalhos globais `Alt+2` e `Alt+3` foram atualizados de acordo (`Alt+2` = Lista, `Alt+3` =
  Filtros).

### Acessibilidade — novos atalhos de ação
- `Alt+S`: salva a aposta do formulário de Cadastro (ou atualiza, se estiver em edição) — mesmo
  efeito do botão "💾 Salvar Aposta"/"✏️ Atualizar Aposta". Só age com a aba Cadastro ativa.
- `Alt+G` / `Alt+P`: marca a "aposta em foco" na aba Lista como Ganhou ou Perdeu.
- `Alt+E`: abre a "aposta em foco" para edição (equivale ao botão ✏️).
- `Alt+X`: exclui a "aposta em foco", com a mesma confirmação do botão 🗑️.
- Conceito de "aposta em foco": é a linha da tabela cujo botão de ação (✓, ✗, ✏️ ou 🗑️) recebeu
  foco do teclado por último. Não é preciso estar exatamente no botão da ação desejada — qualquer
  botão daquela linha já a torna a aposta em foco para os quatro atalhos acima. Sem nenhuma linha
  em foco, os atalhos avisam e não executam nada.

### Desempenho e Acessibilidade
- Preferência "Apostas por página" (Configurações → Preferências da Lista) ganhou duas novas
  opções: **10** (bases pequenas ou telas mais lentas) e **Todas** (mostra a lista filtrada
  inteira em uma página só, sem paginação). Continuam disponíveis 25, 50, 100 e 200.

### Correções no Guia de Uso (wiki.html)
- Removida a tag "v5" do título, que não correspondia à versão real do sistema.
- Corrigida a descrição da aba Filtros: os filtros são aplicados em tempo real, mas o resultado só
  aparece na aba Lista ao navegar até ela manualmente (botão "📋 Ver Apostas" ou atalho `Alt+2`) —
  o texto anterior descrevia incorretamente uma navegação automática que nunca existiu.
- Ordem das seções do guia (barra lateral e índice) atualizada para acompanhar a nova ordem das
  abas do app.
- Nova tabela de atalhos de ação e explicação do conceito de "aposta em foco".

## v1.8.0 — 16/07/2026

### Aba Lista
- Removido o card de resumo ("Entradas", "Ganhas", "Perdidas", "Abertas", "Stake Total", "Lucro"
  etc.) que aparecia duplicado no topo da aba Lista. Esses mesmos números já são exibidos no
  painel fixo no topo da tela, visível em todas as abas — a versão de dentro da Lista era
  redundante.
- Removido o menu "⋯" (outros status) das ações rápidas de cada linha da tabela. Ficam apenas os
  botões ✓ Ganhou e ✗ Perdeu. Os demais status (Ganho Parcial, Perda Parcial, Cash Out, Anulada
  ou reabrir como Aberto) continuam disponíveis normalmente editando a aposta (botão ✏️).

### Leitor de Bilhete (IA)
- Nova regra para diferenciar o mercado **Faixa de gols** do mercado **Gols**: a Betano às vezes
  rotula como "Total de Gols" um mercado cuja seleção é na verdade um intervalo no formato
  "N-M" (ex.: "1-4", "2-5") — isso é sempre Faixa de gols, não Gols, mesmo com o rótulo "Total de
  Gols" no bilhete. A IA agora identifica esse formato pelo hífen entre dois números e preenche o
  mercado correto.
- O mesmo vale por equipe: novo mercado **Faixa de gols da Equipe**, reconhecido quando o
  formato é "<Time> - Total de Gols" com seleção em intervalo (ex.: "River Plate - 2-4"),
  diferente de "Gols da Equipe" (que continua valendo para seleções "Mais de X.5"/"Menos de X.5").

## v1.7.0 — 14/07/2026

### Acessibilidade
- Novo botão **"🔄 Recarregar Aplicativo"** em Configurações. Resolve a falta de F5/barra de
  endereço quando o Banca Pro é adicionado à tela inicial do celular (modo app/standalone),
  onde antes não havia forma simples de forçar uma atualização da página.
- Novo gesto de **puxar para atualizar** (pull-to-refresh): estando no topo de qualquer aba,
  puxar a tela para baixo mostra um indicador ("Puxe para atualizar" → "Solte para atualizar")
  e recarrega o app ao soltar. Só ativa quando a página já está com rolagem no topo, para não
  interferir na rolagem normal de listas e tabelas.

## v1.6.1 — 14/07/2026

### Desempenho e Acessibilidade
- Paginação da aba **Lista**: adicionados os botões "⏮ Primeira" e "Última ⏭", ao lado
  de "← Anterior" e "Próxima →", permitindo saltar direto para o início ou o fim da
  lista filtrada sem precisar clicar várias vezes em "Próxima".

## v1.6.0 — 14/07/2026

### Desempenho e Acessibilidade
- A aba **Lista** agora é paginada: em vez de renderizar todas as apostas filtradas de
  uma vez, exibe um número configurável por página, com botões "← Anterior" / "Próxima →"
  e indicação "Mostrando X–Y de Z" / "Página X de Y". Isso resolve a lentidão sentida ao
  abrir a aba com uma base grande de apostas — com centenas ou milhares de linhas, o
  navegador (e principalmente o NVDA, ao reconstruir a árvore de acessibilidade da
  tabela) levava um tempo perceptível para ficar responsivo novamente.
- Nova opção em **Configurações → Preferências da Lista**: "Apostas por página"
  (25 / 50 / 100 / 200). A escolha fica salva neste dispositivo/navegador (não é
  sincronizada entre aparelhos, já que é uma preferência de exibição, não um dado
  da conta).
- Como efeito colateral positivo, marcar uma aposta como Ganhou/Perdeu/etc. na tabela
  ficou mais rápido: a tabela inteira é redesenhada a cada ação, mas como só a página
  atual (no máximo algumas dezenas de linhas) é exibida, o redesenho é praticamente
  instantâneo.

## v1.5.0 — 12/07/2026

### Acessibilidade
- Novos atalhos de teclado globais para trocar de aba de qualquer lugar da tela, sem precisar
  navegar até a barra de abas primeiro: `Alt+1` (Cadastro), `Alt+2` (Filtros), `Alt+3` (Lista),
  `Alt+4` (Saldos), `Alt+5` (Configurações). Funcionam mesmo com o foco dentro de um campo de
  formulário. Documentados na tabela de atalhos do `wiki.html`.

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
