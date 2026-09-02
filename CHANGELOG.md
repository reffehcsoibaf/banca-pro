# Changelog — Banca Pro

Todas as mudanças relevantes do app ficam registradas aqui, da mais recente para a mais antiga.
O número de versão aparece no rodapé do próprio app, então é sempre possível conferir qual versão
está publicada e comparar com o que está descrito aqui.

## v1.29.6 — 02/09/2026

### Ordem dos mercados combinados agora é preservada no formulário (não só na leitura por IA)

A v1.29.5 corrigiu a instrução da IA para nunca reordenar mercados combinados
em ordem alfabética, mas o formulário manual (marcar/desmarcar checkboxes de
mercado) ainda tinha o mesmo problema: a lista de checkboxes é sempre exibida
em ordem alfabética (pra facilitar achar visualmente), e ao salvar, os
mercados marcados eram lidos na ordem em que apareciam na tela — não na
ordem em que foram marcados nem na ordem do bilhete original. Isso afetava:

- **Preenchimento manual** de uma aposta com mercados combinados: marcar as
  caixas fora de ordem alfabética não tinha efeito — o valor salvo sempre
  saía em ordem alfabética.
- **Edição de uma aposta já salva**: reabrir uma aposta com mercados
  combinados e salvar de novo (mesmo sem tocar no campo Mercado)
  silenciosamente reordenava os mercados em ordem alfabética, podendo
  quebrar o pareamento com o campo Seleção em casos sem nome de time.
- **Revisão/aprovação de um mercado novo** sugerido pela extração por IA.

Corrigido guardando a ordem real (de marcação ou já salva) em cada checkbox
via `data-ordem-mercado`, e usando essa ordem — nunca a ordem alfabética da
lista de opções — em todo lugar que grava ou relê os mercados marcados de um
evento (extração por IA, edição, salvar, análise de aposta, e reconstrução
da lista ao trocar o esporte do evento).

## v1.29.5 — 02/09/2026

### Correção de julgamento em mercados combinados (bilhete Superbet Copa do Brasil)

Um bilhete de Finalizações + Chutes no Gol combinados foi lido pela IA como
"Ganhou" quando na verdade tinha perdido — dois problemas foram
identificados e corrigidos:

- **Ordem de gravação:** em mercados combinados (ex.: "Chutes no gol,
  Finalizações"), o campo `mercado` às vezes saía em ordem alfabética
  enquanto o campo `selecao` saía na ordem do bilhete — isso quebra o
  pareamento entre cada mercado e o valor apostado correspondente,
  especialmente quando nenhuma condição tem nome de time pra servir de
  referência. A instrução de leitura do bilhete foi reforçada com aviso
  explícito e um exemplo real desse caso: os dois campos agora devem sempre
  sair na mesma ordem, a ordem em que as condições aparecem no bilhete —
  nunca alfabética.
- **Julgamento por IA em mercados combinados:** o prompt que decide o
  resultado (Ganhou/Perdeu) não tinha nenhuma regra explícita pra mercados
  combinados por vírgula (só existia pra mercados unidos por "&"). Agora
  essa regra existe: cada condição precisa ser verdadeira individualmente
  pra o conjunto "Ganhar", e foi adicionada uma verificação obrigatória de
  direção da comparação ("Menos de X" só ganha se o valor real for menor
  que X) antes de concluir o resultado — evita a inversão lógica que causou
  esse erro específico.

O bilhete específico (Superbet, identificador 892W-1QVRUW) foi corrigido
manualmente no banco de dados para "Perdeu", conforme o resultado oficial
confirmado na casa de apostas.

## v1.29.4 — 01/09/2026

### Remoção da rota temporária de diagnóstico

Testamos em produção o parâmetro `ids` da API-Football (que permitiria
buscar estatísticas de várias partidas numa chamada só) e a própria API
confirmou que ele **não está disponível no plano gratuito** ("Free plans do
not have access to the Ids parameter"). Como essa otimização não é viável
no plano atual, a rota interna `/api/debug-fixture-ids` criada na v1.29.3
para esse teste foi removida. A solução real para o erro de limite de
requisições continua sendo a da v1.29.2 (espaçamento entre chamadas +
retentativa automática), que já está em produção.

## v1.29.3 — 01/09/2026

### Rota interna temporária de diagnóstico (não é uma funcionalidade do app)

Adicionada uma rota de backend só para investigação técnica, sem qualquer
botão ou tela associada no app: `GET /api/debug-fixture-ids`. Ela existe
para confirmar o formato exato de uma resposta da API-Football antes de
usar esse formato de verdade no "Checar Apostas", com o objetivo de reduzir
bastante o número de chamadas feitas por lote (hoje: 1 chamada de
estatísticas por partida; o formato em teste permitiria buscar estatísticas
de até 20 partidas numa chamada só). Essa rota será removida na próxima
versão, junto com a implementação real (ou não, se o formato não se
confirmar como esperado).

## v1.29.2 — 01/09/2026

### Checar Apostas: correção do erro "limite de requisições" da API-Football

O plano gratuito da API-Football permite só 10 requisições por minuto. O
"🔎 Checar Apostas" fazia todas as chamadas necessárias (1 por data de jogo +
1 por partida) em sequência rápida, sem pausa — em lotes pequenos como 5
eventos em jogos/datas diferentes, isso já bastava para estourar o limite e o
evento caía com o erro cru da API-Football em vez de ser checado.

- Agora há uma pausa de ~6,5 segundos entre cada chamada à API-Football
  dentro de um mesmo lote de checagem, o suficiente para nunca ultrapassar o
  limite de 10/minuto do plano gratuito — checar vários eventos de uma vez
  fica um pouco mais lento, mas não falha mais por causa disso.
- Se mesmo assim vier o erro de limite (código 429), o Worker agora espera
  15 segundos e tenta mais uma vez automaticamente antes de desistir daquele
  jogo/data específico.
- A mensagem de erro agora diferencia dois casos: limite por MINUTO
  (temporário, a checagem funciona de novo já no minuto seguinte) e cota
  DIÁRIA esgotada (o plano gratuito também tem um teto de 100
  requisições/dia — nesse caso, só volta a funcionar depois da meia-noite em
  Londres, 21h em Brasília).

## v1.29.1 — 31/08/2026

### Botão para recolher/expandir o Resumo do Filtro

- O painel "📊 Resumo do Filtro" (fixo no topo, com os totais de entradas,
  ganhas, perdidas, abertas, stake, lucro, unidades, ROI e % de acerto) agora
  tem um botão para recolher e expandir, ao lado do título do painel.
- O estado (recolhido ou expandido) fica salvo neste dispositivo/navegador —
  igual à paginação e à análise automática — e é lembrado da próxima vez que
  o app for aberto. Padrão: expandido.
- Acessibilidade: o botão tem `aria-label` que muda entre "Recolher resumo
  do filtro" e "Expandir resumo do filtro", e `aria-expanded` reflete o
  estado atual — o símbolo visual (▲/▼) não é lido pelo leitor de tela,
  só o rótulo.

### Busca automática de Liga e Horário da Partida (Foto/Texto)

- Bilhetes que não trazem a liga e/ou o horário da partida no próprio
  bilhete (comum na Betano) agora têm esses dados buscados automaticamente
  com IA (busca na web), logo depois que a leitura do bilhete por Foto ou
  Texto termina — e antes do Painel de Conferência ser exibido, para que ele
  já mostre os dados completos.
- Só busca eventos com o nome do Evento preenchido e a Liga OU a Data/Hora
  da Partida ainda vazias; eventos já completos (lidos certo pelo bilhete ou
  já corrigidos) não são sobrescritos. Reaproveita a mesma busca do botão
  manual "🔎 Buscar Liga/Horário", que continua disponível a qualquer
  momento.
- Nova preferência em Configurações → "🔎 Liga e Horário da Partida (IA)",
  ligada por padrão — pode ser desligada se você preferir só usar o botão
  manual.
- A análise de risco/estatística automática (quando ativada) agora roda
  depois dessa busca, para já ter a liga disponível ao analisar.

### Painel de Conferência agora mostra a Data/Hora da Partida

- O Painel de Conferência (janela persistente exibida após a leitura do
  bilhete) agora inclui, por evento, "Data da Partida" e "Hora da Partida" —
  além dos campos que já existiam (Esporte, Liga, Evento, Mercados, Seleção,
  Odd). Antes, só a data/hora de registro do bilhete (geral) aparecia.

## v1.29.0 — 30/08/2026

### Repaginação completa: "Checar Resultados" + "Checar Estatísticas" viram "🔎 Checar Apostas"

Essa funcionalidade não estava funcionando bem — poucos mercados eram reconhecidos, os dois
botões faziam quase a mesma coisa, e mercados comuns como "Resultado Final & Total de Gols"
ou "Ganhar qualquer um dos Tempos" sempre caíam em "não suportado". Investigando a fundo, a
causa raiz de boa parte disso era um bug concreto: a lógica local de resolução de placar só
reconhecia o mercado chamado **"Vencedor"**, mas o mercado que o Futebol realmente usa pra
apostas de vencedor da partida se chama **"Resultado"** ou **"Resultado Final"** — ou seja,
a aposta mais comum de todas (quem vence o jogo) nunca era resolvida pela lógica rápida e
sempre dependia do 2º passo (IA), que só recebia o placar, não as estatísticas completas.

**O que mudou:**

- **Um único botão**, "🔎 Checar Apostas" (era "🔎 Checar Resultados" + "📊 Checar
  Estatísticas") — com **atalho de teclado Alt+C** (funciona com a aba Lista ativa). O botão
  equivalente dentro do Cadastro (ao editar uma aposta já salva) virou "🔎 Checar Aposta".
- **Bug corrigido:** a resolução local de placar agora reconhece os nomes reais dos mercados
  de vencedor no Futebol ("Resultado" e "Resultado Final"), além de "Vencedor" — antes,
  nenhuma dessas apostas (as mais comuns do app) passava pela lógica rápida local.
- **Nova cascata de resolução**, para cada evento: 1) lógica local a partir do placar (mais
  rápida, sem custo de IA) → 2) se não resolveu, lógica local a partir das estatísticas
  completas da partida → 3) se ainda não resolveu, uma IA (Gemini → Anthropic) julga o
  resultado usando TODOS os dados brutos já buscados (placar final, intervalo e estatística
  completa da partida) — sem pesquisa na web, sem chamada extra à API-Football. A IA agora
  entende explicitamente os mercados combinados com "&" no nome (ex.: "Resultado Final &
  Total de Gols") e o mercado "Ganhar qualquer um dos Tempos" (usando o placar do intervalo).
- **Nada de travas por lista fixa de mercados** — só ficam permanentemente fora Desarmes e
  Tiros de Meta, porque a API-Football simplesmente não tem esses dados em nenhum plano (não
  existe dado bruto disponível nem pra lógica local nem pra IA usar).
- **Sempre busca placar E estatísticas** de cada partida (antes, "Checar Resultados" só
  buscava placar) — mais completo, ao custo de uma chamada a mais de API-Football por
  partida distinta (continua sendo 1 chamada por partida, não por evento).
- **Filtro de 2 horas**: no seletor de apostas, as que têm todos os eventos com Data/Hora da
  Partida 2h ou mais no passado já vêm com a caixa marcada por padrão (tempo em que a
  maioria dos jogos já terminou) — ajustável manualmente, não é uma trava.
- Rota do Worker unificada: `/api/checar-resultados` e `/api/checar-estatisticas` viraram
  `/api/checar-apostas`.

## v1.28.0 — 30/08/2026

### "Checar Resultados": fallback por IA para mercados sem lógica local

- Antes, qualquer mercado que a lógica local de `/api/checar-resultados` não reconhecesse
  (mercados combinados tipo "Criador de Apostas", variações de texto na Seleção, etc.) caía
  direto em "não suportado" — mesmo quando o placar bruto já buscado (final e intervalo)
  bastava pra resolver o mercado, só que numa combinação que a lógica local não previu.
- Agora, quando a resolução local não reconhece o mercado, o Worker manda o **placar bruto**
  (final da partida + intervalo, quando a API-Football tiver esse dado) pra uma IA (Gemini →
  Anthropic, mesmo padrão de fallback já usado no resto do app) julgar o resultado — sem
  pesquisa na web e sem gastar cota extra da API-Football, já que o placar já foi buscado.
- A IA responde honestamente "Indeterminado" (virando "não suportado" na revisão) quando os
  dados fornecidos realmente não bastam pra julgar aquele mercado (ex.: depende de cartões ou
  escanteios, que não fazem parte do placar) — nesse caso, use o botão **"📊 Checar
  Estatísticas"** (da v1.24.0), que consulta esses dados via um endpoint separado da API-Football.
- Sugestões resolvidas por esse caminho aparecem no painel de revisão com a marca **"(via IA)"**
  no motivo, pra deixar claro que passaram por esse segundo passo em vez da lógica determinística.

## v1.27.0 — 30/08/2026

### Seletor de "📊 Checar Estatísticas" — agora em lote, com Data/Hora em vez de ID/Casa

- O seletor de apostas (botão na Lista) agora mostra, por aposta, os **eventos com a
  Data/Hora de cada partida** — não mais ID e Casa, que não ajudavam a decidir se já valia
  a pena submeter a checagem (jogo pode ainda não ter terminado).
- Cada aposta ganhou uma **caixa de verificação**: marque quantas quiser (ou use "Marcar
  todas"/"Desmarcar todas") e envie de uma vez com o novo botão **"📊 Enviar Consulta"**.
- Quando o lote enviado tem **partidas repetidas** entre as apostas marcadas (comum quando
  há mais de uma aposta no mesmo jogo), a API-Football só é consultada **uma vez por
  partida distinta** — o mesmo resultado é reaproveitado para validar cada mercado. Esse
  comportamento já existia no Worker desde a v1.24.0; agora o painel de revisão mostra
  quantas partidas distintas foram de fato consultadas, deixando essa economia visível.
- O botão dentro do Cadastro (ao editar uma aposta já salva) continua igual, sempre 1
  aposta por vez.

### Acessibilidade: símbolos removidos da coluna Eventos (Lista)

- Removido o emoji de relógio (🕐) antes do horário de cada evento — o NVDA lia como
  "relógio marcando uma em ponto", confundindo mais do que ajudava. O horário continua
  aparecendo, só sem o símbolo.
- Removido o símbolo "└" antes da linha de mercado — o NVDA lia o nome do caractere,
  também confuso. A linha de mercado agora aparece sem símbolo nenhum na frente.
- Apostas com **um único evento** não mostram mais o número "1." na frente do nome do
  evento — numeração só aparece em acumuladores (dois ou mais eventos), quando ela
  realmente ajuda a diferenciar cada perna da aposta.

### Formato da Seleção em mercados combinados ("Criador de Apostas")

- Quando um evento combina várias condições (ex.: Criador de Apostas da Betano), o
  separador entre as condições na Seleção mudou de **" + "** para **", "** (ex.: antes
  "Classificar + Inglaterra - Mais de 4.5", agora "Classificar, Inglaterra - Mais de 4.5").
  Afeta a leitura de bilhetes novos pela IA a partir desta versão — bilhetes já
  cadastrados antes não são alterados retroativamente.

## v1.25.0 — 30/08/2026

### Nova funcionalidade: Inferência de Data/Hora da Partida por IA

- O botão de busca por IA, antes só "🔍 Buscar Liga", agora também infere a **Data / Hora
  da Partida** — mesmo mecanismo de busca (Sofascore, 365scores), mesma filosofia de nunca
  "chutar" um valor sem confirmação. Renomeado para **"🔍 Buscar Liga e Data/Hora"**.
- Especialmente útil para bilhetes da **Betano**, que não trazem a data/hora do jogo no bilhete
  — antes esse campo só podia ser preenchido manualmente nessas apostas.
- Liga e Data/Hora são encontradas de forma independente: a IA pode confirmar uma sem a outra.
  Cada campo só é preenchido se estiver vazio — nunca sobrescreve um valor já digitado ou já
  encontrado antes.
- A IA sempre converte o horário para **horário de Brasília**, mesmo em jogos internacionais,
  seguindo a mesma regra já usada no preenchimento manual e na leitura automática de bilhetes.
- Quando o dia do jogo é confirmado mas o horário exato não, o campo ainda é preenchido com uma
  estimativa, mas fica marcado com aviso de baixa confiança — o dia (que é o que importa para as
  checagens automáticas de resultado/estatística) costuma estar correto mesmo assim.
- O botão agora roda em lote sobre todo evento que tenha o nome preenchido e falte Liga OU
  Data/Hora (antes só considerava eventos sem Liga) — eventos com os dois já preenchidos são
  pulados, sem gastar chamada de IA à toa.

### Ajuste na tabela da Lista

- A coluna separada "Horário" (introduzida nesta mesma sessão, mais cedo) foi removida — a
  Data / Hora da Partida agora aparece dentro da própria coluna **Eventos**, ao lado do nome do
  confronto, como parte das informações daquele evento.

## v1.24.0 — 30/08/2026

### Correção crítica: migração pendente da v1.23.0 aplicada no Supabase

- A coluna `data_evento` (introduzida na v1.23.0) tinha o arquivo de migração pronto no
  repositório, mas nunca tinha sido rodada no banco de produção. Isso fazia toda tentativa de
  salvar uma aposta nova com eventos falhar silenciosamente (o Supabase rejeitava o insert por
  causa da coluna inexistente). A migração foi aplicada diretamente via integração Supabase —
  cadastro de apostas voltou ao normal.

### Nova funcionalidade: Checagem de mercados de estatística (API-Football)

- Novo botão **"📊 Checar Estatísticas"**, em dois lugares: dentro do Cadastro (visível ao editar
  uma aposta já salva, checa só aquela aposta) e na aba Lista (abre um seletor para escolher
  qual aposta em aberto checar). Diferente do "🔎 Checar Resultados" (que roda em lote sobre
  todas as apostas abertas), este é sempre sob demanda — 1 aposta por vez — porque gasta mais
  cota da API-Football (1 chamada por partida distinta, além da busca por data).
- **Mercados cobertos:** Finalizações, Chutes no Gol, Faltas, Escanteios, Cartões, Impedimentos
  e Defesas — total da partida, "da Equipe" e Handicap (ex.: "Handicap de Escanteios").
- **Aviso especial em Cartões:** a contagem de amarelo/vermelho pode variar entre casas de apostas
  (ex.: o 2º amarelo, que também vira vermelho, pode ou não contar em dobro) — toda sugestão de
  Cartões vem com um aviso visível pedindo pra conferir a regra da casa antes de aplicar.
- **Nunca suportados:** Desarmes e Tiros de Meta — a API-Football não tem esses dados em nenhum
  plano, pago ou gratuito.
- Painel de revisão idêntico ao de "Checar Resultados": nada é aplicado sozinho, você confirma
  cada sugestão manualmente com "✅ Aplicar".

### Ajustes na tabela da aba Lista

- Nova coluna **"Horário"**: mostra a data/hora de cada evento (o mesmo campo "Data / Hora da
  Partida"
  usado pelas checagens automáticas), numerada igual à coluna Eventos.
- Coluna **"ROI"** ocultada da tabela — a informação aposta por aposta não agregava muito;
  o ROI geral continua disponível no resumo da aba Lista e no cadastro/edição de cada aposta.

## v1.23.0 — 30/08/2026

### Nova funcionalidade: Checagem automática de resultados (API-Football)

- Novo botão **"🔎 Checar Resultados"** na aba Lista, ao lado de "Somente Abertas": consulta
  todas as apostas com status **Aberto**, busca o placar final dos jogos de **Futebol** via
  **API-Football** e sugere Ganhou/Perdeu/Ganho Parcial/Perda Parcial/Anulada por evento — sem
  aplicar nada automaticamente: cada sugestão só é gravada quando você toca em "✅ Aplicar" no
  painel de revisão que abre com os resultados.
- Novo campo opcional **"Data do Jogo"** em cada evento (diferente da Data/Hora da aposta, que é
  a data de *registro* do bilhete) — necessário para localizar o confronto certo na API. É
  preenchido automaticamente pela IA ao ler um bilhete novo (foto ou texto), ou pode ser digitado
  à mão em bilhetes já cadastrados.
- **Mercados cobertos nesta primeira versão:** Vencedor, Empate, Empate Anula (Draw No Bet),
  Chance Dupla, Gols (total de gols da partida, incluindo linhas de quarto como 2.25/2.75),
  Ambas Equipes Marcam, Handicap e Handicap Asiático (com resolução completa de linha de quarto,
  gerando Ganho Parcial/Perda Parcial quando a linha cai "no meio"), e Faixa de Gols.
- **Mercados fora do escopo por enquanto:** qualquer estatística que a API-Football não garanta
  no plano gratuito (Cartões, Escanteios, Finalizações, Faltas, Defesas, Desarmes, Impedimentos,
  estatísticas por tempo/quarto, "da Equipe", "Cada Equipe" etc.) e mercados combinados (mais de
  um mercado no mesmo evento) — esses aparecem no painel marcados como "não suportado", para
  marcação manual como sempre.
- **Só Futebol** é suportado por enquanto — outros esportes (Basquete, Tênis, Vôlei) ficam de
  fora até uma eventual integração com outra fonte de dados.
- Bilhetes **combinados (múltiplos eventos)**: só recebe sugestão de status geral quando todos os
  eventos da aposta forem resolvidos; se algum perder, a combinada inteira é sugerida como
  Perdeu (regra padrão); se todos ganharem ou todos anularem, sugere isso; qualquer mistura de
  resultados parciais fica sem sugestão automática, para revisão manual.
- **Economia de cota:** os eventos pendentes são agrupados por data — uma única chamada à
  API-Football cobre todos os jogos do mundo naquele dia, em vez de uma chamada por evento. O
  casamento com o time apostado é feito localmente, sem custo de requisição extra.
- **Configuração necessária (fora do app):** cadastrar a chave da API-Football como secret
  `API_FOOTBALL_KEY` no Worker (Cloudflare → Workers & Pages → Settings → Variables and Secrets),
  e rodar a migração `supabase_migracao_v1.23.0.sql` (adiciona a coluna `data_evento` em
  `banca_eventos`).
- Bilhetes já cadastrados antes desta versão não têm "Data do Jogo" preenchida e por isso não
  entram na checagem automática até esse campo ser preenchido manualmente ou o bilhete ser
  reimportado.

## v1.22.0 — 24/08/2026

### Nova funcionalidade: Painel de conferência da extração por IA

- Assim que a IA termina de preencher o formulário (por **Foto** ou por **Texto**), abre
  automaticamente uma janela sobreposta com todos os dados identificados, um por linha, num
  campo de texto somente leitura: Casa, ID, Data, Hora, Status e Stake no topo, seguidos de um
  bloco por evento (Esporte, Liga, Evento, Mercados, Seleção e ODD).
- Objetivo: permitir conferir tudo de uma vez, sem precisar navegar pelo formulário nem alternar
  entre abas para checar se cada campo foi preenchido corretamente.
- Campos com baixa confiança na leitura são marcados com "⚠️ conferir" ao final da linha, o mesmo
  critério já usado nos destaques do formulário.
- Janela persistente: só fecha pela tecla Esc ou pelo botão "✕"/"Fechar e revisar no formulário".
  Clicar fora dela não fecha, de propósito, para evitar fechamento acidental no meio da conferência.
- Foco automático ao abrir, para o leitor de tela (NVDA) anunciar o conteúdo assim que a janela
  aparece.
- Nenhuma mudança de banco de dados nesta versão.

## v1.21.1 — 23/08/2026

### Correção: atalhos Alt+ não funcionavam com teclado Bluetooth no iPhone/iPad

- **Causa raiz:** os atalhos globais (`Alt+1` a `Alt+5` para trocar de aba, e
  `Alt+A`, `Alt+L`, `Alt+S`, `Alt+G`, `Alt+P`, `Alt+E`, `Alt+X`) liam a tecla
  pressionada via `e.key`, que reflete o **caractere produzido**. No Windows
  isso não é problema, mas em teclados Apple a tecla Option — que faz o papel
  do Alt — **troca o caractere gerado** (ex.: Option+1 produz "¡", Option+G
  produz "©", Option+L produz "¬"). Resultado: nenhum atalho Alt+ funcionava
  no iPhone/iPad com teclado Bluetooth, mesmo com o VoiceOver não interceptando
  a combinação.
- **Correção:** todos os atalhos Alt+ agora leem `e.code` em vez de `e.key`.
  `e.code` identifica a **tecla física** (ex.: `"Digit1"`, `"KeyG"`) e não é
  afetado por nenhum modificador ou layout de teclado — o mesmo atalho
  funciona de forma idêntica no Windows/NVDA e no iPhone/iPad/VoiceOver.
- Nenhuma tecla de atalho mudou de lugar; apenas a forma de detectá-la.
- Atualizada a Wiki com uma nota explicando a compatibilidade com teclado
  Bluetooth no iPhone/iPad e o motivo pelo qual o Option+letra não conflita
  com o VoiceOver (cujo modificador padrão é Control+Option, não Option
  sozinho).
- Corrigida também uma menção residual a "Alt+0" na Wiki (seção Lista de
  Apostas) que não havia sido atualizada quando o atalho de Limpar Filtros
  passou a ser Alt+L, na v1.20.5.
- Nenhuma mudança de banco de dados nesta versão.

## v1.21.0 — 19/08/2026

### Nova funcionalidade: Histórico de Análises (IA)

- Toda vez que a **Análise de Aposta** (risco + estatística) é executada —
  pelo botão manual "🔍 Analisar Aposta" ou automaticamente após preencher
  por Foto/Texto — o resultado completo passa a ser guardado num histórico,
  em vez de existir só enquanto a tela de Cadastro estiver aberta.
- Novo card **"📜 Histórico de Análises (IA)"** em Configurações, com uma
  tabela listando cada análise por **Data**, **Hora** e **Confronto**
  (o(s) evento(s) analisados, ex.: "Time A - Time B" ou, em acumuladores,
  "Time A - Time B + Time C - Time D").
- Cada linha entra **retraída** por padrão. O botão **"🔽 Expandir análise"**
  (com `aria-expanded` e `aria-controls` corretos para leitor de tela) revela
  o texto completo da análise — nível de risco, resumo, alertas e a
  estatística por evento — na mesma formatação já usada na tela de Cadastro.
  "🔼 Recolher análise" esconde de novo.
- Botão **"🗑️ Remover"** em cada linha apaga aquela análise específica do
  histórico (com confirmação antes), sem afetar a aposta em si.
- **Vínculo com o bilhete:** a análise agora é salva junto com o
  Identificador do bilhete (o mesmo "ID" mostrado em toda a tela de Lista,
  ex.: "891N-YJRJI3") e, quando a aposta já está salva no banco (modo
  edição), também o id interno da aposta no Supabase — isso liga cada
  análise ao bilhete correspondente de forma inequívoca. O Identificador
  aparece diretamente dentro do texto da análise ("🎫 Bilhete: ..."), tanto
  na exibição imediata em Cadastro quanto no histórico expandido. Se a
  análise for feita antes do Identificador ser preenchido no formulário,
  fica salva sem esse vínculo (não há erro, só não aparece a linha do
  bilhete no texto).
- Implementado com uma tabela nova de verdade (`<table>`/`<tr>`/`<td>`),
  para a navegação por células do NVDA (Ctrl+Alt+Setas) funcionar
  normalmente mesmo nas linhas de detalhe expandidas.
- **Banco de dados:** nova tabela `banca_analises_ia` (`id`, `user_id`,
  `titulo`, `resultado` em JSONB com o texto completo da análise,
  `criado_em`, `aposta_id` — chave estrangeira para `banca_apostas.id`,
  `ON DELETE SET NULL` — e `identificador`), com RLS restringindo cada
  usuário às suas próprias análises.

## v1.20.6 — 16/08/2026

### Correção: erro ao excluir aposta (violação de chave estrangeira)

- **Bug:** ao excluir uma aposta, o app tentava apagar a linha em
  `banca_apostas` antes de apagar os eventos ligados a ela em
  `banca_eventos`, que dependem da aposta via chave estrangeira. O banco
  rejeitava a exclusão com `violates foreign key constraint
  "banca_eventos_aposta_id_fkey"`. Além disso, a aposta já tinha sido
  removida da tela antes da confirmação do banco, então ela sumia da lista
  mesmo com a exclusão falhando — e ao tentar salvar uma aposta nova com o
  mesmo Identificador, o app acusava `duplicate key value violates unique
  constraint "banca_apostas_user_identificador_unique"`, já que a aposta
  "excluída" continuava no banco.
- Corrigida a ordem de exclusão: os eventos da aposta agora são apagados
  antes da aposta em si.
- A aposta só é removida da lista na tela depois de confirmada a exclusão
  no banco — se a exclusão falhar, a aposta permanece visível e o erro é
  mostrado, evitando o estado "fantasma" (sumida da tela mas ainda no
  banco).
- **Banco de dados:** a chave estrangeira `banca_eventos_aposta_id_fkey`
  passou a ter `ON DELETE CASCADE`, como reforço — apagar uma aposta agora
  apaga automaticamente os eventos ligados a ela, mesmo em exclusões feitas
  fora da tela de apostas (ex.: função "Apagar Tudo", que tinha o mesmo
  problema em potencial).

## v1.20.5 — 15/08/2026

### Remoção do atalho Alt+L (Localizar por Identificador) e realocação do Alt+0 (Limpar Filtros)

- **Motivação:** o atalho `Alt+L`, que abria uma caixa para digitar o
  Identificador (ou parte dele) e localizar a aposta correspondente, nunca
  chegou a ser usado na prática — na única vez em que foi testado, não se
  mostrou útil o suficiente para justificar manter o código e a entrada na
  Wiki.
- Removida a função `localizarApostaPorIdentificador()` e toda a lógica do
  atalho `Alt+L` associada a ela, incluindo a referência no toast de aviso
  de "nenhuma aposta em foco".
- O atalho `Alt+0` (Limpar Filtros) foi remapeado para `Alt+L`, ocupando a
  tecla que ficou livre. Continua com o mesmo comportamento: limpa todos os
  filtros ativos sem trocar de aba nem tirar o foco de onde o usuário está.
- Atualizado `aria-keyshortcuts="Alt+L"` no botão "✕ Limpar Filtros" e a
  documentação da Wiki (tabela de atalhos e o texto sobre as três formas de
  definir a "aposta em foco", agora reduzido a duas: navegação por tabela do
  NVDA e Tab).
- Nenhuma mudança de banco de dados nesta versão.

## v1.20.4 — 14/08/2026

### Ajuste de acessibilidade: campos mais enxutos pra leitor de tela

- **Motivação:** o texto de ajuda embaixo da caixa de freebet (um parágrafo
  inteiro explicando a mecânica de financiamento misto) e o `aria-label`
  verboso do campo Observação atrapalhavam a fluidez de navegação por
  leitor de tela — cada campo deve trazer só o essencial pra identificá-lo;
  explicação e exemplo ficam reservados para a Wiki e o Changelog.
- Caixa "Envolve Freebet (Aposta Grátis)" renomeada de volta para só
  **"Aposta Grátis"**; removido o bloco de texto explicativo
  (`#ajudaApostaGratis`) e o `aria-describedby` associado.
- Campo derivado renomeado de "Valor do Freebet Usado" para **"Valor do
  Freebet"** (mais curto, mesmo campo/mesma função).
- Removidos os `aria-label` redundantes/verbosos dos campos Observação,
  Bônus e Cash Out — o `<label>` visível já identifica cada um; manter os
  dois duplicava a informação e alongava o que o leitor de tela lê a cada
  passagem pelo campo.
- Placeholder do campo Observação simplificado de uma lista de exemplos
  para apenas "Opcional".
- Nenhuma mudança de cálculo, banco de dados, ou nome de campo salvo — só
  texto de interface.

## v1.20.3 — 13/08/2026

### Correção: janela de erro roubava o foco ao marcar aposta como Perdeu

- **Motivação:** os botões rápidos ✓/✗ da lista usavam `type: 'error'` no
  toast só para pintar a notificação de vermelho ao marcar uma aposta como
  Perdeu ou Perda Parcial — mas `showToast` trata qualquer `type: 'error'`
  como um erro de verdade e abre a janela persistente `#erroGlobal`, que
  recebe foco automaticamente (`el.focus()`) e só fecha com clique manual
  em "Fechar". Resultado: marcar uma aposta como perdida (uma operação bem
  -sucedida, não um erro) roubava o foco do leitor de tela toda vez.
- **Correção:** novo tipo de toast `warning` — mantém a mesma cor vermelha
  na borda esquerda (`.toast.warning`), mas passa pelo toast comum (some
  sozinho, sem roubar foco), em vez de cair no tratamento especial de
  `type === 'error'`.
- Conferidos todos os outros usos de `type: 'error'` no código — são erros
  de verdade (campo vazio, valor inválido, falha ao salvar/reimportar),
  então continuam corretamente usando a janela persistente.
- Nenhuma mudança de banco de dados nesta versão.

## v1.20.2 — 13/08/2026

### Generalização: financiamento misto (freebet + dinheiro real)

- **Motivação:** as v1.20.0/v1.20.1 só cobriam apostas 100% financiadas por
  freebet (tudo ou nada). Mas na prática, a casa às vezes credita um freebet
  que não cobre o stake inteiro desejado, e o usuário completa com dinheiro
  próprio — um financiamento misto que a caixa booleana não conseguia
  representar.
- **Mudança de campo:** a caixa "Aposta Grátis" agora se chama **"Envolve
  Freebet"** e, quando marcada, revela um campo numérico **"Valor do Freebet
  Usado (R$)"** — vem pré-preenchido com o valor total do Stake (cobrindo o
  caso mais comum, 100% freebet, sem digitação extra), mas é editável pra
  informar só a parte que veio de freebet num financiamento misto.
- **Nova fórmula, universal para qualquer mistura (0% a 100% freebet), em
  todos os status:**
  `Lucro = Retornado − (Stake − Valor do Freebet Usado)`
  — o Retornado em si segue uma fórmula própria por status (ver Wiki,
  seção Cálculo Automático, para a tabela completa e a explicação de por
  que Perdeu e Perda Parcial não seguem a subtração simples).
- **Casos-limite conferidos:** com Valor do Freebet Usado = 0, a fórmula se
  reduz exatamente ao comportamento de uma aposta normal (sem mudança). Com
  Valor do Freebet Usado = Stake inteiro, reproduz exatamente o
  comportamento 100%-freebet da v1.20.0/v1.20.1. As fórmulas antigas
  passam a ser casos particulares da fórmula nova, não uma lógica à parte.
- **Migração de banco:** nova coluna `valor_freebet` (numeric, default 0)
  em `banca_apostas`. Registros já marcados como `aposta_gratis = true`
  foram migrados automaticamente com `valor_freebet = stake` (preserva o
  comportamento 100%-freebet que já tinham).
- `calcularSaldosPorCasa()` atualizado: agora subtrai apenas `stake −
  valor_freebet` da conta de "stake apostado" (a parte em dinheiro real),
  em vez de excluir o stake inteiro sempre que a aposta fosse freebet.
- Exportação e importação por Excel atualizadas com a nova coluna "Valor
  Freebet Usado".
- Todos os pontos que recalculam retorno/lucro (cálculo do formulário,
  salvar, botões rápidos ✓/✗ da lista, auditoria de cálculos, "Recalcular
  Precisão Decimal") foram atualizados para usar o valor numérico do
  freebet em vez do booleano.

## v1.20.1 — 11/08/2026

### Correção: lucro e saldo por casa com Aposta Grátis

- **Motivação:** a v1.20.0 corrigiu o valor de **retornado** de uma aposta com
  freebet (não devolver o stake ao ganhar), mas manteve a fórmula de **lucro**
  igual à de qualquer aposta normal (`retornado − stake`). Como o stake de um
  freebet nunca foi dinheiro real, subtraí-lo de novo no lucro contava esse
  "não-gasto" duas vezes — gerando lucro/unidades artificialmente baixos numa
  vitória (ex: odd 2,16 sobre freebet de R$10 dava lucro de apenas R$0,80 e
  0,16 unidade, quando o correto é R$5,80 e 1,16 unidade — o ganho real
  inteiro, já que nada foi gasto) e **lucro negativo numa Perda Parcial ou
  Anulada** com freebet, quando o correto ali é sempre zero.
- **Correção:** quando Aposta Grátis está marcada, `lucro` passa a ser igual a
  `retornado` em qualquer status que não seja Aberto — sem subtrair o stake.
- **Depósito fictício não é mais necessário.** Antes desta versão, a forma de
  fazer o saldo por casa bater era lançar um depósito manual do valor do
  freebet (compensando a subtração do stake na aposta). Isso deixou de ser
  necessário: `calcularSaldosPorCasa()` agora **não conta o stake de apostas
  marcadas como Aposta Grátis** na soma de "stake apostado", já que esse
  dinheiro nunca saiu do seu bolso. O retornado (já calculado sem devolver o
  stake) é a única entrada que precisa entrar na conta.
- **Ação recomendada:** remova depósitos fictícios já lançados para
  compensar freebets antigos — eles inflam o saldo calculado a partir de
  agora, já que a exclusão do stake por si só resolve o balanceamento.
- Nenhuma mudança de schema nesta versão.

## v1.20.0 — 10/08/2026

### Nova funcionalidade: Aposta Grátis (Freebet)

- Adicionada caixa de seleção **"Aposta Grátis (Freebet)"** logo abaixo do
  campo Stake, no formulário de cadastro. Quando marcada, o rótulo do campo
  muda para "Valor do Freebet (R$)" e o cálculo de retorno passa a considerar
  que a casa **não devolve o valor apostado** ao ganhar (regra padrão de
  freebet, conhecida como SNR — *Stake Not Returned*).
- **Motivação:** apostas financiadas por freebet vinham sendo calculadas
  como se fossem apostas normais (`stake × odd`), o que inflava o valor de
  retorno em exatamente o valor do freebet toda vez que a aposta ganhava —
  problema identificado ao reconciliar o saldo real da casa com o saldo
  calculado pelo app.
- **Como funciona o cálculo com Aposta Grátis marcada, por status:**
  - **Ganhou:** retorno = `(odd − 1) × valor do freebet` — só o lucro
    líquido, sem devolver o stake.
  - **Perdeu:** retorno = R$0,00 (sem mudança — já era assim).
  - **Ganho Parcial:** retorno = `(valor do freebet ÷ 2) × (odd − 1)` — a
    metade "devolvida" de uma aposta normal não existe em dinheiro real
    num freebet, e a metade paga segue a mesma regra do Ganhou.
  - **Perda Parcial:** retorno = R$0,00 — a metade que seria devolvida numa
    aposta normal também não é dinheiro real aqui.
  - **Anulada:** retorno = R$0,00 — cancelar um freebet não gera devolução
    em dinheiro real (diferente de uma aposta normal anulada, que devolve
    o stake integral).
  - **Cash Out:** sem mudança — o valor informado manualmente já é o valor
    real recebido, independente de ser freebet ou não.
- O estado da caixa é salvo por aposta (nova coluna `aposta_gratis` no
  Supabase) e é restaurado corretamente ao editar uma aposta já salva.
- Exportação e importação por Excel atualizadas com a nova coluna
  "Aposta Grátis" (valores "Sim"/"Não").
- **Migração de banco necessária:** `ALTER TABLE public.banca_apostas ADD
  COLUMN IF NOT EXISTS aposta_gratis BOOLEAN NOT NULL DEFAULT false;`
- **Fora do escopo desta versão:** a IA de leitura de bilhetes (worker.js)
  ainda não tenta detectar automaticamente se um bilhete é um freebet — a
  marcação continua manual por enquanto.

## v1.19.1 — 09/08/2026

**Nota:** esta versão reaplica correções que já haviam sido descritas na
entrada da v1.18.1 abaixo, mas que por algum motivo não chegaram a entrar no
código publicado no repositório (o texto do changelog estava lá, o código
não). Confirmado por conferência linha a linha antes desta entrega. Se você
notou que o sistema de correções aprendidas parecia "voltar a errar" mesmo
depois da v1.18.1, é por isso.

### Correções Aprendidas (IA) — bug no casamento de eventos

- Reaplicado: casamento de eventos pelo nome do confronto em vez da posição
  na lista (ver detalhes na entrada v1.18.1 abaixo).

### Correções Aprendidas (IA) — data atualizada ao reconhecer uma correção já existente

- Quando uma correção de Liga já registrada era reconhecida de novo num
  bilhete novo, o app não fazia nada — a data de criação da correção
  continuava a mesma de quando ela foi aprendida pela primeira vez. Como o
  teto de 60 (ver item acima) corta pelas correções mais recentes, um time
  que você aposta toda semana podia, mesmo sendo usado o tempo todo, ir
  ficando "velho" e acabar cortado do que é enviado à IA.
- Agora, ao reconhecer uma correção de Liga já existente, o app atualiza a
  data dela para agora — times realmente recorrentes se mantêm sempre entre
  os mais recentes, e só os que você não vê há tempo vão de fato envelhecendo
  e saindo do teto naturalmente.

### Migração de dados — correções de Liga já salvas convertidas para o formato por time

- As correções de Liga que já existiam no banco (salvas por confronto
  inteiro) foram migradas para o novo formato por time diretamente no
  Supabase, com backup das linhas originais guardado antes da migração
  (tabela `banca_correcoes_ia_liga_backup_20260810`). O total de linhas de
  Liga foi de 62 para 120 nesta migração — o mesmo confronto com dois times
  diferentes virou duas linhas — mas o ganho é de agora em diante: se
  qualquer um desses times voltar a aparecer contra um adversário novo, a
  correção já vai estar lá, sem gerar linha nova.

### Correções Aprendidas (IA) — Liga agora guardada por time, não por confronto

- Até aqui, cada correção de Liga era amarrada ao confronto inteiro (ex.:
  "Palmeiras - Internacional"). Isso fazia o mesmo time gerar uma linha nova
  a cada adversário diferente, mesmo sendo sempre o mesmo fato (a competição
  em que aquele time joga) — inflando a lista rapidamente e reduzindo na
  prática o alcance do teto de 60 correções enviadas à IA a cada leitura
  (ver item acima).
- Agora o contexto salvo é o nome de cada time do confronto, separadamente.
  A mesma correção de Liga passa a valer para qualquer adversário daquele
  time, sem precisar ser reaprendida — e se o mesmo time aparecer numa
  competição diferente da já registrada (ex.: uma copa em vez do
  campeonato nacional), uma segunda linha própria é criada, sem conflito.
- Correções de Liga já salvas antes desta versão continuam com o contexto
  antigo (confronto inteiro) até expirarem (~14 meses) ou serem editadas —
  não foram migradas automaticamente. Isso não causa nenhum problema, só
  reduz o efeito colateral até irem sendo naturalmente substituídas por
  novas correções no formato por time.

### Correções Aprendidas (IA) — correções de Mercado sendo empurradas para fora do envio à IA

- Corrigido bug em que o teto de 60 correções enviadas à IA a cada leitura de
  bilhete era compartilhado entre Liga e Mercado numa lista só, ordenada das
  mais recentes para as mais antigas. Como correções de Liga são criadas com
  muito mais frequência (cada confronto/temporada gera linhas novas) e
  correções de Mercado não têm prazo de validade, o volume de Liga acumulado
  ao longo do tempo empurrava correções de Mercado antigas — mas ainda
  válidas — para fora do que era efetivamente enviado à IA, mesmo continuando
  salvas no banco. Isso causava o efeito de "a IA esquece uma correção de
  mercado já treinada" conforme a lista crescia.
- Agora todas as correções de Mercado válidas são sempre enviadas por
  completo (o vocabulário de nomes de mercado de casa de apostas é pequeno e
  não deveria estourar prompt algum), e o teto de 60 passa a valer só para
  Liga.

### Correções Aprendidas (IA) — deduplicação ignorando maiúscula/espaçamento

- A checagem que evita salvar uma correção repetida comparava o texto errado
  e o texto corrigido de forma exata (letra por letra). Duas leituras da IA
  para o mesmo erro, mas com maiúscula ou espaçamento levemente diferentes
  (comum em leitura de foto), geravam uma linha nova a cada vez em vez de
  serem reconhecidas como a mesma correção já registrada — poluindo a lista
  em Configurações com quase-duplicatas ao longo do tempo.
- Agora a comparação usa a mesma normalização já usada em outros pontos do
  sistema (ignora maiúscula/espaçamento, e para Mercado também ignora a
  ordem dos itens num combo).

### Janela de erro persistente (nova, para todo erro do app)

- Reaplicado: toda mensagem de erro agora aparece numa janela fixa no topo
  da tela, com foco automático, botão de copiar e botão de fechar — em vez
  de sumir sozinha em poucos segundos (ver detalhes na entrada v1.18.1
  abaixo).

## v1.19.0 — 05/08/2026

### Filtro rápido "Somente Abertas" (Alt+A)

- Novo botão "🟢 Somente Abertas" no topo da aba Lista, com atalho de teclado
  `Alt+A`. Liga (ou desliga, se apertado de novo) o filtro de Status = Aberto
  direto na lista de apostas, sem precisar ir até a aba Filtros escolher no
  campo Status e depois voltar para a Lista para ver o resultado.
- Funciona de qualquer aba do app: se você não estiver na Lista quando aciona
  o atalho, ele já leva você para lá com o filtro aplicado.
- Mantém qualquer outro filtro já em uso (Casa, Tipster, Esporte, Liga,
  Mercado, datas, busca livre) — só liga/desliga o Status. O botão reflete o
  estado atual (`aria-pressed` e texto) mesmo quando o Status é alterado por
  outro caminho, como diretamente no `<select>` da aba Filtros ou pelo botão
  "Limpar filtros".
- Um aviso sonoro (leitor de tela) confirma quando o filtro é ligado ou
  desligado, e quantas apostas foram encontradas.

### Atalho para Limpar Filtros (Alt+0)

- Novo atalho de teclado `Alt+0`, que limpa todos os filtros ativos (Casa,
  Tipster, Tipo, Esporte, Liga, Mercado, Status, datas e busca livre) — mesmo
  efeito do botão "✕ Limpar Filtros" na aba Filtros, mas acionável de
  qualquer aba do app.
- Diferente do Alt+A, o Alt+0 **não** troca de aba nem tira o foco de onde
  você está — a lista é atualizada por baixo, pronta para quando você for
  até a aba Lista.

## v1.18.1 — 02/08/2026

### Correções Aprendidas (IA) — bug no casamento de eventos (correção deixava de aprender ou aprendia errado)

- Corrigido bug em que a comparação entre o que a IA sugeriu e o que foi
  efetivamente salvo (usada para memorizar correções de Liga/Mercado
  automaticamente) casava os eventos **pela posição na lista**, não pelo
  confronto em si. Sempre que um evento era removido ou adicionado manualmente
  no formulário antes de salvar (ex.: a IA leu um evento duplicado ou a mais),
  todos os eventos a partir dali ficavam comparados com o evento errado da
  extração — o que fazia o app aprender correções erradas (ruído na lista) ou
  deixar de aprender as certas, sem nenhum aviso.
- Agora o casamento é feito pelo **nome do confronto** (campo Evento), que já
  existe nos dois lados da comparação. Continua funcionando corretamente
  mesmo quando há dois eventos diferentes para o mesmo confronto (ex.: duas
  apostas distintas no mesmo jogo), casando cada um na ordem em que aparece.

### Janela de erro persistente (nova, para todo erro do app)

- Toda mensagem de erro (`showToast(..., 'error')`) agora aparece numa janela
  fixa no topo da tela em vez de um toast que some sozinho em poucos segundos.
  A janela recebe foco automaticamente (leitor de tela anuncia assim que ela
  aparece), fica visível até o usuário clicar em Fechar, e tem um botão para
  copiar o texto exato da mensagem de erro.
- Isso substitui, entre outros casos, o comportamento anterior do carregamento
  e da gravação de Correções Aprendidas (IA), que em caso de erro (ex.: falha
  de rede, RLS, tabela renomeada) só registrava um aviso no console do
  navegador — invisível para quem usa leitor de tela. Agora qualquer falha
  nesses dois pontos aparece visivelmente, com o motivo exato do Supabase.

## v1.18.0 — 31/07/2026

### Busca de Liga de Todos os Eventos de uma vez

- O botão individual "🔍 Buscar Liga" de cada evento foi substituído por um único
  botão "🔍 Buscar Liga de Todos os Eventos", ao lado de "Adicionar Evento". Ele
  busca a liga, um evento por vez (sequencialmente, com anúncio de progresso para
  leitor de tela via `aria-live`), de todos os eventos da aposta que tenham o nome
  do Evento preenchido e a Liga ainda vazia. Eventos que já têm Liga preenchida
  (lida certo ou já corrigida manualmente) são pulados e nunca sobrescritos por
  essa busca.
- O Esporte de cada evento agora é opcional para essa busca (`/api/buscar-liga`
  não exige mais `esporte` no corpo da requisição, só `evento`): se ainda não
  estiver definido no evento, a IA tenta identificá-lo a partir dos nomes dos
  competidores e do contexto encontrado na busca, e preenche o campo Esporte
  sozinha junto com a Liga. Se não conseguir confirmar o esporte com confiança,
  o evento fica marcado como não encontrado, sem chutar nada.
- A instrução de busca por data foi ajustada: como a aposta costuma ser
  registrada no mesmo dia do jogo ou com poucos dias de antecedência (raramente
  depois), a IA agora prioriza encontrar o confronto na data de referência do
  bilhete ou em dias seguintes próximos a ela, considerando uma data anterior só
  se não encontrar nada a partir da data de referência.

### Configurações — listas em tabela, com botão de Editar

- As listas de Casa, Tipster, Tipo, Esporte, Liga e Mercado, e a lista de
  Correções Aprendidas (IA), agora aparecem em formato de tabela (`<table
  role="grid">`, com cabeçalho fixo) em vez de "chips", com uma coluna de Ações.
- Cada linha ganhou um botão ✏️ Editar, além do 🗑️ Excluir que já existia — para
  corrigir um erro de digitação sem precisar excluir e recadastrar do zero. A
  edição usa `prompt()` nativo do navegador em vez de edição embutida na própria
  linha, por ser mais simples de manter e naturalmente bem compatível com leitor
  de tela, sem precisar de gerenciamento de foco customizado.
- Editar um valor de Casa, Tipster, Tipo, Esporte, Liga ou Mercado só renomeia a
  opção na lista de opções (`registrarCorrecaoIA`/tabela `opcoes` no Supabase) —
  apostas e eventos já salvos com o valor antigo não são alterados
  retroativamente, mesmo comportamento que o "Mover para" que já existia para
  itens órfãos de Liga/Mercado.
- Editar uma Correção Aprendida permite ajustar o valor errado, o valor correto
  e o contexto diretamente (`UPDATE` na tabela `correcoes_ia`), sem precisar
  excluir e a IA "esquecer" aquele aprendizado enquanto uma nova correção não é
  registrada do zero.

## v1.17.3 — 30/07/2026

### Busca de Liga por IA — prompt expandido (cache e acurácia)

- A Anthropic exige um tamanho mínimo de prompt (1.024 tokens no modelo
  `claude-sonnet-4-6` usado aqui) para o prompt caching funcionar de verdade —
  abaixo disso, o `cache_control` é ignorado silenciosamente, sem erro nem aviso.
  O `PROMPT_BUSCAR_LIGA` estava abaixo desse mínimo (~850 tokens estimados), então
  mesmo com o cache já configurado no código desde antes, provavelmente não estava
  sendo aproveitado nas chamadas reais. Isso é relevante porque a Busca de Liga está
  configurada para usar exclusivamente o provedor Anthropic (o Gemini não restringe
  domínio de busca de forma confiável o suficiente para esse caso específico), ou
  seja, é a rota que mais se beneficia de cache aqui.
- O prompt foi expandido com conteúdo que também melhora a acurácia da busca, não
  só o tamanho: exemplos reais de nomes de time ambíguos entre países/divisões
  (América, Nacional, Independiente, nomes de cidade genéricos que se repetem entre
  estados) e referência de nomenclatura oficial de divisão (sem nome comercial de
  patrocínio) para mais países além do Brasil — Inglaterra, Espanha, Itália,
  Alemanha, França, Portugal, Argentina. Isso levou o prompt para ~1.374 tokens
  estimados, com folga acima do mínimo exigido para o cache funcionar.

## v1.17.2 — 30/07/2026

### Correções Aprendidas — calibragem (bug de deduplicação de Liga)

- Corrigido bug em que uma correção de Liga (ex.: "Brasil - Série B" → "Brasil - Série A")
  só era realmente salva para o **primeiro** confronto corrigido. Correções seguintes para
  outros confrontos com o mesmo "de/para" (ex.: outro time promovido de divisão na mesma
  temporada) eram descartadas silenciosamente, porque a checagem de duplicidade em
  `registrarCorrecaoIA` não considerava o confronto (contexto), só o par de valores
  errado→correto.
- Agora, para correções de Liga, cada confronto (contexto) gera sua própria linha salva no
  Supabase, já que times diferentes promovidos/rebaixados são fatos independentes mesmo
  compartilhando o mesmo valor errado e o mesmo valor correto. Correções de Mercado
  continuam sem considerar o contexto, pois são padronização de nome e valem para qualquer
  confronto.
- As correções agora são enviadas à IA das mais recentes para as mais antigas (antes eram
  enviadas na ordem de criação no banco), para que o teto de 60 correções por leitura não
  descarte as mais relevantes à medida que a lista cresce.
- Reforçada a instrução enviada à IA (`worker.js`) para correções de Liga: quando o contexto
  do bilhete bater com uma correção já confirmada, ela deve prevalecer mesmo que o
  conhecimento de treinamento da IA "pareça" indicar outra coisa — times sobem e descem de
  divisão entre temporadas, e o conhecimento memorizado pode estar desatualizado.

### Correções Aprendidas — não salva diferenças que não são correções de verdade

- Quando o único ajuste feito num campo (Liga ou Mercado) é maiúscula/minúscula ou
  espaçamento (ex.: "Chutes no Gol da Equipe" → "Chutes no gol da equipe"), o app não
  salva mais isso como correção aprendida em `registrarCorrecaoIA`. Esse tipo de
  diferença já é tratado como o mesmo valor pelo app (mesma lógica de normalização
  usada por `buscarOuPrepararValor` para evitar duplicar itens no catálogo), então
  registrar como correção só gerava ruído na lista sem ganho nenhum de precisão.
- Para Mercado combinado (ex.: "Gols, Chutes no gol do jogador"), a IA lista os itens na
  ordem em que aparecem no bilhete (regra explícita do `worker.js`) — que pode variar de
  bilhete pra bilhete mesmo sendo o mesmo conjunto de mercados. `registrarCorrecaoIA`
  agora compara mercados combinados ignorando a ordem dos itens, então "Gols, Chutes no
  gol do jogador" e "Chutes no gol do jogador, Gols" (qualquer permutação do mesmo
  conjunto) também não geram mais uma correção aprendida.

### Mercado "Ambas as equipes receberão cartão" (BTTC)

- Esse mercado nunca tinha sido mapeado nas regras de leitura de bilhete (`worker.js`) — a
  IA precisava "adivinhar" o nome do mercado e o formato da seleção a cada leitura, o que
  gerava resultados inconsistentes entre bilhetes (incluindo um caso em que inventou um
  valor de referência "1.5 cartões" que não existe nesse mercado, que é binário Sim/Não).
- Agora é mapeado de forma fixa para o mercado "Cartões" já existente, com seleção sempre
  no formato "Ambas as equipes recebem cartão - Sim" ou "Ambas as equipes recebem cartão -
  Não".

## v1.17.0 — 29/07/2026

### Provedor de IA configurável, por funcionalidade

- Nova seção **"🤖 Provedor de IA"** em Configurações, com um seletor para cada uma das três
  funcionalidades que usam IA no app: **Leitura de bilhete** (foto e texto), **Análise de Aposta**
  (busca de estatísticas) e **Busca de Liga**. Cada uma pode ser configurada de forma independente
  para usar:
  - **Ambas** (padrão): mantém o comportamento original do app — tenta o Gemini primeiro (grátis)
    e, se ele falhar, cai automaticamente para a Anthropic.
  - **Somente Gemini**: usa só o Gemini. Se falhar, a ação falha também — não tenta a Anthropic.
  - **Somente Anthropic**: usa só a Anthropic diretamente, sem passar pelo Gemini.
- A preferência fica salva neste dispositivo/navegador (igual à paginação da Lista e à análise
  automática), não é um dado da conta sincronizado entre aparelhos.
- No Worker, a rota correspondente (`/api/ler-bilhete`, `/api/analisar-aposta` ou
  `/api/buscar-liga`) recebe a preferência a cada chamada e decide o fluxo: nenhuma mudança na
  lógica de extração/análise em si, só em qual(is) provedor(es) são tentados e em que ordem.
- Se a preferência escolhida for "Somente Gemini" ou "Somente Anthropic" e a respectiva chave de
  API não estiver configurada no Cloudflare (`GEMINI_API_KEY`/`ANTHROPIC_API_KEY`), ou se o
  provedor escolhido falhar, o app mostra um erro explicando exatamente isso — em vez de cair
  silenciosamente para o outro provedor sem avisar.

## v1.16.0 — 27/07/2026

### Busca de Liga por IA — melhorias de precisão
- A busca agora leva em conta a data/hora do registro da aposta (campo Data/Hora) como
  referência de temporada — importante porque um time pode ter mudado de divisão entre a
  época do confronto e hoje. Sem essa data, a IA já era instruída a não confiar apenas no
  nome do time; com ela, a busca fica mais precisa para apostas antigas.
- No fallback Anthropic (usado quando o Gemini falha), a busca é restrita de verdade às
  fontes sofascore.com e 365scores.com. No provedor principal (Gemini), a API pública não
  permite restringir a busca a domínios específicos (só excluir) — o prompt instrui o
  modelo a priorizar essas fontes quando possível, mas sem garantia, já que a ferramenta de
  busca do Gemini decide sozinha onde pesquisar.

### Correções Aprendidas — validade por prazo (Liga)
- Correções de **Liga** aprendidas a partir de leituras de bilhete agora expiram depois de
  ~14 meses e deixam de ser enviadas à IA automaticamente — um time pode ter sido corrigido
  de uma divisão para outra numa temporada e voltar a mudar na seguinte, então uma correção
  antiga poderia levar a IA a repetir o erro no sentido contrário.
- Correções de **Mercado** continuam valendo indefinidamente (é só padronização de nome, não
  muda com o calendário esportivo).
- Na lista de Correções Aprendidas (Configurações), uma correção de Liga vencida agora mostra
  um aviso explicando que não está mais sendo usada, para você decidir se quer excluí-la.

## v1.15.0 — 27/07/2026

### Busca de Liga por IA (preenchimento manual de apostas antigas)
- Novo botão **"🔍 Buscar Liga"** ao lado do campo Liga de cada evento, na tela de Cadastro.
  Útil ao preencher manualmente uma aposta antiga: com o Esporte e o nome do Evento
  (ex: "Time A x Time B") já digitados, a IA pesquisa na web em qual liga/competição
  aquele confronto foi disputado e preenche o campo sozinha.
- Reaproveita a mesma infraestrutura de busca real na web (Gemini com grounding, com
  fallback para Anthropic) já usada em "🔍 Analisar Aposta" — nunca inventa uma liga:
  se não encontrar o confronto com confiança razoável, avisa e deixa o campo como estava.
- Se a liga encontrada já existe na lista cadastrada, ela é selecionada normalmente; se
  for nova, o campo entra automaticamente no modo "✏️ Outro (digitar)…" já preenchido,
  para você conferir e confirmar antes de salvar.
- Uso registrado em um contador próprio no Supabase (`increment_ai_calls_liga`), separado
  das estatísticas de "Analisar Aposta" e do leitor de bilhete.

### Filtros — busca livre ampliada
- O campo de busca da aba Filtros (antes restrito a ID e Evento) agora compara o termo
  digitado contra qualquer campo relevante da aposta: Casa, Tipster, Tipo, Status,
  Observação e, dentro de cada evento, Esporte, Liga, Mercado e Seleção.

### Filtros — Liga e Mercado dependentes do Esporte
- Ao escolher um Esporte no filtro, os combos de Liga e Mercado passam a mostrar só as
  opções cadastradas para aquele esporte, no mesmo padrão já usado na tela de Cadastro —
  antes, esses dois combos sempre listavam todas as ligas/mercados cadastrados, de
  qualquer esporte.

## v1.14.0 — 26/07/2026

### Campo livre "Outro (digitar)" — Esporte, Liga e Tipster
- Os combos de **Esporte** e **Liga** (por evento) e de **Tipster** (na aposta) ganharam
  uma opção extra ao final da lista: **"✏️ Outro (digitar)…"**. Ao escolher essa opção,
  aparece um campo de texto para digitar o valor manualmente — útil para ligas, esportes
  ou tipsters que você vai usar quase nunca e não quer deixar cadastrados de forma
  permanente nas listas.
- O valor digitado é salvo normalmente na aposta (é o que aparece na Lista, nos Filtros
  e na Análise de Aposta), só não entra na lista de opções reaproveitáveis.
- Ao editar uma aposta cujo Esporte, Liga ou Tipster foi preenchido dessa forma (ou que
  não existe mais na lista atual por qualquer motivo), o campo volta automaticamente para
  o modo "Outro" com o texto original preenchido, em vez de aparecer em branco.
- Trocar o Esporte de um evento limpa o texto livre de Liga digitado anteriormente, já que
  ele deixou de fazer sentido para o novo esporte escolhido.

### Tela de Preenchimento — remoção de itens
- Os botões "−" de remover Casa, Tipster, Tipo, Esporte, Liga e Mercado foram retirados da
  tela de Cadastro (Preenchimento). A remoção desses valores das listas continua disponível
  normalmente em **Configurações → Gerenciar Listas**, sem nenhuma perda de funcionalidade —
  a ideia é só evitar remover algo sem querer no meio do preenchimento de uma aposta.

## v1.13.3 — 25/07/2026

### Correção — Lista de Apostas
- Corrigido: ao marcar uma aposta como Ganhou/Perdeu/Ganho Parcial/Perda Parcial/Cash Out/Anulada
  pela aba Lista (botões ✓/✗ ou atalhos `Alt+G`/`Alt+P`), a aposta agora **some da tela na hora**
  se ela deixou de atender aos filtros ativos — por exemplo, com o filtro "Status: Aberto" ativo,
  marcar uma aposta como Ganhou a remove imediatamente da lista exibida, sem precisar reaplicar o
  filtro manualmente ou trocar de aba. Antes, a aposta só era atualizada visualmente (novo status,
  lucro, etc.) mas continuava na lista até o filtro ser reaplicado.
- A lógica de checagem dos filtros (Casa, Tipster, Tipo, Esporte, Liga, Mercado, Status, intervalo
  de datas, busca por ID/Evento) foi extraída para uma função reutilizável, garantindo que a
  verificação usada ao marcar um status seja idêntica à usada em "Filtros".

## v1.13.2 — 24/07/2026

### Correção de bug importante — Análise de Aposta (integridade dos dados)
- Corrigido um problema sério: quando a busca real não estava disponível (ver
  v1.13.1) e o Gemini respondia no modo "sem busca", o modelo por vezes
  **inventava** números que pareciam estatísticas reais (médias de gols/
  finalizações, forma dos times) mesmo sem ter pesquisado nada — violando a
  própria instrução de "nunca invente uma estimativa sem base real".
- Agora isso é impedido de duas formas: (1) uma instrução extra e explícita é
  enviada ao modelo nesse modo, proibindo qualquer número; e principalmente
  (2) o próprio código do Worker **sobrescreve à força** qualquer estimativa
  recebida nesse cenário, independente do que o modelo tenha escrito —
  garantindo que nenhuma estatística "alucinada" chegue até o usuário como se
  fosse dado real pesquisado.
- Reforço adicional: mesmo quando a busca é aceita como bem-sucedida (sem
  erro), o Worker agora confere se há evidência real de que uma pesquisa foi
  executada (metadados de grounding no Gemini, ou bloco de resultado de busca
  na Anthropic). Se essa evidência não existir, a resposta é tratada como "sem
  busca" e passa pela mesma sanitização — mesmo numa chamada que "deu certo".

## v1.13.1 — 23/07/2026

### Correção de bug — Análise de Aposta
- A correção anterior (v1.13.0) só tentava o próximo modelo Gemini quando o
  **primeiro** candidato falhava com erro 400 e a busca estava ativada — mas se
  **todos** os modelos candidatos não suportassem a ferramenta de busca no
  momento, o Worker ainda caía no fallback pago da Anthropic, que falhava sem
  crédito configurado. Agora, se nenhum modelo Gemini conseguir responder com
  busca ativada, o Worker tenta os mesmos modelos **mais uma vez sem a busca**
  (ainda gratuito) antes de considerar ir para a Anthropic.
- Quando isso acontece, a análise ainda é gerada (nível de risco, alertas,
  probabilidade implícita da odd), só sem a estimativa por estatística real —
  e o painel agora mostra um aviso claro de que a busca não pôde ser feita
  desta vez, em vez de simplesmente mostrar "sem dados suficientes" em todos
  os eventos sem explicação.
- Se mesmo assim tudo falhar (Gemini indisponível e Anthropic sem crédito), a
  mensagem de erro agora inclui o detalhe real do erro do Gemini junto com o
  da Anthropic, para diagnóstico sem precisar acessar os logs do Cloudflare.

## v1.13.0 — 23/07/2026

### Correções Aprendidas (IA) — nova funcionalidade
- O app agora **memoriza correções de Liga e Mercado**: sempre que a IA erra esses
  campos numa leitura de bilhete e o usuário corrige manualmente antes de salvar, a
  correção é gravada automaticamente (nova tabela `correcoes_ia` no Supabase, com
  RLS por usuário). Não é preciso fazer nada diferente — basta continuar corrigindo
  o campo errado como já se fazia.
- Nas próximas leituras de bilhete (foto ou texto), essas correções são enviadas
  junto para o Gemini/Anthropic como preferências já confirmadas pelo usuário, para
  a IA priorizar em vez de repetir a mesma inferência errada quando o contexto
  combinar (mesmos times, mesma liga/competição).
- Nova seção em **Configurações → 🧠 Correções Aprendidas**: lista todas as
  correções salvas com o valor errado, o valor correto e o contexto, com opção de
  remover individualmente ou apagar todas de uma vez.

### Leitor de Bilhete (IA) — correções de prompt
- **Bônus (Superbet)**: promoções do tipo "SUPERMÚLTIPLA" (formato
  `SUPERMÚLTIPLA<percentual>%<valor>R$` no rodapé do bilhete) agora são
  identificadas e preenchidas no campo Bônus do formulário. Esse campo nunca
  tinha sido conectado à extração por IA antes — agora está.
- **Handicap Asiático (Betano)**: quando o bilhete exibe um texto do tipo
  "Resultado atual: 0-0" junto à condição do handicap, isso não é mais copiado
  para o campo Observação — é só um indicador de referência do mercado, não um
  resultado real da aposta.
- **Mercado "Ficar à Frente do Placar" (Superbet)**: corrigido o mapeamento — esse
  mercado agora é reconhecido corretamente como "Placar" (com a seleção no formato
  "<Time> - Ficar à Frente do Placar"), em vez de cair incorretamente em "Criador
  de Apostas".

### Correção de bug — Análise de Aposta
- Corrigido um bug no fallback entre modelos do Gemini na rota de Analisar Aposta:
  quando o primeiro modelo candidato retornava erro 400 (típico de modelos que não
  suportam a ferramenta de busca/grounding, como variantes "lite"), o Worker
  abandonava o Gemini por completo e caía direto no Anthropic — o que podia falhar
  se não houvesse crédito configurado na chave da Anthropic, mesmo com o Gemini
  ainda tendo outros modelos candidatos capazes de atender o pedido. Agora, com a
  busca ativada, um erro 400 também aciona a tentativa do próximo modelo candidato
  antes de desistir do Gemini.

## v1.12.0 — 23/07/2026

### Analisar Aposta (IA)
- A análise de aposta agora usa **busca real na web** (Google Search via Gemini, com
  fallback para a ferramenta de busca da própria Anthropic) para pesquisar estatísticas
  reais e recentes de cada evento — médias de gols, forma dos times, confrontos diretos
  — em vez de só calcular a probabilidade implícita da ODD.
- Para cada evento da aposta, o painel agora mostra lado a lado a **Probabilidade
  Implícita** (calculada a partir da ODD) e a **Estimativa por Estatística** (baseada
  nos dados reais encontrados na busca), com uma breve explicação da base usada.
- Quando a busca não encontra dados estatísticos suficientes e confiáveis para um
  evento (times menores, ligas obscuras, mercados muito específicos), o painel mostra
  claramente "sem dados suficientes" — a IA nunca inventa um número nesses casos.
- Como a busca leva mais tempo (aprox. 10 a 20 segundos a mais) e consome mais cota das
  chaves de API, novo controle em **Configurações → 🔍 Análise de Aposta (IA)**: caixa
  de verificação "Analisar automaticamente após preencher por Foto/Texto", ligada por
  padrão. O botão manual "🔍 Analisar Aposta" continua disponível a qualquer momento,
  independente dessa preferência (salva neste dispositivo/navegador).
- Texto do botão durante a análise atualizado para "⏳ Pesquisando estatísticas..." para
  deixar claro que a IA está pesquisando na web, não apenas processando localmente.

## v1.11.1 — 22/07/2026

### Leitor de Bilhete (IA)
- O nome do confronto no campo **Evento** agora é montado com hífen entre os nomes dos times
  (ex.: `Grêmio - Atlético-GO`), em vez do "x" usado até então (ex.: `Grêmio x Atlético-GO`).
  Ajustado tanto na regra geral quanto nos exemplos internos do prompt (Betano e Superbet,
  foto e texto). Vale para leituras novas feitas a partir desta versão — bilhetes já
  cadastrados anteriormente com "x" não são alterados automaticamente.

## v1.11.0 — 20/07/2026

### Manutenção de Cálculos (Configurações)
- Novo card **"🔍 Auditoria de Cálculos"** na aba Configurações. Recalcula o retorno e o lucro de
  cada aposta salva usando a fórmula atual (`calcularRetornoLucro`) e compara com os valores
  gravados no banco, apontando divergências — por exemplo, apostas salvas com uma versão antiga
  da fórmula (antes de Ganho Parcial, Perda Parcial ou Cash Out existirem) ou editadas
  manualmente. Só leitura: não altera nenhum dado, apenas mostra o resultado inline na própria
  aba (região `aria-live`, sem modal e sem roubar o foco do leitor de tela).
- Novo card separado **"🎯 Precisão Decimal"**, com o botão **"🎯 Recalcular Precisão Decimal"**:
  recalcula odd total, retornado, lucro, unidades e ROI de todas as apostas com precisão de até
  4 casas decimais, eliminando ruído de ponto flutuante acumulado em cálculos e importações
  antigas. Regrava no banco apenas as apostas cujo valor realmente mudou, em lotes com progresso
  mostrado no toast — mesma estratégia de concorrência controlada já usada na reimportação de
  planilha.
- Confirmado que a rotina de cálculo de saldo por casa (`calcularSaldosPorCasa`) é feita
  inteiramente no `index.html`; o `worker.js` não participa desse cálculo (só compõe os prompts
  do leitor de bilhete por IA), então não precisou de nenhuma alteração nesta atualização.

### Precisão nos totais do resumo do filtro
- Os totais agregados do resumo (Stake Total, Lucro, Unidades, ROI, % Acerto) agora passam por um
  arredondamento de até 4 casas decimais antes de serem exibidos, eliminando ruído de ponto
  flutuante que somas sucessivas de muitas apostas podiam gerar (ex.: algo como
  `149.99999999999997` exibido como `150,00` por acaso, mas guardando o ruído internamente).

### Guia de Uso (wiki.html)
- Nova seção "🧮 Manutenção de Cálculos" documentando os dois botões novos, com link na barra
  lateral logo abaixo de "Recarregar Aplicativo".

## v1.10.0 — 19/07/2026

### Leitor de Bilhete (IA)
- Novo botão **"🔍 Analisar Aposta"**, ao lado de "Preencher por Foto" e "Preencher por
  Texto", na aba Cadastro. Envia os dados atualmente preenchidos no formulário (casa,
  stake, eventos, odds, saldo atual da casa quando disponível) para a IA e devolve uma
  análise objetiva de **risco e contexto** — nunca uma previsão de resultado do jogo.
- A análise mostra um nível de risco (Baixo/Médio/Alto), um resumo em linguagem simples
  explicando a probabilidade implícita da ODD e o que está sendo apostado, e uma lista de
  alertas objetivos: acumuladores com muitos eventos, stake alto em relação ao saldo da
  casa, odds muito baixas ou muito altas, e inconsistências nos dados preenchidos.
- Roda automaticamente logo após a IA terminar de preencher o formulário via foto ou
  texto (sem bloquear a tela), e também pode ser acionada manualmente a qualquer momento
  pelo botão, útil para conferir a análise depois de editar algum campo.
- Nova rota `/api/analisar-aposta` no Worker, reaproveitando a mesma estratégia de
  provedor já usada no leitor de bilhete (Gemini primeiro, com fallback automático para
  Anthropic Claude).

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
