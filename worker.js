// ==================== WORKER CLOUDFLARE: LER BILHETE ====================
// Aceita dois modos de entrada:
//   1. imagemBase64 + mediaType  → lê uma foto/print do bilhete
//   2. textoBilhete              → lê texto colado copiado da casa
//
// ESTRATÉGIA DE PROVEDOR: tenta Gemini primeiro (grátis), e só usa a
// Anthropic (paga) se o Gemini falhar (erro, rate limit, resposta inválida).
//
// As chaves de API NUNCA ficam no navegador — vivem só aqui, no servidor,
// lidas das variáveis de ambiente GEMINI_API_KEY e ANTHROPIC_API_KEY
// configuradas no painel do Cloudflare (Workers & Pages → seu Worker →
// Settings → Variables and Secrets), cadastradas como Secret.
//
// Este arquivo é o "main" do Worker (ver wrangler.jsonc). Ele intercepta
// apenas a rota /api/ler-bilhete; qualquer outra URL é entregue normalmente
// pelos arquivos estáticos do site (binding "ASSETS").

// ---- SCHEMA JSON comum aos dois prompts ----
const SCHEMA_JSON = `
{
  "casa": "string ou null (nome da casa de apostas, ex: Betano, Superbet, Betfair)",
  "identificador": "string ou null (número/código do bilhete, se visível)",
  "dataHora": "string no formato AAAA-MM-DDTHH:MM ou null (ver regra DATA DE REGISTRO abaixo)",
  "stake": "number ou null (valor apostado, só o número, sem moeda)",
  "status": "uma destas strings ou null: Aberto, Ganhou, Perdeu, Ganho Parcial, Perda Parcial, Cash Out, Anulada",
  "observacao": "string ou null (placar final ou resultado, se visível)",
  "eventos": [
    {
      "esporte": "string (ex: Futebol, Basquete, Tênis, Vôlei)",
      "liga": "string ou null (nome do campeonato/liga)",
      "evento": "string (nome do confronto, ex: Time A x Time B)",
      "mercado": "string — um nome da lista de mercados cadastrados (ver MAPEAMENTO DE MERCADOS). Se o evento combinar VÁRIAS condições cujos mercados são todos reconhecidos na lista, use os nomes reconhecidos separados por ', ' (ex.: \"Gols, Escanteios\") em vez de 'Criador de Apostas' — ver regra CRIADOR DE APOSTAS abaixo.",
      "selecao": "string (a seleção escolhida, ex: nome do time, Mais de 2.5, etc.)",
      "odd": "number (a odd daquele evento)",
      "confianca": "number entre 0 e 1, sua confiança nessa leitura específica",
      "confiancaLiga": "number entre 0 e 1, confiança específica do campo liga"
    }
  ],
  "confiancaGeral": {
    "casa": "number entre 0 e 1",
    "identificador": "number entre 0 e 1",
    "dataHora": "number entre 0 e 1",
    "stake": "number entre 0 e 1",
    "status": "number entre 0 e 1"
  }
}`;

// ---- REGRAS COMUNS aos dois modos ----
const REGRAS_COMUNS = `
Regra especial — DATA DE REGISTRO DO BILHETE (não confundir com a data do jogo):
- Um bilhete normalmente contém DUAS datas distintas:
  1. Data/hora do JOGO (quando a partida acontece) — aparece junto ao nome do evento.
  2. Data/hora de REGISTRO (quando a aposta foi feita) — é o que deve ir no campo "dataHora".
- Exemplos de como a data de registro aparece em cada casa:
  • Betano (imagem): a data de registro fica na MESMA LINHA que o ID, no rodapé do bilhete, no formato "DD/MM/AAAA - HH:MM". Exemplo real: "ID: 20533211949   01/07/2026 - 09:58" — o identificador é "20533211949" e a data de registro é "2026-07-01T09:58". Não há texto "Criado em" na Betano — a data simplesmente aparece ao lado do ID.
  • Betano (texto colado): a data de registro fica logo abaixo do ID, no formato "DD/MM/AAAA - HH:MM". Ex: ID: 6416780725 → 26/10/2024 - 11:29.
  • Superbet (imagem, site/desktop): aparece no rodapé após "Criado em", no formato "DD de MÊS de AAAA — HH:MM". Ex: "Criado em 30 de jun. de 2026 — 10:48".
  • Superbet (imagem, app mobile — tela "Cupom de Aposta"): o identificador e a data ficam lado a lado num cartão de resumo, SEM o texto "Criado em". Formato: "XXXX-XXXXXXX" à esquerda e "DD MMM. AAAA — HH:MM" à direita, na mesma linha. Exemplo real: "892N-1QNSK9" e "07 jul. 2026 — 10:38" — identificador "892N-1QNSK9", dataHora "2026-07-07T10:38". Esse cartão de resumo costuma ficar no fim da tela (role para baixo); se o print mostrar só os eventos e não esse cartão, deixe identificador e dataHora como null.
  • Superbet (texto colado): a data de registro fica logo abaixo do código identificador, no formato "D DE MÊS DE AAAA — HH:MM". Ex: 890I-QD3MXC → 1 DE JUL. DE 2026 — 09:56.
- Se não encontrar a data de registro com clareza, deixe "dataHora" como null — não use a data do jogo.

Regra especial — IDENTIFICADOR DO BILHETE:
- Betano: vem com rótulo explícito "ID:" seguido de número longo. Ex: ID: 6416780725.
- Superbet: código sem rótulo no padrão XXXX-XXXXXX (4+ chars, hífen, 4+ chars). Ex: 890I-QD3MXC, 892N-1QNSK9.
- No app mobile da Superbet, ignore textos técnicos de rodapé que pareçam UUID (ex: "1B4BAD59-FF6F-4611-A95B-3CEE4DF34F76") ou strings de versão de app/sistema (ex: "BrazilSport/2607011314 CFNetwork/3860.600.12 Darwin/25.5.0") — isso é informação de depuração do aplicativo, não é o identificador do bilhete.
- Outras casas: use o bom senso para identificar códigos que claramente servem como referência do bilhete.

Regra especial — STATUS (não confundir opção de Cashout com status Cash Out):
- Use o rótulo explícito "STATUS" (ou equivalente) quando ele existir no bilhete — é a fonte de verdade. Ex.: "STATUS: ATIVO" → status "Aberto".
- A presença de um botão "CASHOUT" disponível/verde NÃO significa que a aposta foi encerrada por cashout — é apenas uma opção oferecida enquanto a aposta está em aberto. Só use o status "Cash Out" se houver indicação explícita de que o cashout foi efetivamente realizado (ex.: texto "Cashout realizado", "Encerrada por cash out", ou status explícito diferente de "Ativo"/"Aberto").
- Da mesma forma, valores como "Valor do Cashout" e "Lucro" exibidos junto ao botão são apenas uma simulação do que seria pago SE o usuário optasse por sacar agora — não indicam o resultado real da aposta.

Regra especial — LIGA:
- Se a liga estiver escrita explicitamente no bilhete (como na Superbet), copie-a exatamente e use confiancaLiga alta (0.85-1.0).
- Se a liga não estiver escrita, tente inferir pelo seu conhecimento sobre os times e a data do jogo. Use confiancaLiga baixa (0.3-0.5) para indicar que foi inferida. Se não tiver confiança mínima, deixe liga como null e confiancaLiga próxima de 0.

Regra especial — MAPEAMENTO DE MERCADOS:
O sistema já tem os seguintes mercados cadastrados. Quando o bilhete mostrar um mercado, use SEMPRE o nome correspondente desta lista — não invente nomes novos nem use o nome exato do bilhete se houver um equivalente aqui.

FUTEBOL:
"Ambas equipes Marcam" → quando o bilhete diz: Ambas Marcam, BTTS, Ambos Marcam
"Arremessos Laterais" → quando o bilhete diz: Laterais, Total de Arremessos Laterais
"Campeão" → quando o bilhete diz: Vencedor do Torneio, Campeão do Torneio
"Cartões" → quando o bilhete diz: Total de Cartões, Cartões Amarelos, Cartões Totais
"Chance Dupla" → quando o bilhete diz: Dupla Hipótese, Double Chance
"Chance Dupla & Total de Gols" → quando o bilhete diz: Chance Dupla e Gols, Double Chance e Total de Gols
"Chutes no gol" → quando o bilhete diz: Chutes, Finalizações ao Gol, Remates no Gol
"Chutes no gol do jogador" → quando o bilhete diz: Chutes no Alvo do Jogador, Finalizações ao Gol do Jogador, Jogador - Chutes no Gol
"Classificar" → quando o bilhete diz: Se Classificar, Avançar, Classificação
"Criador de Apostas" → quando o bilhete diz: CRIAR APOSTA, Bet Builder, Aposta Personalizada, Combinada (criador de apostas de um único confronto)
"Defesas" → quando o bilhete diz: Total de Defesas, Defesas do Goleiro
"Desarmes" → quando o bilhete diz: Total de Desarmes, Tackles
"Empate" → quando o bilhete diz: Empate Puro (apenas empate como mercado isolado)
"Empate Anula" → quando o bilhete diz: Empate Anula Aposta, Draw No Bet, EAA
"Equipe Com Mais Escanteios" → quando o bilhete diz: Mais Escanteios, Equipe com Mais Cantos
"Equipe Com Mais Finalizações" → quando o bilhete diz: Mais Finalizações, Equipe com Mais Chutes
"Escanteios" → quando o bilhete diz: Total de Escanteios, Cantos, Total de Cantos — APENAS o total da PARTIDA (ambos os times), SEM nome de time antes. Se vier como "<Time> - Total de Escanteios", veja a regra GOLS/ESCANTEIOS/FINALIZAÇÕES POR TIME abaixo.
"Faixa de gols" → quando o bilhete diz: Intervalo de Gols, Faixa de Resultado em Gols
"Faltas" → quando o bilhete diz: Total de Faltas, Faltas Cometidas
"Finalizações" → quando o bilhete diz: Total de Finalizações, Total de Chutes, Chutes Totais, Finalizações Totais, Chutes (Betano), Total de Finalizações (Superbet) — APENAS o total da PARTIDA, SEM nome de time antes. Se vier como "<Time> - Total de Finalizações", veja a regra GOLS/ESCANTEIOS/FINALIZAÇÕES POR TIME abaixo.
"Ganhar qualquer um dos Tempos" → quando o bilhete diz: Ganhar Algum Tempo, Vencer Pelo Menos Um Tempo
"Gols" → quando o bilhete diz: Total de Gols, Total de Gols Mais/Menos (Betano), Total de Gols (Superbet), Mais/Menos Gols, Over/Under Gols — APENAS quando for o total de gols da PARTIDA (ambos os times somados), SEM nome de time antes. Se vier no formato "<Time> - Total de Gols", NÃO é este mercado — veja a regra GOLS/ESCANTEIOS/FINALIZAÇÕES POR TIME abaixo.
"Handicap" → quando o bilhete diz: Handicap Europeu, Handicap de Resultado
"Handicap Asiático" → quando o bilhete diz: Asian Handicap, AH
"Handicap de chutes no gol" → quando o bilhete diz: Handicap de Chutes, Handicap de Finalizações ao Gol
"Handicap de escanteios" → quando o bilhete diz: Handicap de Cantos, Handicap de Escanteios
"Handicap de Finalizações" → quando o bilhete diz: Handicap de Finalizações, Handicap Finalizações
"Handicap de tiros de meta" → quando o bilhete diz: Handicap de Tiros de Meta, Handicap de Chutes de Meta
"Impedimentos" → quando o bilhete diz: Total de Impedimentos, Offsides
"Intervalo" → quando o bilhete diz: Resultado no Intervalo, Placar ao Intervalo, 1º Tempo
"Jogador" → quando o bilhete diz: Marcador, Jogador a Marcar, Assistência do Jogador, Estatística de Jogador
"Placar" → quando o bilhete diz: Placar Exato, Resultado Exato
"Resultado" → quando o bilhete diz: Resultado Final 1X2, 1X2 (sem especificação de tempo), Moneyline
"Resultado Final" → quando o bilhete diz: Resultado Final (explicitamente), Vencedor da Partida
"Resultado Final & Total de Gols" → quando o bilhete diz: Resultado e Gols, 1X2 e Total de Gols
"Tiros de Meta" → quando o bilhete diz: Total de Tiros de Meta, Goal Kicks

BASQUETE:
"Assistências" → quando o bilhete diz: Total de Assistências, Assists
"Cestas" → quando o bilhete diz: Total de Cestas, Pontos de Campo
"Cestas de 3 Pontos" → quando o bilhete diz: Triplos, 3 Pontos, Total de Cestas de Três
"Empate Anula" → (mesmo que futebol)
"Handicap" → (mesmo que futebol)
"Intervalo" → quando o bilhete diz: Resultado no Intervalo (basquete), Resultado no 2º Quarto
"Pontos" → quando o bilhete diz: Total de Pontos, Pontuação Total
"Quarto" → quando o bilhete diz: Resultado no Quarto, Vencedor do Quarto
"Rebotes" → quando o bilhete diz: Total de Rebotes, Rebounds
"Resultado" → (mesmo que futebol)
"Total de pontos do jogador" → quando o bilhete diz: Pontos do Jogador, Pontuação do Jogador
"Vencedor" → quando o bilhete diz: Vencedor da Partida (basquete), Moneyline (basquete)

TÊNIS:
"Aces" → quando o bilhete diz: Total de Aces, Aces Totais
"Games" → quando o bilhete diz: Total de Games, Número de Games
"Handicap de Games" → quando o bilhete diz: Handicap de Games, Games Handicap
"Quebras de Saque" → quando o bilhete diz: Total de Quebras, Breaks de Saque
"Sets" → quando o bilhete diz: Total de Sets, Número de Sets, Resultado em Sets
"Vencedor" → quando o bilhete diz: Vencedor da Partida (tênis), Match Winner

VÔLEI:
"Handicap" → (mesmo que futebol)
"Placar" → quando o bilhete diz: Placar em Sets, Resultado em Sets (vôlei)
"Resultado" → quando o bilhete diz: Resultado da Partida (vôlei)
"Sets" → quando o bilhete diz: Total de Sets (vôlei), Número de Sets
"Vencedor" → quando o bilhete diz: Vencedor da Partida (vôlei)

E-FOOTBALL:
"AMBAS EQUIPES MARCAM" → (mesmo que futebol)
"Chance Dupla" → (mesmo que futebol)
"Gols" → (mesmo que futebol)
"Resultado Final" → (mesmo que futebol)

REGRA IMPORTANTE: Se o mercado do bilhete não tiver correspondência clara nesta lista, use o nome do mercado como aparece no bilhete — mas nesse caso use confianca baixa (abaixo de 0.5) para esse evento, indicando que é um mercado não mapeado.

Regra especial — GOLS/ESCANTEIOS/FINALIZAÇÕES POR TIME (não confundir com o total da partida):
- Quando o mercado aparecer no formato "<Nome do Time> - <Estatística>" (ex.: "França - Total de Gols", "Inglaterra - Total de Escanteios", "Atletic Escaldes - Total de Finalizações"), isso é a estatística DAQUELE TIME especificamente — NÃO é o total da partida (que somaria os dois times). São mercados diferentes, mesmo que o texto pareça parecido.
- Esse formato ainda NÃO tem um mercado equivalente na lista cadastrada (a lista de hoje só cobre o total da partida para Gols/Escanteios/Finalizações). Portanto, para esse formato específico "<Time> - <Estatística>", use o nome do mercado como aparece no bilhete e confiança baixa (abaixo de 0.5) — isso faz o item cair como sugestão de mercado novo, para que o usuário confirme o nome definitivo antes de virar mercado cadastrado.
- Em TODOS os casos desse formato, inclua o nome do time no campo "selecao", nunca deixe essa informação de fora. Ex.: se o bilhete mostra "Mais de 0.5" logo acima de "França - Total de Gols", a seleção correta é "França - Mais de 0.5" (ou "Mais de 0.5 (França)"), nunca apenas "Mais de 0.5" sozinho — sem o time, a aposta perde o sentido.

Regra especial — CRIADOR DE APOSTAS / MÚLTIPLAS CONDIÇÕES NO MESMO CONFRONTO:
- Quando várias condições pertencem ao MESMO confronto (mesmos times, mesma data/hora de jogo), consolide em UM ÚNICO evento (um único item no array "eventos"), mas o campo "mercado" depende de cada condição já ter ou não um mercado reconhecido na lista de MAPEAMENTO DE MERCADOS:
  1. PRIMEIRO tente mapear o mercado de CADA condição individualmente pela tabela de MAPEAMENTO DE MERCADOS (ex.: "Total de Gols" → "Gols", "Total de Escanteios" → "Escanteios").
  2. Se TODAS as condições do confronto tiverem mercado reconhecido: "mercado" = os nomes reconhecidos, na ordem do bilhete, separados por ", " (ex.: "Gols, Escanteios"). NÃO use "Criador de Apostas" nesse caso — o Banca Pro já permite marcar múltiplos mercados no mesmo evento, então prefira sempre os nomes reais dos mercados quando eles existem na lista.
  3. Se PELO MENOS UMA condição não tiver mercado reconhecido na lista (nem variação aproximada clara), aí sim use "mercado" = "Criador de Apostas" para o confronto inteiro (mesmo que outras condições daquele confronto sejam reconhecidas) — mais simples e seguro do que misturar nomes reais com um item não mapeado.
  - Em ambos os casos: "selecao" = todas as condições unidas com " + " na ordem do bilhete; "odd" = a odd combinada do conjunto (não a soma das individuais).

Regra especial — SUPERBET NO APP MÓVEL (tela "Cupom de Aposta"):
- Um cabeçalho vermelho "CUPOM DE APOS..." no topo indica esse formato específico (print do aplicativo, não do site).
- Ignore COMPLETAMENTE qualquer cartão "Compartilhar sua aposta" / "Compartilhar no Supersocial" — é um convite de compartilhamento social, não faz parte dos dados da aposta.
- Cada evento aparece como: ícone + texto antes do "•" + "•" + nome da liga depois do "•" (ex.: "Internacional • Copa do Mundo 2026", ou "Inglaterra • Premier League"). Esse texto antes do "•" pode ser:
  • A palavra "Internacional" — nesse caso é só uma categoria genérica (torneio internacional/de seleções) e NÃO entra no campo "liga". Use apenas o texto depois do "•" (ex.: liga = "Copa do Mundo 2026").
  • O nome de um país (ex.: "Inglaterra", "Brasil", "Espanha") — nesse caso é o país ao qual aquele campeonato pertence, e deve ser INCORPORADO ao campo "liga" no formato "País - Liga" (ex.: "Inglaterra • Premier League" → liga = "Inglaterra - Premier League"; "Brasil • Brasileirão Série A" → liga = "Brasil - Brasileirão Série A").
  Em ambos os casos, use confiancaLiga alta (0.85-1.0), já que o texto está explícito no bilhete.
- O botão "+ Adicionar" no canto superior direito do cartão é elemento de interface — não é dado.
- Os nomes dos times aparecem empilhados em duas linhas, sem "x" nem "-" entre eles. Junte-os no campo "evento" como "Time A x Time B".
- Dentro do cartão "CRIAR APOSTA", cada condição aparece em duas linhas: a seleção em negrito (linha 1) e o mercado em cinza (linha 2) logo abaixo. Os círculos (○) ao lado de cada condição são apenas elementos visuais de interface — TODAS as condições listadas dentro do cartão fazem parte da aposta, independentemente do círculo estar preenchido ou vazio na imagem.
- Apostas de jogador aparecem no formato "Sobrenome, Nome - Mais de X" (ex.: "Messi, Lionel - Mais de 0.5"). Inverta para "Nome Sobrenome" ao compor a seleção final (ex.: "Lionel Messi - Mais de 0.5"), mantendo o mercado da linha de baixo (ex.: "Jogador - Chutes no Gol").
- Pequenos ícones ao lado de alguma condição (ex.: escudo colorido) são apenas indicadores visuais da casa (ex.: aposta protegida) — ignore-os, não fazem parte do texto da seleção.
- O cartão de resumo (identificador + data + odds totais + valor apostado) normalmente fica mais abaixo na tela, depois de todos os eventos — veja a regra de DATA DE REGISTRO e IDENTIFICADOR acima para o formato específico desse cartão.

Regras gerais:
- Se não conseguir identificar um campo com segurança, use null e dê confiança baixa — não invente valores.
- Para "status": se não estiver claro, use "Aberto".
- Responda APENAS com o JSON puro, sem texto antes ou depois, sem markdown, sem crases.`;

// ---- PROMPT PARA IMAGEM ----
const PROMPT_IMAGEM = `Você vai receber a foto ou print de um bilhete de aposta esportiva (de casas como Betano, Superbet, Betfair, etc.).

Extraia os dados do bilhete e devolva ESTRITAMENTE um JSON válido no seguinte formato:
${SCHEMA_JSON}
${REGRAS_COMUNS}`;

// ---- PROMPT PARA TEXTO ----
const PROMPT_TEXTO = `Você vai receber um texto colado de um bilhete de aposta esportiva. Esse texto foi copiado diretamente do site ou app de uma casa de apostas (Betano, Superbet, Betfair, etc.) e pode conter elementos de interface (ícones, links, rótulos) misturados com os dados da aposta.

Exemplos reais de como esse texto se parece:

EXEMPLO 1 — Betano, múltipla:
"""
5-seleções
R$3,07
Grêmio, Palmeiras, Flamengo, Internacional +1, Botafogo-RJ +1
Perdida

Grêmio1.62
Resultado Final
Grêmio - Atlético-GO
Ganhou devido ao pagamento antecipado

Palmeiras1.40
Resultado Final
Palmeiras - Fortaleza

Flamengo1.38
Resultado Final
Flamengo - Juventude-RS
Ganhou devido ao pagamento antecipado

Internacional +11.33
Handicap - Resultado Final
Atlético-MG - Internacional

Botafogo-RJ +11.31
Handicap - Resultado Final
Bragantino - Botafogo-RJ
ID: 6416780725
26/10/2024 - 11:29

GanhosR$0,00
"""
→ casa: Betano, identificador: "6416780725", dataHora: "2024-10-26T11:29", stake: 3.07, status: "Perdeu"
→ 5 eventos: Grêmio vs Atlético-GO (mercado: "Resultado Final", selecao: "Grêmio", odd: 1.62), Palmeiras vs Fortaleza (mercado: "Resultado Final", selecao: "Palmeiras", odd: 1.40), Flamengo vs Juventude-RS (mercado: "Resultado Final", selecao: "Flamengo", odd: 1.38), Atlético-MG vs Internacional (mercado: "Handicap", selecao: "Internacional +1", odd: 1.33), Bragantino vs Botafogo-RJ (mercado: "Handicap", selecao: "Botafogo-RJ +1", odd: 1.31)
→ liga: null para todos (Betano não mostra a liga no texto, mas tente inferir pelos times se possível, com confiancaLiga baixa)

EXEMPLO 2 — Superbet, criador de apostas (múltiplas condições no mesmo confronto):
"""
Internacional
Copa do Mundo 2026
Hoje, 13:00
Inglaterra
RD do Congo
CRIAR APOSTA
1.35
1
Se Classificar
Mais de 4.5
Inglaterra - Total de Escanteios
Internacional
Copa do Mundo 2026
Hoje, 21:00
EUA
Bósnia e Herzegovina
1
1º Tempo - Finalizações 1X2
1.37
890I-QD3MXC
1 DE JUL. DE 2026 — 09:56
ODDS TOTAIS1.84APOSTA2,00R$
"""
→ casa: Superbet, identificador: "890I-QD3MXC", dataHora: "2026-07-01T09:56", stake: 2.0, status: "Aberto"
→ 2 eventos (cada confronto é um evento separado):
  Evento 1: esporte "Futebol", liga "Copa do Mundo 2026" (confiancaLiga: 0.95), evento "Inglaterra x RD do Congo", mercado "Criador de Apostas" (pois "Se Classificar" é reconhecido como "Classificar", mas "Inglaterra - Total de Escanteios" é escanteios POR TIME — ver regra GOLS/ESCANTEIOS/FINALIZAÇÕES POR TIME — e ainda não tem mercado cadastrado equivalente; como nem todas as condições são reconhecidas, usa-se "Criador de Apostas" para o confronto todo), selecao "Classificar + Inglaterra - Mais de 4.5" (nome do time preservado), odd 1.35
  Evento 2: esporte "Futebol", liga "Copa do Mundo 2026" (confiancaLiga: 0.95), evento "EUA x Bósnia e Herzegovina", mercado "Intervalo", selecao "1", odd 1.37
→ Nota: "1º Tempo - Finalizações 1X2" na Superbet corresponde ao mercado "Intervalo" na lista cadastrada.

Observação para texto da Betano: o padrão é geralmente "SeleçãoODD" colado (ex: "Grêmio1.62"), seguido do mercado na linha seguinte, e depois o confronto ("Time A - Time B"). Extraia o confronto no formato "Time A x Time B" (usando "x" em vez de "-").

Agora extraia os dados do texto do bilhete que será enviado a seguir, na mensagem do usuário, e devolva ESTRITAMENTE um JSON válido no seguinte formato:
${SCHEMA_JSON}
${REGRAS_COMUNS}`;

// ---- HANDLER PRINCIPAL (formato Cloudflare Workers) ----
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Só tratamos aqui a rota da API. Qualquer outra URL (o próprio site,
    // imagens, etc.) é devolvida pelos arquivos estáticos normalmente.
    if (url.pathname !== '/api/ler-bilhete') {
      return env.ASSETS.fetch(request);
    }

    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Método não permitido.' }), { status: 405, headers });
    }

    let payload;
    try { payload = await request.json(); }
    catch (e) { return new Response(JSON.stringify({ error: 'Corpo da requisição inválido.' }), { status: 400, headers }); }

    const { imagemBase64, mediaType, textoBilhete } = payload || {};

    if (!imagemBase64 && !textoBilhete) {
      return new Response(
        JSON.stringify({ error: 'Envie imagemBase64+mediaType (foto) ou textoBilhete (texto colado).' }),
        { status: 400, headers }
      );
    }

    let systemInstrucoes;
    if (textoBilhete) {
      systemInstrucoes = PROMPT_TEXTO;
    } else {
      const tiposAceitos = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!tiposAceitos.includes(mediaType)) {
        return new Response(
          JSON.stringify({ error: 'Formato de imagem não suportado. Use JPEG, PNG, WEBP ou GIF.' }),
          { status: 400, headers }
        );
      }
      systemInstrucoes = PROMPT_IMAGEM;
    }

    // ---- 1ª TENTATIVA: GEMINI (grátis) ----
    if (env.GEMINI_API_KEY) {
      try {
        const extraido = await lerComGemini({
          apiKey: env.GEMINI_API_KEY,
          systemInstrucoes,
          textoBilhete,
          imagemBase64,
          mediaType,
        });
        return new Response(JSON.stringify({ ...extraido, _provedor: 'gemini' }), { status: 200, headers });
      } catch (erroGemini) {
        console.log('[fallback] Gemini falhou, tentando Anthropic:', erroGemini.message);
        // segue para a Anthropic abaixo
      }
    } else {
      console.log('[fallback] GEMINI_API_KEY não configurada, indo direto para Anthropic.');
    }

    // ---- 2ª TENTATIVA: ANTHROPIC (paga, fallback) ----
    if (!env.ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'Nem GEMINI_API_KEY nem ANTHROPIC_API_KEY estão configuradas no Cloudflare.' }),
        { status: 500, headers }
      );
    }

    try {
      const extraido = await lerComAnthropic({
        apiKey: env.ANTHROPIC_API_KEY,
        systemInstrucoes,
        textoBilhete,
        imagemBase64,
        mediaType,
      });
      return new Response(JSON.stringify({ ...extraido, _provedor: 'anthropic' }), { status: 200, headers });
    } catch (erroAnthropic) {
      return new Response(
        JSON.stringify({ error: 'Erro ao ler bilhete (Gemini e Anthropic falharam): ' + erroAnthropic.message }),
        { status: 502, headers }
      );
    }
  },
};

// ==================== PROVEDOR: GEMINI ====================
// Lista de modelos candidatos, em ordem de preferência. Se o Google
// descontinuar um (o que tem acontecido com frequência), o próximo da
// lista assume automaticamente na próxima leitura — sem precisar editar
// o Worker toda vez que um nome de modelo for aposentado.
const MODELOS_GEMINI_CANDIDATOS = [
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-2.5-flash-lite',
  'gemini-3.5-flash',
];

async function lerComGemini({ apiKey, systemInstrucoes, textoBilhete, imagemBase64, mediaType }) {
  const parteConteudo = textoBilhete
    ? { text: textoBilhete }
    : { inline_data: { mime_type: mediaType, data: imagemBase64 } };

  let ultimoErro = null;

  for (const modelo of MODELOS_GEMINI_CANDIDATOS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`;
    try {
      const resposta = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstrucoes }] },
          contents: [{ role: 'user', parts: [parteConteudo] }],
          generationConfig: { temperature: 0 },
        }),
      });

      if (!resposta.ok) {
        const corpoErro = await resposta.text();
        // Modelo descontinuado/inexistente (404) ou indisponível (503):
        // registra e tenta o próximo candidato da lista.
        if (resposta.status === 404 || resposta.status === 503) {
          console.log(`[gemini] Modelo "${modelo}" indisponível (${resposta.status}), tentando o próximo candidato.`);
          ultimoErro = new Error(`Gemini (${modelo}) retornou ${resposta.status}: ${corpoErro}`);
          continue;
        }
        // Outros erros (ex.: 429 rate limit, 400 chave inválida) não são
        // resolvidos trocando de modelo — propaga direto para o fallback Anthropic.
        throw new Error(`Gemini (${modelo}) retornou ${resposta.status}: ${corpoErro}`);
      }

      const dados = await resposta.json();
      const texto = dados?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!texto) {
        throw new Error(`Gemini (${modelo}) não retornou texto utilizável (possível bloqueio de segurança ou resposta vazia).`);
      }

      return parsearJSON(texto);
    } catch (e) {
      ultimoErro = e;
      // Erros de rede/parse também tentam o próximo candidato, por segurança.
      continue;
    }
  }

  throw ultimoErro || new Error('Nenhum modelo Gemini candidato respondeu.');
}

// ==================== PROVEDOR: ANTHROPIC ====================
async function lerComAnthropic({ apiKey, systemInstrucoes, textoBilhete, imagemBase64, mediaType }) {
  const conteudoMensagem = textoBilhete
    ? [{ type: 'text', text: textoBilhete }]
    : [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: imagemBase64 } }];

  const resposta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      // Prompt caching: as instruções fixas (schema, regras, mapeamento de mercados,
      // exemplos) são reaproveitadas entre chamadas dentro de 1h, reduzindo custo
      // em sessões de importação com vários bilhetes seguidos.
      system: [
        { type: 'text', text: systemInstrucoes, cache_control: { type: 'ephemeral', ttl: '1h' } },
      ],
      messages: [{ role: 'user', content: conteudoMensagem }],
    }),
  });

  if (!resposta.ok) {
    const textoErro = await resposta.text();
    throw new Error(`Anthropic retornou ${resposta.status}: ${textoErro}`);
  }

  const dados = await resposta.json();

  // Log de diagnóstico do cache — visível nos logs do Worker no dashboard
  // ou via `wrangler tail`. cache_read_input_tokens > 0 confirma reaproveitamento.
  if (dados.usage) {
    const u = dados.usage;
    console.log(
      `[cache] entrada=${u.input_tokens} | cache_lido=${u.cache_read_input_tokens || 0} | cache_gravado=${u.cache_creation_input_tokens || 0} | saida=${u.output_tokens}`
    );
  }

  const blocoTexto = (dados.content || []).find((b) => b.type === 'text');
  if (!blocoTexto) {
    throw new Error('Anthropic não retornou texto utilizável.');
  }

  return parsearJSON(blocoTexto.text);
}

// ==================== AUXILIAR ====================
function parsearJSON(texto) {
  const limpo = texto.replace(/```json\s*|```\s*/g, '').trim();
  try {
    return JSON.parse(limpo);
  } catch (e) {
    throw new Error('Não foi possível interpretar a resposta como JSON: ' + limpo.slice(0, 200));
  }
}
