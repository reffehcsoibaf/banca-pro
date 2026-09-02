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
  "tipo": "uma destas strings: Ao Vivo, Pré Live (ver regra TIPO DA APOSTA abaixo)",
  "stake": "number ou null (valor apostado, só o número, sem moeda)",
  "status": "uma destas strings ou null: Aberto, Ganhou, Perdeu, Ganho Parcial, Perda Parcial, Cash Out, Anulada",
  "bonus": "number ou null (valor de bônus/promoção aplicado pela casa sobre esta aposta, se identificável — ver regra BÔNUS abaixo)",
  "observacao": "string ou null (placar final ou resultado, se visível)",
  "eventos": [
    {
      "esporte": "string (ex: Futebol, Basquete, Tênis, Vôlei)",
      "liga": "string ou null (nome do campeonato/liga)",
      "evento": "string (nome do confronto, ex: Time A - Time B)",
      "dataEvento": "string no formato AAAA-MM-DDTHH:MM ou null (DATA/HORA DO JOGO em si, distinta da data de registro do bilhete — ver regra DATA DO JOGO abaixo)",
      "mercado": "string — um nome da lista de mercados cadastrados (ver MAPEAMENTO DE MERCADOS). Se o evento combinar VÁRIAS condições cujos mercados são todos reconhecidos na lista, use os nomes reconhecidos separados por ', ' NA ORDEM EM QUE AS CONDIÇÕES APARECEM NO BILHETE (ex.: \"Gols, Escanteios\") — NUNCA reordene em ordem alfabética. O campo 'selecao' correspondente DEVE seguir exatamente essa mesma ordem, condição por condição — ver regra CRIADOR DE APOSTAS abaixo.",
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
    "tipo": "number entre 0 e 1",
    "stake": "number entre 0 e 1",
    "status": "number entre 0 e 1",
    "bonus": "number entre 0 e 1"
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

Regra especial — DATA DO JOGO (campo "dataEvento" de cada evento):
- Diferente do campo "dataHora" (que é a data de REGISTRO do bilhete, único por aposta), "dataEvento" é a data/hora em que a PARTIDA acontece, e existe UM valor por evento (útil em bilhetes múltiplos com jogos em dias diferentes).
- Normalmente aparece junto ao nome do confronto, no formato "DD/MM HH:MM", "DD/MM/AAAA HH:MM" ou similar, dependendo da casa. Assuma o ano da data de registro do bilhete quando o bilhete mostrar só dia/mês, exceto se isso resultar numa data de jogo muito distante da data de registro (ex.: bilhete registrado em dezembro para jogo em janeiro seguinte — nesse caso use o ano seguinte).
- Se não encontrar a data/hora do jogo daquele evento específico com clareza, deixe "dataEvento" como null — não tente adivinhar nem reaproveitar a data de registro do bilhete.

Regra especial — IDENTIFICADOR DO BILHETE:
- Betano: vem com rótulo explícito "ID:" seguido de número longo. Ex: ID: 6416780725.
- Superbet: código sem rótulo no padrão XXXX-XXXXXX (4+ chars, hífen, 4+ chars). Ex: 890I-QD3MXC, 892N-1QNSK9.
- No app mobile da Superbet, ignore textos técnicos de rodapé que pareçam UUID (ex: "1B4BAD59-FF6F-4611-A95B-3CEE4DF34F76") ou strings de versão de app/sistema (ex: "BrazilSport/2607011314 CFNetwork/3860.600.12 Darwin/25.5.0") — isso é informação de depuração do aplicativo, não é o identificador do bilhete.
- Outras casas: use o bom senso para identificar códigos que claramente servem como referência do bilhete.

Regra especial — BÔNUS:
- Superbet: promoções do tipo "SUPERMÚLTIPLA" (ou similar) aparecem no rodapé do bilhete junto ao valor total, geralmente logo depois de "ODDS TOTAIS" e "APOSTA", no formato "SUPERMÚLTIPLA<percentual>%<valor>R$" (ex.: "SUPERMÚLTIPLA5%0,65R$" significa um bônus de R$ 0,65, correspondente a 5% de acréscimo). Extraia APENAS o valor em reais desse bônus para o campo "bonus" — não o percentual. Use confiancaGeral.bonus alta (0.8-1.0) quando esse valor aparecer claramente escrito.
- Betano: bônus geralmente aparece com rótulos como "Bônus aplicado", "Free bet utilizado" ou valor destacado próximo ao retorno/lucro simulado, quando existir.
- Se não houver nenhuma indicação de bônus no bilhete, "bonus" deve ser null (não use 0 — null indica "não identificado", e 0 indica "identificado e é zero").

Regra especial — HANDICAP ASIÁTICO E "RESULTADO ATUAL":
- Bilhetes de mercados como Handicap Asiático (e outros mercados de handicap) às vezes exibem um texto do tipo "Resultado atual: 0-0" ou "Placar atual: 0-0" junto à condição — isso é apenas um indicador de referência do próprio mercado (o placar-base a partir do qual o handicap é calculado), NÃO é o placar real de um jogo em andamento nem um resultado a ser registrado. NUNCA copie esse "0-0" (ou qualquer placar mostrado dessa forma, associado a um mercado de handicap) para o campo "observacao" — isso não é uma observação sobre o resultado da aposta, é só parte da explicação do mercado. Só preencha "observacao" com um placar quando ele for claramente o resultado final real de uma aposta já encerrada (Ganhou/Perdeu/etc.), nunca com um "placar de referência" de um mercado ainda em aberto.

Regra especial — STATUS (não confundir opção de Cashout com status Cash Out):
- Use o rótulo explícito "STATUS" (ou equivalente) quando ele existir no bilhete — é a fonte de verdade. Ex.: "STATUS: ATIVO" → status "Aberto".
- A presença de um botão "CASHOUT" disponível/verde NÃO significa que a aposta foi encerrada por cashout — é apenas uma opção oferecida enquanto a aposta está em aberto. Só use o status "Cash Out" se houver indicação explícita de que o cashout foi efetivamente realizado (ex.: texto "Cashout realizado", "Encerrada por cash out", ou status explícito diferente de "Ativo"/"Aberto").
- Da mesma forma, valores como "Valor do Cashout" e "Lucro" exibidos junto ao botão são apenas uma simulação do que seria pago SE o usuário optasse por sacar agora — não indicam o resultado real da aposta.

Regra especial — LIGA:
- Se a liga estiver escrita explicitamente no bilhete (como na Superbet), copie-a exatamente e use confiancaLiga alta (0.85-1.0) — mesmo que o nome escrito seja um nome comercial de patrocínio.
- Se a liga NÃO estiver escrita no bilhete (comum na Betano, que normalmente só mostra os nomes dos times): SEMPRE tente inferir pelo seu conhecimento dos times, do país e da data do jogo, antes de considerar null. Só deixe liga como null se genuinamente não reconhecer os times o suficiente para arriscar nem o país. Use confiancaLiga baixa (0.3-0.5) nesses casos de inferência, já que não é leitura direta do bilhete.
- Ao inferir (ou seja, quando o bilhete não escreveu a liga), use SEMPRE o nome oficial/internacional da divisão nacional, no formato "País - Divisão" — NUNCA o nome comercial/de patrocínio da temporada (esses mudam a cada contrato e não devem ser usados como referência). Exemplos do formato esperado:
  • Brasil, 1ª divisão → "Brasil - Série A" (não "Brasileirão", nem nomes de patrocinador)
  • Itália, 1ª divisão → "Itália - Série A" (não "Serie A TIM" ou variações comerciais)
  • Inglaterra, 1ª divisão → "Inglaterra - Premier League" (nome já é o oficial, sem patrocinador — não usar nomes de patrocínio que a competição já teve)
  • Espanha, 1ª divisão → "Espanha - La Liga" (não usar nome de patrocinador atual)
  • Alemanha, 1ª divisão → "Alemanha - Bundesliga"
  • França, 1ª divisão → "França - Ligue 1"
  • Segundas divisões seguem o mesmo padrão: "Brasil - Série B", "Inglaterra - Championship", "Itália - Serie B", etc.
  • Copas nacionais e continentais usam o nome oficial do torneio, sem prefixo de país quando o torneio já é internacional por natureza (ex.: "Copa Libertadores", "Copa do Mundo 2026", "Champions League") — o prefixo "País - " vale só para ligas nacionais de pontos corridos/mata-mata interno.
- Essa regra de nome oficial (sem patrocínio) vale tanto para inferência quanto como preferência geral: se o bilhete escrever um nome comercial óbvio de patrocínio (ex.: variações com nome de marca patrocinadora do campeonato), normalize para o nome oficial acima em vez de copiar literalmente — a exatidão do que está escrito no bilhete importa menos aqui do que manter a lista de ligas do Banca Pro estável ao longo das temporadas.

Regra especial — MAPEAMENTO DE MERCADOS:
O sistema já tem os seguintes mercados cadastrados. Quando o bilhete mostrar um mercado, use SEMPRE o nome correspondente desta lista — não invente nomes novos nem use o nome exato do bilhete se houver um equivalente aqui.

FUTEBOL:
"Ambas equipes Marcam" → quando o bilhete diz: Ambas Marcam, BTTS, Ambos Marcam
"Arremessos Laterais" → quando o bilhete diz: Laterais, Total de Arremessos Laterais
"Campeão" → quando o bilhete diz: Vencedor do Torneio, Campeão do Torneio
"Cartões" → quando o bilhete diz: Total de Cartões, Cartões Amarelos, Cartões Totais — APENAS o total da PARTIDA, SEM nome de time antes. Se vier como "<Time> - Total de Cartões", veja a regra ESTATÍSTICAS POR TIME abaixo.
"Chance Dupla" → quando o bilhete diz: Dupla Hipótese, Double Chance
"Chance Dupla & Total de Gols" → quando o bilhete diz: Chance Dupla e Gols, Double Chance e Total de Gols
"Chutes no gol" → quando o bilhete diz: Chutes, Finalizações ao Gol, Remates no Gol — APENAS o total da PARTIDA, SEM nome de time antes. Se vier como "<Time> - Chutes no Gol", veja a regra ESTATÍSTICAS POR TIME abaixo.
"Chutes no gol do jogador" → quando o bilhete diz: Chutes no Alvo do Jogador, Finalizações ao Gol do Jogador, Jogador - Chutes no Gol
"Classificar" → quando o bilhete diz: Se Classificar, Avançar, Classificação
"Criador de Apostas" → quando o bilhete diz: CRIAR APOSTA, Bet Builder, Aposta Personalizada, Combinada (criador de apostas de um único confronto)
"Defesas" → quando o bilhete diz: Total de Defesas, Defesas do Goleiro — APENAS o total da PARTIDA (ambos os goleiros), SEM nome de time antes. Se vier como "<Time> - Total de Defesas", veja a regra ESTATÍSTICAS POR TIME abaixo.
"Desarmes" → quando o bilhete diz: Total de Desarmes, Tackles — APENAS o total da PARTIDA, SEM nome de time antes. Se vier como "<Time> - Total de Desarmes", veja a regra ESTATÍSTICAS POR TIME abaixo.
"Empate" → quando o bilhete diz: Empate Puro (apenas empate como mercado isolado)
"Empate Anula" → quando o bilhete diz: Empate Anula Aposta, Draw No Bet, EAA
"Equipe Com Mais Escanteios" → quando o bilhete diz: Mais Escanteios, Equipe com Mais Cantos
"Equipe Com Mais Chutes no Gol" → quando o bilhete diz: Mais Chutes no Gol, Equipe com Mais Chutes ao Gol, Equipe Com Mais Chutes no Gol (1X2) — diferente de "Equipe Com Mais Finalizações" (finalizações totais x chutes especificamente no gol/no alvo são estatísticas diferentes)
"Equipe Com Mais Finalizações" → quando o bilhete diz: Mais Finalizações, Equipe com Mais Chutes
"Escanteios" → quando o bilhete diz: Total de Escanteios, Cantos, Total de Cantos — APENAS o total da PARTIDA (ambos os times), SEM nome de time antes. Se vier como "<Time> - Total de Escanteios", veja a regra ESTATÍSTICAS POR TIME abaixo.
"Faixa de gols" → quando o bilhete diz: Intervalo de Gols, Faixa de Resultado em Gols — total de gols da PARTIDA caindo num intervalo (ex.: seleção "1-4", "2-5"), SEM nome de time antes. Ver regra FAIXA DE GOLS (INTERVALO) x GOLS abaixo para como diferenciar do mercado "Gols".
"Faixa de gols da Equipe" → mesmo conceito de "Faixa de gols", mas para o total de gols de UM time específico (formato "<Nome do Time> - Total de Gols" com seleção em intervalo, ex.: "River Plate - Total de Gols" com seleção "2-4"). Ver regra FAIXA DE GOLS (INTERVALO) x GOLS abaixo.
"Gols da Equipe" → quando o bilhete diz: "<Nome do Time> - Total de Gols" (estatística do time específico, não da partida)
"Escanteios da Equipe" → quando o bilhete diz: "<Nome do Time> - Total de Escanteios" (estatística do time específico, não da partida)
"Finalizações da Equipe" → quando o bilhete diz: "<Nome do Time> - Total de Finalizações" ou "<Nome do Time> - Total de Chutes" (estatística do time específico, não da partida)
"Chutes no Gol da Equipe" → quando o bilhete diz: "<Nome do Time> - Chutes no Gol" ou "<Nome do Time> - Finalizações ao Gol" (estatística do time específico, não da partida)
"Cartões da Equipe" → quando o bilhete diz: "<Nome do Time> - Total de Cartões" (estatística do time específico, não da partida)
"Faltas da Equipe" → quando o bilhete diz: "<Nome do Time> - Total de Faltas" (estatística do time específico, não da partida)
"Defesas da Equipe" → quando o bilhete diz: "<Nome do Time> - Total de Defesas" (estatística do time específico, não da partida)
"Desarmes da Equipe" → quando o bilhete diz: "<Nome do Time> - Total de Desarmes" (estatística do time específico, não da partida)
"Faltas" → quando o bilhete diz: Total de Faltas, Faltas Cometidas — APENAS o total da PARTIDA, SEM nome de time antes. Se vier como "<Time> - Total de Faltas", veja a regra ESTATÍSTICAS POR TIME abaixo.
"Finalizações" → quando o bilhete diz: Total de Finalizações, Total de Chutes, Chutes Totais, Finalizações Totais, Chutes (Betano), Total de Finalizações (Superbet) — APENAS o total da PARTIDA, SEM nome de time antes. Se vier como "<Time> - Total de Finalizações", veja a regra ESTATÍSTICAS POR TIME abaixo.
"Ganhar qualquer um dos Tempos" → quando o bilhete diz: Ganhar Algum Tempo, Vencer Pelo Menos Um Tempo
"Gols" → quando o bilhete diz: Total de Gols, Total de Gols Mais/Menos (Betano), Total de Gols (Superbet), Mais/Menos Gols, Over/Under Gols — APENAS quando for o total de gols da PARTIDA (ambos os times somados), SEM nome de time antes. Se vier no formato "<Time> - Total de Gols", NÃO é este mercado — veja a regra ESTATÍSTICAS POR TIME abaixo.
"Handicap" → quando o bilhete diz: Handicap Europeu, Handicap de Resultado
"Handicap Asiático" → quando o bilhete diz: Asian Handicap, AH
"Handicap de chutes no gol" → quando o bilhete diz: Handicap de Chutes, Handicap de Finalizações ao Gol
"Handicap de escanteios" → quando o bilhete diz: Handicap de Cantos, Handicap de Escanteios
"Handicap de Finalizações" → quando o bilhete diz: Handicap de Finalizações, Handicap Finalizações
"Handicap de tiros de meta" → quando o bilhete diz: Handicap de Tiros de Meta, Handicap de Chutes de Meta
"Impedimentos" → quando o bilhete diz: Total de Impedimentos, Offsides — APENAS o total da PARTIDA, SEM nome de time antes. Se vier como "<Time> - Total de Impedimentos", veja a regra ESTATÍSTICAS POR TIME abaixo.
"Impedimentos da Equipe" → quando o bilhete diz: "<Nome do Time> - Total de Impedimentos" (estatística do time específico, não da partida)
"Intervalo" → quando o bilhete diz: Resultado no Intervalo, Placar ao Intervalo, 1º Tempo
"Jogador" → quando o bilhete diz: Marcador, Jogador a Marcar, Assistência do Jogador, Estatística de Jogador
"Placar" → quando o bilhete diz: Placar Exato, Resultado Exato, Ficar à Frente do Placar (Superbet — mercado sobre um time assumir a frente no placar em algum momento do jogo; NÃO é Criador de Apostas, é o mercado fixo "Placar". Monte a seleção como "<Time> - Ficar à Frente do Placar", ex.: "Qarabag - Ficar à Frente do Placar")
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

Regra especial — TIME REFERENCIADO POR NÚMERO (1 OU 2) EM VEZ DO NOME:
- Em mercados de escolha entre os dois times do confronto (ex.: "Classificar", "Resultado", "Resultado Final", "Vencedor", "Chance Dupla" quando aparecem como opção simples, "Equipe Com Mais X (1X2)"), a Superbet às vezes mostra apenas o número "1" ou "2" como seleção, em vez do nome do time.
- "1" = o PRIMEIRO time listado no confronto (o que aparece em cima/primeiro). "2" = o SEGUNDO time listado (embaixo/depois). Ex.: confronto "Espanha / Bélgica" com condição "1 → Se Classificar": Espanha é o primeiro time listado, então a seleção correta é "Espanha" (mercado "Classificar").
- Ao montar o campo "selecao", troque o número pelo nome real do time — nunca deixe "1" ou "2" sozinho no campo seleção.
- Essa substituição vale SÓ para mercados de escolha entre times. Se um número solto aparecer perto de um mercado de jogador, total de gols/escanteios/cartões etc. (que não são "escolha de time"), NÃO interprete esse número como referência a um time — ele não faz parte da seleção nesses casos.

Regra especial — ESTATÍSTICAS POR TIME (não confundir com o total da partida):
- Quando o mercado aparecer no formato "<Nome do Time> - <Estatística>" (ex.: "França - Total de Gols", "Inglaterra - Total de Escanteios", "Atletic Escaldes - Total de Finalizações", "Real Madrid - Total de Cartões", "Boca Juniors - Total de Faltas", "River Plate - Total de Defesas", "Barcelona - Total de Desarmes", "Liverpool - Chutes no Gol", "Napoli - Total de Impedimentos"), isso é a estatística DAQUELE TIME especificamente — NÃO é o total da partida (que somaria os dois times). São mercados diferentes, mesmo que o texto pareça parecido.
- Use o mercado fixo correspondente "<Estatística> da Equipe" (Gols da Equipe, Escanteios da Equipe, Finalizações da Equipe, Chutes no Gol da Equipe, Cartões da Equipe, Faltas da Equipe, Defesas da Equipe, Desarmes da Equipe ou Impedimentos da Equipe — todos já cadastrados, veja a tabela FUTEBOL acima) — NÃO trate como mercado novo/não mapeado, e não crie um mercado diferente para cada time (ex.: não use "Gols da França" e "Gols da Argentina" como mercados distintos; ambos são "Gols da Equipe").
- SEMPRE inclua o nome do time no campo "selecao", nunca deixe essa informação de fora — é o que diferencia uma ocorrência da outra dentro do mesmo mercado fixo. Ex.: bilhete mostra "Mais de 1.5" logo acima de "França - Total de Gols" → mercado "Gols da Equipe", selecao "França - Mais de 1.5". Outro evento com "Mais de 0.5" acima de "Argentina - Total de Gols" → mercado "Gols da Equipe", selecao "Argentina - Mais de 0.5". Mesma lógica para as demais estatísticas por time.

Regra especial — FAIXA DE GOLS (INTERVALO) x GOLS (MAIS/MENOS DE):
- A Betano às vezes rotula esse mercado como "Total de Gols" mesmo quando a seleção real é um INTERVALO de gols, no formato "N-M" (dois números separados por hífen, ex.: "1-4", "1-5", "2-3", "0-2") — isso significa "o total de gols da partida (ou do time) cai entre N e M", e é um mercado DIFERENTE de "Mais de X.5" / "Menos de X.5".
- Sinal de detecção: se a seleção casa com o padrão "número-hífen-número" (ex.: "1-4"), é SEMPRE o mercado de faixa/intervalo — não interprete como handicap nem como "Mais de"/"Menos de", mesmo que o rótulo do bilhete diga "Total de Gols".
- Se a seleção estiver no formato "Mais de X.5" ou "Menos de X.5" (com ponto decimal, sem hífen entre dois números), é o mercado normal "Gols" (ou "Gols da Equipe" se tiver nome de time) — a regra acima NÃO se aplica.
- Mapeamento correto conforme o formato:
  • Sem nome de time antes, seleção em intervalo "N-M" → mercado "Faixa de gols", selecao = o intervalo como está (ex.: "1-4").
  • Com nome de time antes ("<Time> - Total de Gols"), seleção em intervalo "N-M" → mercado "Faixa de gols da Equipe", selecao = "<Time> - N-M" (ex.: "River Plate - 2-4"), seguindo o mesmo padrão de incluir o nome do time usado em "Gols da Equipe".
- Exemplo real (Betano, tripla): confronto "Botafogo-RJ x Santos" com mercado exibido "Total de Gols" e seleção "1-4" → NÃO é mercado "Gols" — é mercado "Faixa de gols", selecao "1-4". Já no mesmo bilhete, "Vitória - Total de Gols" com seleção "Mais de 0.5" continua sendo mercado "Gols da Equipe", selecao "Vitória - Mais de 0.5", porque não tem o hífen de intervalo.
- Essa mesma lógica de intervalo por hífen pode aparecer para outras estatísticas além de gols (ex.: escanteios, cartões) em casas que usam esse formato — se acontecer, aplique o mesmo raciocínio: hífen entre dois números = faixa/intervalo, não "mais de"/"menos de", e sinalize com confiança um pouco mais baixa (0.5-0.7) se o mercado de faixa correspondente àquela estatística não estiver claramente mapeado na lista.

Regra especial — MERCADO "CADA EQUIPE" (condição combinada para as duas equipes ao mesmo tempo):
- Alguns mercados no formato "Cada Equipe Mais de X <Estatística>" (ex.: "Cada Equipe Mais de X Cartões", "Cada Equipe Mais de X Escanteios", "Cada Equipe Mais de X Gols", "Cada Equipe Mais de X Faltas") perguntam se AMBOS os times, cada um individualmente, vão superar um mesmo valor — é diferente do mercado "<Estatística> da Equipe" (que trata de UM time específico) e diferente do mercado "<Estatística>" total da partida (soma dos dois times).
- No bilhete, esse mercado aparece com o valor de referência e o resultado apostado em linhas separadas, ex.: "Mais de 0.5 - Sim" logo acima de "Cada Equipe Mais de X Cartões" — nesse caso "0.5" é o valor de referência e "Sim" é a seleção escolhida (também pode aparecer "Não").
- Use o mesmo mercado base já mapeado na tabela (ex.: "Cartões", "Gols", "Escanteios", "Faltas", "Finalizações", "Chutes no gol", "Desarmes", "Impedimentos", "Defesas") — NÃO crie um mercado novo chamado "Cada Equipe" nem trate como "Criador de Apostas" só por causa desse formato.
- Monte a seleção descrevendo a condição por completo, no formato "Mais de {valor} <estatística no plural, minúsculo> para cada equipe - {Sim ou Não}". Ex.: valor "0.5", resultado "Sim", estatística "Cartões" → mercado "Cartões", selecao "Mais de 0.5 cartões para cada equipe - Sim". Outro exemplo: "Cada Equipe Mais de X Escanteios" com "Mais de 3.5 - Não" → mercado "Escanteios", selecao "Mais de 3.5 escanteios para cada equipe - Não".
- Essa regra vale igualmente para qualquer estatística do combo mencionado nas regras de ESTATÍSTICAS POR TIME acima (gols, escanteios, finalizações, chutes no gol, cartões, faltas, defesas, desarmes, impedimentos) sempre que o bilhete usar o formato "Cada Equipe" em vez de nomear um time específico.

Regra especial — MERCADO "AMBAS AS EQUIPES RECEBERÃO CARTÃO" (BTTC):
- Quando o bilhete mostrar um mercado do tipo "Ambas as equipes receberão um cartão", "As duas equipes serão advertidas", "Both Teams To Be Carded", "BTTC" ou equivalente — pergunta apenas se AMBOS os times, cada um, vão receber pelo menos 1 cartão na partida (não tem linha de "mais de X") — use o mercado fixo já mapeado "Cartões" (o mesmo do total de cartões da partida). NÃO crie um mercado novo e NÃO trate como "Criador de Apostas" só por causa desse formato.
- Monte a seleção no formato fixo "Ambas as equipes recebem cartão - {Sim ou Não}", conforme o resultado apostado no bilhete. Ex.: bilhete mostra "Sim" ao lado desse mercado → selecao "Ambas as equipes recebem cartão - Sim".
- NUNCA invente um valor numérico de referência (como "1.5") para esse mercado — ele é binário (Sim/Não), diferente do mercado "Cada Equipe Mais de X Cartões" (que tem linha de referência) descrito na regra acima; não confunda os dois.

Regra especial — CONDIÇÃO RESTRITA A UMA ETAPA DA PARTIDA (1º/2º Tempo no futebol, Quartos/Metades no basquete):
- Estatísticas de partida, de equipe ou de jogador (Finalizações, Impedimentos, Desarmes, Escanteios, Gols, Faltas, Chutes no Gol, Cartões, Defesas, Pontos, Assistências, Rebotes, Cestas de 3 Pontos etc.) às vezes vêm restritas a uma etapa específica do jogo, em vez de valerem pela partida inteira. Isso aparece no bilhete como um prefixo indicando a etapa antes do nome da estatística, ex.: "1º Tempo - Finalizações", "2º Tempo - Escanteios", "3º Quarto - Pontos", "1º Quarto - Assistências do Jogador".
- Em TODOS os casos abaixo, o mercado da estatística em si continua sendo o nome já mapeado normalmente pela tabela acima (ex.: "Finalizações", "Escanteios", "Gols da Equipe", "Pontos", "Assistências", "Rebotes") — a etapa NÃO renomeia nem substitui esse mercado.
- A etapa entra na seleção como um sufixo depois do valor apostado, separado por espaço, e o mercado a marcar depende do tipo de etapa:

  • FUTEBOL — Primeiro Tempo: sufixo " HT" na seleção, E marque também o mercado "Intervalo" junto ao mercado da estatística (mercados combinados, separados por ", ", igual à regra do Criador de Apostas). Ex.: "1º Tempo - Finalizações" com valor "Menos de 14.5" → mercado "Finalizações, Intervalo", selecao "Menos de 14.5 HT".
  • FUTEBOL — Segundo Tempo: sufixo " 2T" na seleção, E marque também o mercado "Intervalo" junto. Ex.: "2º Tempo - Escanteios" com valor "Mais de 3.5" → mercado "Escanteios, Intervalo", selecao "Mais de 3.5 2T".

  • BASQUETE — Quarto específico (1º, 2º, 3º ou 4º Quarto): sufixo " Q1", " Q2", " Q3" ou " Q4" na seleção, E marque também o mercado "Quarto" junto ao mercado da estatística. Ex.: "3º Quarto - Pontos" com valor "Mais de 20.5" → mercado "Pontos, Quarto", selecao "Mais de 20.5 Q3". Se a condição também for de um jogador ou equipe específica (ex.: "3º Quarto - Assistências do Jogador"), marque TODOS os mercados aplicáveis ao mesmo tempo: o mercado da estatística + "Quarto" (e inclua o nome do jogador/equipe na seleção). Ex.: "1º Quarto - LeBron James - Total de Rebotes" com valor "Mais de 3.5" → mercado "Total de pontos do jogador" não se aplica aqui, use o mercado correto da estatística (ex.: "Rebotes") + "Quarto", selecao "LeBron James - Mais de 3.5 Q1".
  • BASQUETE — Primeira ou Segunda metade do jogo (cada metade = 2 quartos, ex.: "1ª Metade", "2ª Metade"): mesma lógica do futebol — sufixo " HT" (primeira metade) ou " 2T" (segunda metade) na seleção, SEM marcar o mercado "Quarto" (já que não é um quarto específico). Ex.: "1ª Metade - Total de Pontos" com valor "Mais de 55.5" → mercado "Pontos", selecao "Mais de 55.5 HT".

- Se o bilhete não indicar etapa nenhuma (sem prefixo de tempo/quarto/metade), não adicione sufixo nem mercado extra — trate como estatística da partida inteira, normalmente.
- Essa regra de etapa combina normalmente com a regra de ESTATÍSTICAS POR TIME acima: se a condição também tiver nome de time/jogador junto com a etapa (ex.: "1º Tempo - Inglaterra - Total de Finalizações"), inclua o nome do time/jogador E o sufixo de etapa na seleção, na ordem "Time/Jogador - Valor Etapa", e marque todos os mercados aplicáveis (estatística correspondente + Intervalo/Quarto). Ex.: mercado "Finalizações da Equipe, Intervalo", selecao "Inglaterra - Menos de 5.5 HT".

Regra especial — CRIADOR DE APOSTAS / MÚLTIPLAS CONDIÇÕES NO MESMO CONFRONTO:
- IMPORTANTE: os rótulos "CRIAR APOSTA" (ou "CRIADOR DE APOSTAS", "Bet Builder") e "DICAS DE APOSTA" que aparecem no bilhete são apenas nomes de FUNCIONALIDADES ou seções do aplicativo usadas para montar/sugerir a aposta — eles NÃO significam automaticamente que o campo "mercado" de saída deve ser "Criador de Apostas", nem fazem parte de nenhum dado da aposta. Ignore esses rótulos como texto de interface. Verifique cuidadosamente CADA condição individual contra a tabela de MAPEAMENTO DE MERCADOS (incluindo os mercados "da Equipe", "Cada Equipe" e os de escolha por número 1/2) antes de decidir. Na maioria dos bilhetes, as condições já têm mercado reconhecido — não pule direto para "Criador de Apostas" só porque viu um desses rótulos na tela.
- Quando várias condições pertencem ao MESMO confronto (mesmos times, mesma data/hora de jogo), consolide em UM ÚNICO evento (um único item no array "eventos"), mas o campo "mercado" depende de cada condição já ter ou não um mercado reconhecido na lista de MAPEAMENTO DE MERCADOS:
  1. PRIMEIRO tente mapear o mercado de CADA condição individualmente pela tabela de MAPEAMENTO DE MERCADOS (ex.: "Total de Gols" → "Gols", "Total de Escanteios" → "Escanteios").
  2. Se TODAS as condições do confronto tiverem mercado reconhecido: "mercado" = os nomes reconhecidos, na ordem do bilhete, separados por ", " (ex.: "Gols, Escanteios"). NÃO use "Criador de Apostas" nesse caso — o Banca Pro já permite marcar múltiplos mercados no mesmo evento, então prefira sempre os nomes reais dos mercados quando eles existem na lista.
  3. Se PELO MENOS UMA condição não tiver mercado reconhecido na lista (nem variação aproximada clara), aí sim use "mercado" = "Criador de Apostas" para o confronto inteiro (mesmo que outras condições daquele confronto sejam reconhecidas) — mais simples e seguro do que misturar nomes reais com um item não mapeado.
  - Em ambos os casos: "selecao" = todas as condições unidas com ", " na ordem do bilhete; "odd" = a odd combinada do conjunto (não a soma das individuais).
  - ATENÇÃO CRÍTICA (erro recorrente): "mercado" e "selecao" precisam estar na MESMA ordem — a ordem em que as condições aparecem no bilhete, de cima para baixo. NUNCA reordene "mercado" em ordem alfabética (é o erro mais comum: colocar "Chutes no gol" antes de "Finalizações" só porque C vem antes de F na lista de mapeamento, mesmo quando o bilhete mostra Finalizações primeiro). Isso é especialmente crítico quando NENHUMA das condições tem nome de time na seleção (ex.: duas estatísticas do jogo inteiro combinadas) — nesse caso não sobra nenhuma pista pra saber depois qual valor pertence a qual mercado, então a ordem é a ÚNICA informação que garante o pareamento correto.
    Exemplo (bilhete mostra, nessa ordem: "Menos de 27.5" / "Total de Finalizações", depois "Menos de 9.5" / "Total de Chutes no Gol"):
    CORRETO → mercado: "Finalizações, Chutes no gol", selecao: "Menos de 27.5, Menos de 9.5" (mesma ordem nos dois campos, igual ao bilhete)
    ERRADO → mercado: "Chutes no gol, Finalizações" (reordenado alfabeticamente) com selecao: "Menos de 27.5, Menos de 9.5" (ordem do bilhete) — os dois campos ficam em ordens diferentes e a informação de qual valor é de qual mercado se perde.

Regra especial — SUPERBET NO APP MÓVEL (tela "Cupom de Aposta"):
- Um cabeçalho vermelho "CUPOM DE APOS..." no topo indica esse formato específico (print do aplicativo, não do site).
- Ignore COMPLETAMENTE qualquer cartão "Compartilhar sua aposta" / "Compartilhar no Supersocial" — é um convite de compartilhamento social, não faz parte dos dados da aposta.
- Cada evento aparece como: ícone + texto antes do "•" + "•" + nome da liga depois do "•" (ex.: "Internacional • Copa do Mundo 2026", ou "Inglaterra • Premier League"). Esse texto antes do "•" pode ser:
  • A palavra "Internacional" — nesse caso é só uma categoria genérica (torneio internacional/de seleções) e NÃO entra no campo "liga". Use apenas o texto depois do "•" (ex.: liga = "Copa do Mundo 2026").
  • O nome de um país (ex.: "Inglaterra", "Brasil", "Espanha") — nesse caso é o país ao qual aquele campeonato pertence, e deve ser INCORPORADO ao campo "liga" no formato "País - Liga" (ex.: "Inglaterra • Premier League" → liga = "Inglaterra - Premier League"; "Brasil • Brasileirão Série A" → liga = "Brasil - Brasileirão Série A").
  Em ambos os casos, use confiancaLiga alta (0.85-1.0), já que o texto está explícito no bilhete.
- O botão "+ Adicionar" no canto superior direito do cartão é elemento de interface — não é dado.
- Os nomes dos times aparecem empilhados em duas linhas, sem "x" nem "-" entre eles. Junte-os no campo "evento" como "Time A - Time B".
- Dentro do cartão "CRIAR APOSTA", cada condição aparece em duas linhas: a seleção em negrito (linha 1) e o mercado em cinza (linha 2) logo abaixo. Os círculos (○) ao lado de cada condição são apenas elementos visuais de interface — TODAS as condições listadas dentro do cartão fazem parte da aposta, independentemente do círculo estar preenchido ou vazio na imagem.
- Apostas de jogador aparecem no formato "Sobrenome, Nome - Mais de X" (ex.: "Messi, Lionel - Mais de 0.5"). Inverta para "Nome Sobrenome" ao compor a seleção final (ex.: "Lionel Messi - Mais de 0.5"), mantendo o mercado da linha de baixo (ex.: "Jogador - Chutes no Gol").
- Pequenos ícones ao lado de alguma condição (ex.: escudo colorido) são apenas indicadores visuais da casa (ex.: aposta protegida) — ignore-os, não fazem parte do texto da seleção.
- O cartão de resumo (identificador + data + odds totais + valor apostado) normalmente fica mais abaixo na tela, depois de todos os eventos — veja a regra de DATA DE REGISTRO e IDENTIFICADOR acima para o formato específico desse cartão.

Regra especial — TIPO DA APOSTA (Ao Vivo ou Pré Live):
- Se o bilhete mostrar qualquer sinal de que a aposta foi feita com a partida já em andamento — cronômetro rodando (ex.: "14'", "45+2'", "1°T 00", "2°T"), indicação de tempo/quarto/set atual do jogo, placar parcial sendo exibido junto ao confronto, ou rótulos explícitos como "AO VIVO", "LIVE", "IN-PLAY" — defina "tipo" como "Ao Vivo" e "confiancaGeral.tipo" alta (0.85 a 1.0).
- Se não houver nenhum desses sinais (o bilhete mostra apenas a data/hora futura do jogo, sem cronômetro nem placar em andamento visível), defina "tipo" como "Pré Live" e "confiancaGeral.tipo" alta (0.8 a 1.0) — é o padrão mais comum quando não há indicação em contrário.
- Se o bilhete for ambíguo (não fica claro se o jogo já começou ou não), defina "tipo" como "Pré Live" mas com "confiancaGeral.tipo" baixa (abaixo de 0.5), para sinalizar que precisa de revisão manual.
- Cuidado para não confundir a data/hora do JOGO (que pode estar no futuro em relação ao momento da aposta, mesmo em bilhetes ao vivo antigos já resolvidos) com o cronômetro de partida em andamento — o cronômetro (minutos, "T" de tempo/quarto) é o sinal confiável de que era ao vivo no momento da aposta.

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
→ 5 eventos: Grêmio - Atlético-GO (mercado: "Resultado Final", selecao: "Grêmio", odd: 1.62), Palmeiras - Fortaleza (mercado: "Resultado Final", selecao: "Palmeiras", odd: 1.40), Flamengo - Juventude-RS (mercado: "Resultado Final", selecao: "Flamengo", odd: 1.38), Atlético-MG - Internacional (mercado: "Handicap", selecao: "Internacional +1", odd: 1.33), Bragantino - Botafogo-RJ (mercado: "Handicap", selecao: "Botafogo-RJ +1", odd: 1.31)
→ liga: a Betano não mostra a liga no texto, mas TODOS esses times são times brasileiros de futebol, então infira "Brasil - Série A" para todos (nome oficial, não "Brasileirão"), com confiancaLiga 0.4 (inferência, não leitura direta do bilhete). Esse é o comportamento esperado sempre que a Betano não escrever a liga: nunca deixe liga como null só porque não achou o texto — primeiro tente inferir pelos times.

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
  Evento 1: esporte "Futebol", liga "Copa do Mundo 2026" (confiancaLiga: 0.95), evento "Inglaterra - RD do Congo", mercado "Classificar, Escanteios da Equipe" (ambos reconhecidos — "Se Classificar" → "Classificar", "Inglaterra - Total de Escanteios" → "Escanteios da Equipe" — por isso NÃO usa "Criador de Apostas" aqui), selecao "Classificar, Inglaterra - Mais de 4.5" (nome do time preservado), odd 1.35
  Evento 2: esporte "Futebol", liga "Copa do Mundo 2026" (confiancaLiga: 0.95), evento "EUA - Bósnia e Herzegovina", mercado "Intervalo", selecao "1", odd 1.37
→ Nota: "1º Tempo - Finalizações 1X2" na Superbet corresponde ao mercado "Intervalo" na lista cadastrada.

Observação para texto da Betano: o padrão é geralmente "SeleçãoODD" colado (ex: "Grêmio1.62"), seguido do mercado na linha seguinte, e depois o confronto ("Time A - Time B"). Extraia o confronto exatamente nesse formato, com hífen entre os nomes: "Time A - Time B".

Agora extraia os dados do texto do bilhete que será enviado a seguir, na mensagem do usuário, e devolva ESTRITAMENTE um JSON válido no seguinte formato:
${SCHEMA_JSON}
${REGRAS_COMUNS}`;

// ---- SCHEMA e PROMPT PARA ANÁLISE DE RISCO E ESTATÍSTICA DE APOSTA ----
// Diferente do leitor de bilhete (que EXTRAI dados), esta rota recebe os
// dados já preenchidos no formulário e devolve uma análise de RISCO,
// CONTEXTO e ESTATÍSTICA (com busca real na web) — nunca uma previsão
// garantida de resultado do jogo.
const SCHEMA_ANALISE = `
{
  "nivelRisco": "uma destas strings: Baixo, Médio, Alto",
  "resumo": "string — 2 a 4 frases em linguagem simples explicando o que está sendo apostado e o principal ponto de atenção geral da aposta como um todo",
  "alertas": ["lista de strings curtas com pontos de atenção específicos e objetivos sobre a aposta como um todo (ex: tamanho do acumulador, % da banca)"],
  "analisesEventos": [
    {
      "evento": "string — nome do confronto (ex: Time A - Time B)",
      "mercado": "string — mercado apostado nesse evento",
      "selecao": "string — a seleção escolhida (ex: Mais de 1.5 gols)",
      "probabilidadeImplicita": "number — probabilidade em % implícita pela ODD informada (1 ÷ ODD × 100), sempre preenchido",
      "dadosEncontrados": "boolean — true se a busca na web encontrou estatísticas relevantes e recentes sobre este confronto/mercado específico, false se não encontrou dados suficientes",
      "probabilidadeEstimada": "number ou null — percentual estimado com base nas estatísticas reais encontradas na busca (ex: média de gols dos últimos jogos, confrontos diretos). OBRIGATORIAMENTE null se dadosEncontrados for false — nunca invente um número aqui",
      "baseEstimativa": "string — se dadosEncontrados=true, descreva resumidamente em que dados concretos a estimativa se baseou (ex: 'média de 3.1 gols/jogo nos últimos 8 jogos do Time A e 2.4 do Time B, temporada 2026'). Se dadosEncontrados=false, explique objetivamente por que não achou (ex: 'não encontrei estatísticas recentes suficientes para este confronto/liga')",
      "comentario": "string curta com o contexto para o usuário"
    }
  ]
}`;

const PROMPT_ANALISE_APOSTA = `Você é um assistente de análise de RISCO e ESTATÍSTICA para apostas esportivas — você NÃO prevê resultado de jogos e nunca deve fingir que consegue fazer isso. Você vai receber os dados de uma aposta (em preenchimento ou já preenchida) no formato JSON, e deve devolver uma análise objetiva, usando a ferramenta de busca na web disponível para embasar sua resposta com dados estatísticos reais e recentes.

USO DA BUSCA NA WEB — MUITO IMPORTANTE:
- Para CADA evento da aposta, pesquise na web dados estatísticos reais e recentes que ajudem a estimar a probabilidade daquele mercado específico acontecer. Exemplos de como pesquisar por tipo de mercado:
  • Mercados de gols (ex: "Mais de 1.5 gols", "Menos de 2.5 gols"): pesquise a média de gols marcados/sofridos de cada time nos últimos jogos (ideal: últimos 5 a 10 jogos), e se possível o histórico de confrontos diretos entre os dois times.
  • Mercados de resultado/vencedor: pesquise forma recente dos times (sequência de vitórias/derrotas/empates), posição na tabela, confrontos diretos recentes.
  • Mercados de escanteios/cartões/finalizações: pesquise médias recentes dessas estatísticas para os times envolvidos, se disponíveis.
  • Outros mercados sem dado estatístico direto disponível (ex: jogador específico, mercados muito específicos): é aceitável não encontrar dados — nesse caso, "dadosEncontrados" deve ser false.
- Priorize fontes com dados recentes e específicos (sites de estatísticas esportivas, resultados de jogos recentes, tabelas de campeonato). Evite basear a estimativa em opiniões, palpites de terceiros ou "dicas de apostas" — você quer NÚMEROS reais (médias, resultados), não opiniões.
- SEMPRE que não encontrar dados estatísticos concretos e recentes o suficiente para embasar uma estimativa razoável, defina "dadosEncontrados": false e "probabilidadeEstimada": null — NUNCA invente ou "chute" um número só para preencher o campo. É preferível dizer claramente que não encontrou dados do que apresentar uma estimativa sem base real.
- A "probabilidadeEstimada" é uma ESTIMATIVA baseada em estatística histórica, não uma previsão garantida — jogos têm fatores que estatística pura não captura (lesões de última hora, motivação, clima). Isso deve ficar implícito no tom do "comentario" de cada evento, sem precisar repetir o aviso em cada um (o aviso geral já aparece na interface).

REGRAS GERAIS IMPORTANTES:
- NUNCA diga ou insinue se a aposta "vai ganhar", "tem grande chance de ganhar" ou qualquer julgamento definitivo sobre o resultado real do jogo. A probabilidade estimada é sobre o mercado específico com base em dados históricos — não uma garantia.
- No "resumo" e nos "alertas" gerais, aponte riscos objetivos da aposta como um todo:
  • Acumuladores: quanto mais eventos, menor a chance combinada de todos ganharem juntos — mencione isso quando houver 3+ eventos.
  • Se "saldoAtualCasa" foi informado e for maior que zero, calcule que percentual do saldo o "stake" representa; sinalize como atenção se passar de ~10-15% do saldo (gestão de banca básica).
  • ODDs muito baixas (ex: abaixo de 1.20) → retorno pequeno para o risco assumido. ODDs muito altas (ex: acima de 5.00) → baixíssima probabilidade implícita.
  • Campos vazios/zerados relevantes, ODD Total que não bate com o produto das odds dos eventos informados.
  • Se a "probabilidadeEstimada" de algum evento estiver bem abaixo da "probabilidadeImplicita" da odd, isso é um sinal de que a odd pode estar "cara" para o risco real — vale mencionar como alerta.
- "nivelRisco": classifique com base em critérios objetivos (tamanho do acumulador, % da banca arriscado quando disponível, odds extremas, e divergência entre probabilidade implícita e estimada quando houver dados) — nunca com base em achismo sobre quem vai ganhar o jogo.
- Preencha "analisesEventos" para TODOS os eventos recebidos na aposta, na mesma ordem.
- Seja direto e conciso. Responda APENAS com o JSON puro, sem texto antes ou depois, sem markdown, sem crases — mesmo tendo usado a ferramenta de busca antes, a resposta final deve ser só o JSON.

Formato de saída:
${SCHEMA_ANALISE}`;

const SCHEMA_BUSCAR_LIGA = `
{
  "encontrado": "boolean — true somente se a busca na web confirmou com boa confiança em qual liga/competição esse confronto aconteceu ou está programado para acontecer",
  "liga": "string — nome da liga no formato 'País - Divisão' (ex: 'Brasil - Série A', 'Inglaterra - Premier League'); torneios internacionais mantêm o nome padrão sem prefixo de país (ex: 'Champions League', 'Copa Libertadores'). String vazia se encontrado=false",
  "esporte": "string — o esporte do confronto (ex: 'Futebol', 'Basquete', 'Tênis'), confirmado pela busca. Preencha sempre que a busca identificar o confronto com confiança, mesmo que o esporte já tenha vindo preenchido na entrada (nesse caso, apenas confirme o mesmo valor). String vazia se não conseguir identificar",
  "dataHoraEncontrada": "boolean — true somente se a busca confirmou a data (no mínimo) do confronto com confiança razoável. Independente do resultado de 'encontrado'/'liga' — dá pra confirmar a data sem confirmar a liga, e vice-versa",
  "dataHora": "string — data e hora do confronto no formato 'AAAA-MM-DDTHH:MM', SEMPRE convertida para horário de Brasília (America/Sao_Paulo), mesmo que o jogo seja em outro país/fuso. String vazia se dataHoraEncontrada=false",
  "confianca": "number de 0 a 1 — o quanto você confia no resultado da LIGA (leve em conta ambiguidade de nomes de time repetidos em vários países)",
  "confiancaDataHora": "number de 0 a 1 — o quanto você confia especificamente na DATA/HORA encontrada (pode ser diferente da confiança da liga: às vezes a data é fácil de confirmar mas o horário exato de bola rolando não, ou vice-versa)",
  "observacao": "string curta — se encontrado=true, cite brevemente a base (ex: 'confirmado via tabela do campeonato atual'). Se encontrado=false, explique objetivamente por que (ex: 'não encontrei esse confronto específico nas competições em andamento')"
}`;

const PROMPT_BUSCAR_LIGA = `Você é um assistente que identifica em qual liga ou competição esportiva um confronto específico foi ou será disputado, E a data/hora desse confronto, usando a ferramenta de busca na web disponível. Você vai receber o nome do evento/confronto (ex: "Time A x Time B"), o esporte quando já for conhecido (pode vir null/ausente — nesse caso você também precisa identificar o esporte) e, quando disponível, uma data de referência (data em que a aposta foi registrada), em formato JSON.

QUANDO O ESPORTE NÃO FOR INFORMADO (null/ausente):
- Identifique o esporte a partir dos nomes dos competidores/times e do contexto encontrado na busca (ex: nomes de clube de futebol, duplas de tênis, franquias de basquete). Preencha o campo "esporte" da resposta com o que identificar.
- Se não conseguir identificar o esporte com confiança, trate como não encontrado: "encontrado": false.
- Quando o esporte JÁ vier informado, apenas confirme-o de volta no campo "esporte" da resposta (não precisa buscar isso, só ecoar).

USO DA DATA DE REFERÊNCIA — MUITO IMPORTANTE:
- Quando "dataReferencia" vier preenchida, use-a para achar a temporada/rodada certa do confronto, não a mais recente disponível hoje. Times mudam de divisão entre temporadas (acesso/rebaixamento) — a liga de um time HOJE pode não ser a mesma de quando o confronto aconteceu.
- A dataReferencia é a data em que a APOSTA foi registrada, não necessariamente a data do jogo — o apostador costuma registrar a aposta no mesmo dia do jogo ou com alguns dias de antecedência (raramente depois). Ou seja, procure o confronto na dataReferencia ou em dias seguintes próximos a ela; considere uma data de jogo anterior à dataReferencia só se não encontrar nada em dataReferencia ou depois.
- Sem "dataReferencia", assuma que o confronto é recente/atual e busque a temporada em andamento.

DATA/HORA DO CONFRONTO — MUITO IMPORTANTE:
- Além da liga, procure a data e hora programada (ou já disputada) do confronto — normalmente aparece na mesma página que confirma a liga (Sofascore e 365scores mostram isso).
- CONVERSÃO DE FUSO É OBRIGATÓRIA: o valor de "dataHora" na resposta deve estar SEMPRE em horário de Brasília (America/Sao_Paulo, UTC-3, sem horário de verão desde 2019), independente de onde o jogo aconteça. Se a página mostrar o horário em UTC, GMT, horário local do país sede, ou qualquer outro fuso, converta para Brasília antes de responder. Se não conseguir identificar com segurança em qual fuso a página está exibindo o horário, prefira reduzir "confiancaDataHora" a arriscar uma conversão errada.
- O QUE IMPORTA MAIS AQUI É A DATA (o dia, em horário de Brasília), não o minuto exato — esse app usa essa informação principalmente para localizar o jogo certo em uma lista de jogos daquele dia. Se você tem certeza razoável do dia mas não do horário exato de bola rolando, ainda assim preencha "dataHora" com sua melhor estimativa de horário e reflita a incerteza apenas em "confiancaDataHora" — não deixe de preencher a data só por imprecisão no minuto.
- Se não conseguir confirmar nem a data com confiança razoável, defina "dataHoraEncontrada": false e "dataHora": "" — nunca invente uma data/hora sem base na busca.
- "dataHoraEncontrada" e "encontrado" (liga) são independentes: é possível confirmar a data sem confirmar a liga, ou confirmar a liga sem achar o horário exato — preencha cada um com base no que a busca realmente confirmou.

USO DA BUSCA NA WEB — MUITO IMPORTANTE:
- Pesquise o confronto informado (times + data de referência, se houver) para descobrir a liga/competição/campeonato em que ele foi disputado, e a data/hora do confronto.
- Ao formular suas buscas, dê preferência a fontes como sofascore.com e 365scores.com quando fizer sentido — costumam ter esse tipo de informação de forma organizada — mas use qualquer fonte confiável que encontrar.
- Nomes de time podem ser ambíguos (o mesmo nome existe em várias ligas/países diferentes) — use o contexto disponível (esporte informado, data de referência, outros times mencionados) para reduzir ambiguidade, mas NUNCA garanta uma resposta apenas por familiaridade com um nome de time conhecido sem confirmar via busca.
- Se não encontrar o confronto específico com confiança razoável (ex: nome de time comum a várias ligas, informação insuficiente, evento não encontrado, data de referência ausente e ambiguidade alta), defina "encontrado": false e "liga": "" — NUNCA invente ou "chute" uma liga só para preencher o campo. O mesmo vale para "dataHoraEncontrada"/"dataHora".

AMBIGUIDADE DE NOMES DE TIME — EXEMPLOS REAIS PARA CALIBRAR SUA BUSCA:
- "América" existe como clube em vários lugares: América-MG e América-RN (Brasil, divisões diferentes entre si), Club América (México), América de Cali (Colômbia) — nunca assuma qual é sem confirmar pelo confronto completo (o adversário informado costuma resolver a ambiguidade).
- "Nacional" também é comum a vários países (Uruguai, Paraguai, Portugal, Colômbia) — mesmo cuidado.
- "Independiente" pode ser o clube argentino tradicional ou outros clubes menores com nome parecido em outros países da América Latina.
- Times com nomes de cidade genéricos (ex: "Santos", "União", "Rio Branco") se repetem entre estados/divisões dentro do próprio Brasil — combine com o adversário e, se disponível, a data de referência, antes de decidir a liga.
- Regra geral: quanto mais genérico o nome do time, maior o cuidado — prefira buscar pelo confronto completo ("Time A x Time B") em vez de cada time isoladamente, já que o par de times reduz a ambiguidade muito mais rápido que um nome sozinho.

REGRAS DE FORMATO:
- A liga deve seguir o padrão "País - Divisão", EXCETO torneios internacionais/continentais, que mantêm o nome padrão sem prefixo de país (ex: "Champions League", "Copa Libertadores", "Copa do Mundo", "Europa League", "Sul-Americana").
- Nunca use nome comercial de patrocínio da liga (ex: use "Inglaterra - Championship", não "Sky Bet Championship"; use "Brasil - Série A", não "Brasileirão Betano" ou variações com marca de patrocinador), a menos que seja o nome oficial sem alternativa.
- Referência de nomenclatura por país (use o nome oficial da divisão, sem patrocínio, seguindo esse padrão para países não listados aqui também):
  - Brasil: "Brasil - Série A", "Brasil - Série B", "Brasil - Série C", "Brasil - Série D", além de estaduais (ex: "Brasil - Campeonato Paulista").
  - Inglaterra: "Inglaterra - Premier League", "Inglaterra - Championship", "Inglaterra - League One", "Inglaterra - League Two".
  - Espanha: "Espanha - La Liga", "Espanha - Segunda División".
  - Itália: "Itália - Serie A", "Itália - Serie B".
  - Alemanha: "Alemanha - Bundesliga", "Alemanha - 2. Bundesliga".
  - França: "França - Ligue 1", "França - Ligue 2".
  - Portugal: "Portugal - Primeira Liga", "Portugal - Liga Portugal 2".
  - Argentina: "Argentina - Liga Profesional", "Argentina - Primera Nacional".
- "dataHora" deve seguir exatamente o formato "AAAA-MM-DDTHH:MM" (ex: "2026-08-25T21:30"), sempre em horário de Brasília.
- Responda APENAS com o JSON puro, sem texto antes ou depois, sem markdown, sem crases — mesmo tendo usado a ferramenta de busca antes, a resposta final deve ser só o JSON.

EXEMPLOS DE SAÍDA ESPERADA:
- Confronto e data/hora identificados com confiança, esporte já informado na entrada: {"encontrado": true, "liga": "Brasil - Série A", "esporte": "Futebol", "dataHoraEncontrada": true, "dataHora": "2026-08-25T21:30", "confianca": 0.95, "confiancaDataHora": 0.9, "observacao": "confirmado via tabela do campeonato atual"}
- Liga identificada, mas horário exato incerto (só o dia confirmado): {"encontrado": true, "liga": "Inglaterra - Premier League", "esporte": "Futebol", "dataHoraEncontrada": true, "dataHora": "2026-08-30T13:00", "confianca": 0.9, "confiancaDataHora": 0.55, "observacao": "dia confirmado; horário de bola rolando aproximado, não encontrei confirmação exata do minuto"}
- Confronto não identificado com confiança suficiente, nem liga nem data: {"encontrado": false, "liga": "", "esporte": "", "dataHoraEncontrada": false, "dataHora": "", "confianca": 0, "confiancaDataHora": 0}

Formato de saída:
${SCHEMA_BUSCAR_LIGA}`;

// ---- Checagem de acesso à IA: valida o token do usuário e confere ai_enabled ----
// Retorna { ok: true } ou { ok: false, status, message }
async function checarAcessoIA(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');

  if (!accessToken) {
    return { ok: false, status: 401, message: 'Sessão não encontrada. Faça login novamente.' };
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return { ok: false, status: 500, message: 'Configuração do Supabase ausente no servidor.' };
  }

  const userResp = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + accessToken }
  });
  if (!userResp.ok) {
    return { ok: false, status: 401, message: 'Sessão inválida ou expirada. Faça login novamente.' };
  }
  const userData = await userResp.json();

  const profileResp = await fetch(
    env.SUPABASE_URL + '/rest/v1/profiles_modulos?user_id=eq.' + userData.id + '&modulo=eq.banca&select=ai_enabled',
    { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + accessToken } }
  );
  if (!profileResp.ok) {
    return { ok: false, status: 500, message: 'Não foi possível checar sua permissão de uso da IA.' };
  }
  const rows = await profileResp.json();
  if (!rows.length || rows[0].ai_enabled !== true) {
    return { ok: false, status: 403, message: 'O acesso às funcionalidades de IA está desativado para este usuário. Fale com o administrador.' };
  }

  return { ok: true };
}

// Incrementa o contador de uso de IA do usuário logado, separando por tipo
// (leitura de bilhete vs análise de estatísticas/risco). Melhor esforço:
// nunca deve quebrar a resposta já obtida para o usuário.
async function registrarUsoIA(accessToken, env, tipo) {
  const categoria = tipo === 'estatisticas' ? 'estatisticas'
    : tipo === 'liga' ? 'liga'
    : 'bilhete';
  try {
    await fetch(env.SUPABASE_URL + '/rest/v1/rpc/banca_increment_ai_calls', {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ categoria })
    });
  } catch (e) {
    console.log('[uso-ia] falha ao registrar uso (ignorado):', e.message);
  }
}

// ---- HANDLER PRINCIPAL (formato Cloudflare Workers) ----
export default {
  async fetch(request, env, ctx) {
    try {
      return await handleFetch(request, env, ctx);
    } catch (erroFatal) {
      // Rede de segurança: qualquer erro não previsto abaixo cai aqui,
      // garantindo que a resposta seja sempre um JSON legível.
      return new Response(
        JSON.stringify({ error: 'Erro inesperado no servidor: ' + (erroFatal && erroFatal.message) }),
        {
          status: 500,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Content-Type': 'application/json',
          }
        }
      );
    }
  },
};

async function handleFetch(request, env, ctx) {
    const url = new URL(request.url);

    // Só tratamos aqui as rotas da API. Qualquer outra URL (o próprio site,
    // imagens, etc.) é devolvida pelos arquivos estáticos normalmente.
    const ROTAS_API = ['/api/ler-bilhete', '/api/analisar-aposta', '/api/buscar-liga', '/api/checar-apostas'];
    if (!ROTAS_API.includes(url.pathname)) {
      return env.ASSETS.fetch(request);
    }

    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Método não permitido.' }), { status: 405, headers });
    }

    let acesso;
    try {
      acesso = await checarAcessoIA(request, env);
    } catch (erroChecagem) {
      return new Response(
        JSON.stringify({ error: 'Erro ao checar permissão de IA: ' + erroChecagem.message }),
        { status: 500, headers }
      );
    }
    if (!acesso.ok) {
      return new Response(JSON.stringify({ error: acesso.message }), { status: acesso.status, headers });
    }
    const accessToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');

    let payload;
    try { payload = await request.json(); }
    catch (e) { return new Response(JSON.stringify({ error: 'Corpo da requisição inválido.' }), { status: 400, headers }); }

    // ---- Rota unificada de checagem de apostas (placar + estatísticas + IA) ----
    // Combina API-Football (placar e estatísticas) com um julgamento por IA
    // como último passo da cascata (ver handleCheckApostas) — por isso, ao
    // contrário das rotas abaixo, não usa o pipeline comBusca/tipoUso/schemaTipo
    // (a chamada de IA, quando acontece, é feita internamente por
    // julgarMercadoComIA, sem busca na web).
    if (url.pathname === '/api/checar-apostas') {
      return await handleCheckApostas(payload, env, headers);
    }

    let imagemBase64, mediaType, textoBilhete, systemInstrucoes, textoCorrecoes;
    // Busca real na web só nas rotas que precisam de dado atualizado/externo.
    const comBusca = url.pathname === '/api/analisar-aposta' || url.pathname === '/api/buscar-liga';
    const tipoUso = url.pathname === '/api/analisar-aposta' ? 'estatisticas'
      : url.pathname === '/api/buscar-liga' ? 'liga'
      : 'bilhete';

    // ---- Preferência de provedor de IA (Configurações → 🤖 Provedor de IA) ----
    // O app envia essa preferência por chamada, já que cada uma das três rotas
    // (bilhete, estatísticas, liga) pode ter um provedor configurado separadamente.
    // 'ambas' (padrão) mantém o comportamento original: Gemini primeiro, com
    // fallback automático para Anthropic se falhar. 'gemini' ou 'anthropic' força
    // o uso exclusivo daquele provedor, sem fallback para o outro.
    const PROVEDORES_VALIDOS = ['gemini', 'anthropic', 'ambas'];
    let provedorPreferido = (payload && typeof payload.provedorPreferido === 'string') ? payload.provedorPreferido : 'ambas';
    if (!PROVEDORES_VALIDOS.includes(provedorPreferido)) provedorPreferido = 'ambas';
    // Controla qual schema usar ao sanitizar uma resposta que caiu no modo sem
    // busca (ver sanearRespostaSemBusca) — cada rota tem um formato de retorno diferente.
    const schemaTipo = url.pathname === '/api/buscar-liga' ? 'buscar-liga'
      : url.pathname === '/api/analisar-aposta' ? 'analise'
      : null;

    if (url.pathname === '/api/analisar-aposta') {
      // ---- Rota de análise de risco (não extrai dados, recebe dados já preenchidos) ----
      const { aposta } = payload || {};
      if (!aposta) {
        return new Response(JSON.stringify({ error: 'Envie os dados da aposta no campo "aposta".' }), { status: 400, headers });
      }
      systemInstrucoes = PROMPT_ANALISE_APOSTA;
      textoBilhete = JSON.stringify(aposta); // reaproveita o caminho de "texto" das funções de provedor abaixo
    } else if (url.pathname === '/api/buscar-liga') {
      // ---- Rota de busca de liga por IA (usada no preenchimento manual de apostas antigas) ----
      // "esporte" agora é opcional: quando ausente, a IA também tenta identificar o esporte
      // a partir dos nomes dos competidores e da data de referência.
      const { esporte, evento, dataReferencia } = payload || {};
      if (!evento) {
        return new Response(JSON.stringify({ error: 'Envie "evento" para buscar a liga.' }), { status: 400, headers });
      }
      systemInstrucoes = PROMPT_BUSCAR_LIGA;
      textoBilhete = JSON.stringify({ esporte: esporte || null, evento, dataReferencia: dataReferencia || null });
    } else {
      // ---- Rota original: leitor de bilhete por foto ou texto ----
      ({ imagemBase64, mediaType, textoBilhete } = payload || {});

      if (!imagemBase64 && !textoBilhete) {
        return new Response(
          JSON.stringify({ error: 'Envie imagemBase64+mediaType (foto) ou textoBilhete (texto colado).' }),
          { status: 400, headers }
        );
      }

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

      // ---- Correções aprendidas de leituras anteriores (memória de correções) ----
      // O app envia aqui até algumas dezenas de correções que o próprio usuário já
      // fez no passado (liga/mercado que a IA errou e o usuário ajustou manualmente
      // antes de salvar). Isso é enviado como texto avulso, FORA do bloco de system
      // prompt (que fica em cache), para não invalidar o cache a cada correção nova
      // e para não misturar dado específico do usuário com a instrução genérica.
      const correcoesConhecidas = Array.isArray(payload?.correcoesConhecidas) ? payload.correcoesConhecidas : [];
      if (correcoesConhecidas.length > 0) {
        // Mercado é vocabulário pequeno e fixo (nomes de mercado de casa de
        // apostas) e a correção não tem prazo de validade — por isso vai
        // inteira, sem teto. Liga é o que cresce sem parar com o tempo (cada
        // confronto/temporada gera correções novas) — aqui limitamos pelas
        // mais recentes, para não estourar o prompt. Antes as duas listas
        // eram cortadas juntas num teto único de 60, o que fazia correções de
        // Mercado antigas (mas ainda válidas) serem empurradas pra fora pelo
        // volume de correções de Liga acumuladas ao longo do tempo.
        const correcoesMercado = correcoesConhecidas.filter((c) => c.campo === 'mercado');
        const correcoesLiga = correcoesConhecidas.filter((c) => c.campo !== 'mercado').slice(0, 60);
        const linhas = [...correcoesMercado, ...correcoesLiga].map((c) => {
          const campo = c.campo === 'liga' ? 'Liga' : c.campo === 'mercado' ? 'Mercado' : c.campo;
          const contexto = c.contexto ? ` (contexto: ${c.contexto})` : '';
          return `- [${campo}] Em vez de "${c.valorErrado}", o usuário já corrigiu para "${c.valorCorreto}" — esporte: ${c.esporte}${contexto}.`;
        }).join('\n');
        textoCorrecoes = `CORREÇÕES APRENDIDAS DE LEITURAS ANTERIORES — o usuário já corrigiu manualmente estas sugestões da IA em bilhetes passados. Quando o contexto do bilhete atual combinar (mesmos times, mesma liga/competição, ou claramente o mesmo caso), a preferência já confirmada pelo usuário abaixo é a fonte de verdade e DEVE prevalecer sobre sua própria inferência — inclusive quando seu conhecimento de treinamento parecer indicar outra coisa. Isso é especialmente importante para correções de Liga: times sobem e descem de divisão entre temporadas, e a correção do usuário reflete a situação real mais recente, que pode ser mais atual do que os dados que você memorizou no treinamento. Se o contexto não combinar com nenhuma linha, ignore esta lista normalmente:\n${linhas}\n\nAgora, aplicando essas preferências sempre que o contexto combinar, extraia os dados do bilhete a seguir, seguindo todas as regras do system prompt.`;
      }
    }

    // ---- 1ª TENTATIVA: GEMINI (grátis) ----
    // Só entra aqui se a preferência não for "Somente Anthropic".
    const tentarGemini = provedorPreferido !== 'anthropic';
    let erroGeminiDetalhe = null;
    if (tentarGemini) {
      if (env.GEMINI_API_KEY) {
        try {
          const extraido = await lerComGemini({
            apiKey: env.GEMINI_API_KEY,
            systemInstrucoes,
            textoBilhete,
            imagemBase64,
            mediaType,
            comBusca,
            textoCorrecoes,
            schemaTipo,
          });
          ctx.waitUntil(registrarUsoIA(accessToken, env, tipoUso));
          return new Response(JSON.stringify({ ...extraido, _provedor: 'gemini' }), { status: 200, headers });
        } catch (erroGemini) {
          // Guarda o erro real (truncado) para devolver ao usuário se a Anthropic
          // também falhar — assim dá para diagnosticar sem precisar de `wrangler tail`.
          erroGeminiDetalhe = String(erroGemini.message || erroGemini).slice(0, 500);
          if (provedorPreferido === 'gemini') {
            // Preferência do usuário é "Somente Gemini" — não cai para a Anthropic.
            console.log('[provedor] Gemini falhou e o fallback está desativado (preferência: Somente Gemini):', erroGeminiDetalhe);
            return new Response(
              JSON.stringify({
                error: 'O Gemini falhou e o provedor de IA está definido como "Somente Gemini" em Configurações → 🤖 Provedor de IA, então não foi tentado o fallback para a Anthropic. Detalhe: ' + erroGeminiDetalhe,
              }),
              { status: 502, headers }
            );
          }
          console.log('[fallback] Gemini falhou, tentando Anthropic:', erroGeminiDetalhe);
        }
      } else {
        erroGeminiDetalhe = 'GEMINI_API_KEY não configurada neste Worker.';
        if (provedorPreferido === 'gemini') {
          return new Response(
            JSON.stringify({ error: 'O provedor de IA está definido como "Somente Gemini", mas a GEMINI_API_KEY não está configurada neste Worker.' }),
            { status: 500, headers }
          );
        }
        console.log('[fallback] GEMINI_API_KEY não configurada, indo direto para Anthropic.');
      }
    }

    // ---- 2ª TENTATIVA: ANTHROPIC ----
    // Entra aqui automaticamente no fallback (preferência "ambas"), ou diretamente
    // quando a preferência é "Somente Anthropic" (tentarGemini = false, sem passar pelo Gemini).
    if (!env.ANTHROPIC_API_KEY) {
      const mensagem = provedorPreferido === 'anthropic'
        ? 'O provedor de IA está definido como "Somente Anthropic", mas a ANTHROPIC_API_KEY não está configurada neste Worker.'
        : 'Nem GEMINI_API_KEY nem ANTHROPIC_API_KEY estão configuradas no Cloudflare.';
      return new Response(JSON.stringify({ error: mensagem }), { status: 500, headers });
    }

    try {
      const extraido = await lerComAnthropic({
        apiKey: env.ANTHROPIC_API_KEY,
        systemInstrucoes,
        textoBilhete,
        imagemBase64,
        mediaType,
        comBusca,
        textoCorrecoes,
        schemaTipo,
      });
      ctx.waitUntil(registrarUsoIA(accessToken, env, tipoUso));
      return new Response(JSON.stringify({ ...extraido, _provedor: 'anthropic' }), { status: 200, headers });
    } catch (erroAnthropic) {
      return new Response(
        JSON.stringify({
          error: 'Erro ao processar (Gemini e Anthropic falharam, ou Anthropic era o único provedor tentado): ' + erroAnthropic.message +
            (erroGeminiDetalhe ? ' | Detalhe do Gemini: ' + erroGeminiDetalhe : ''),
        }),
        { status: 502, headers }
      );
    }
}

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

async function lerComGemini({ apiKey, systemInstrucoes, textoBilhete, imagemBase64, mediaType, comBusca, textoCorrecoes, schemaTipo }) {
  const parteConteudo = textoBilhete
    ? { text: textoBilhete }
    : { inline_data: { mime_type: mediaType, data: imagemBase64 } };
  // Correções aprendidas de leituras anteriores (memória de correções): entram como
  // uma "part" de texto adicional, antes do conteúdo do bilhete em si.
  const partesConteudo = textoCorrecoes ? [{ text: textoCorrecoes }, parteConteudo] : [parteConteudo];

  try {
    return await tentarModelosGemini({ apiKey, systemInstrucoes, partesConteudo, usarBusca: comBusca });
  } catch (erroComBusca) {
    if (!comBusca) throw erroComBusca; // não havia busca envolvida, nada mais a tentar
    // Nenhum modelo candidato conseguiu responder usando a ferramenta de busca
    // (típico quando nenhum dos modelos da lista suporta grounding no momento, ou
    // quando a cota de Grounding with Google Search não está liberada na conta —
    // ela exige billing vinculado no projeto, mesmo dentro da faixa gratuita).
    // Antes de gastar crédito no fallback pago da Anthropic, tenta os mesmos
    // modelos MAIS UMA VEZ sem a ferramenta de busca — ainda gratuito no Gemini,
    // só que sem estatística real (só a análise de risco básica).
    console.log('[gemini] Todos os modelos falharam com busca ativada, tentando novamente sem busca:', erroComBusca.message);
    // Instrução extra, específica deste modo degradado: sem isso, o próprio
    // modelo pode "alucinar" números plausíveis (médias, estatísticas) mesmo
    // sem ter pesquisado nada — o que já foi observado acontecendo na prática.
    // Reforça aqui, mas o código abaixo (sanearRespostaSemBusca) é quem garante
    // isso de fato, não confiando só na obediência do modelo à instrução.
    const avisoSemBusca = {
      text: schemaTipo === 'buscar-liga'
        ? 'ATENÇÃO: a ferramenta de busca na web NÃO está disponível nesta chamada — você não pesquisou nada agora, mesmo que "lembre" de informações gerais sobre os times. É TERMINANTEMENTE PROIBIDO preencher "liga" ou "dataHora" com qualquer valor baseado em memória própria — defina "encontrado": false, "liga": "", "dataHoraEncontrada": false, "dataHora": "" e em "observacao" escreva apenas algo como "Busca na web indisponível nesta chamada".'
        : 'ATENÇÃO: a ferramenta de busca na web NÃO está disponível nesta chamada — você não pesquisou nada agora, mesmo que "lembre" de informações gerais sobre os times. É TERMINANTEMENTE PROIBIDO preencher "probabilidadeEstimada" com qualquer número ou descrever estatísticas específicas (médias, resultados recentes) em "baseEstimativa" — para TODOS os eventos, defina "dadosEncontrados": false, "probabilidadeEstimada": null, e em "baseEstimativa" escreva apenas algo como "Busca de estatísticas indisponível nesta análise". Continue preenchendo normalmente "nivelRisco", "resumo" e "alertas" com base só nos dados da aposta fornecidos e na probabilidade implícita da odd.',
    };
    const resultadoSemBusca = await tentarModelosGemini({
      apiKey,
      systemInstrucoes,
      partesConteudo: [avisoSemBusca, ...partesConteudo],
      usarBusca: false,
    });
    // Sanitiza a resposta independentemente do que o modelo tenha escrito — a
    // garantia de "nenhuma estatística/liga inventada" não pode depender só de o
    // modelo obedecer à instrução acima.
    return sanearRespostaSemBusca(resultadoSemBusca, schemaTipo);
  }
}

// Remove à força qualquer estimativa/dado que dependa de busca real de uma
// resposta que foi gerada SEM a ferramenta de busca disponível, e marca a
// resposta como tal — garante que nenhum dado "alucinado" pelo modelo chegue
// ao usuário como se fosse baseado em uma pesquisa real.
function sanearRespostaSemBusca(resultado, schemaTipo) {
  if (!resultado || typeof resultado !== 'object') return resultado;
  resultado._buscaIndisponivel = true;
  if (schemaTipo === 'buscar-liga') {
    resultado.encontrado = false;
    resultado.liga = '';
    resultado.confianca = 0;
    resultado.dataHoraEncontrada = false;
    resultado.dataHora = '';
    resultado.confiancaDataHora = 0;
    resultado.observacao = 'Busca na web indisponível nesta chamada — não foi possível confirmar a liga nem a data/hora.';
    return resultado;
  }
  if (Array.isArray(resultado.analisesEventos)) {
    resultado.analisesEventos = resultado.analisesEventos.map((ev) => ({
      ...ev,
      dadosEncontrados: false,
      probabilidadeEstimada: null,
      baseEstimativa: 'Busca de estatísticas indisponível nesta análise — nenhuma estimativa foi gerada.',
    }));
  }
  return resultado;
}

// Percorre a lista de modelos candidatos uma vez, com ou sem a ferramenta de
// busca, tentando o próximo em caso de indisponibilidade. Lança o último erro
// se nenhum candidato responder.
async function tentarModelosGemini({ apiKey, systemInstrucoes, partesConteudo, usarBusca }) {
  let ultimoErro = null;

  for (const modelo of MODELOS_GEMINI_CANDIDATOS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`;
    try {
      const corpoRequisicao = {
        systemInstruction: { parts: [{ text: systemInstrucoes }] },
        contents: [{ role: 'user', parts: partesConteudo }],
        generationConfig: { temperature: 0 },
      };
      // Grounding com Google Search: permite ao modelo pesquisar dados reais na web
      // (estatísticas de jogos, médias de gols etc.) antes de responder — usado só
      // na rota de Analisar Aposta, nunca no leitor de bilhete.
      if (usarBusca) corpoRequisicao.tools = [{ google_search: {} }];

      const resposta = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpoRequisicao),
      });

      if (!resposta.ok) {
        const corpoErro = await resposta.text();
        // Modelo descontinuado/inexistente (404) ou indisponível (503): tenta o
        // próximo candidato. Com busca (usarBusca) ativada, um erro 400 também é
        // tratado como "tenta o próximo modelo" — é o sintoma típico de um modelo
        // que não suporta a ferramenta de busca/grounding (ex.: variantes "lite"),
        // e não deve abortar toda a tentativa Gemini já na primeira falha.
        const tentarProximoModelo = resposta.status === 404 || resposta.status === 503 ||
          (usarBusca && resposta.status === 400);
        if (tentarProximoModelo) {
          console.log(`[gemini] Modelo "${modelo}" falhou (${resposta.status}) [busca=${usarBusca}], tentando o próximo candidato. Detalhe: ${corpoErro.slice(0, 300)}`);
          ultimoErro = new Error(`Gemini (${modelo}, busca=${usarBusca}) retornou ${resposta.status}: ${corpoErro}`);
          continue;
        }
        // Outros erros (ex.: 429 rate limit, chave inválida) não são resolvidos
        // trocando de modelo — propaga direto para quem chamou.
        throw new Error(`Gemini (${modelo}, busca=${usarBusca}) retornou ${resposta.status}: ${corpoErro}`);
      }

      const dados = await resposta.json();
      // Com grounding, a resposta pode vir em múltiplas "parts" (texto intercalado
      // com chamadas de busca) — concatena todas as partes de texto, não só a primeira.
      const partes = dados?.candidates?.[0]?.content?.parts || [];
      const texto = partes.map((p) => p.text || '').join('').trim();
      if (!texto) {
        throw new Error(`Gemini (${modelo}, busca=${usarBusca}) não retornou texto utilizável (possível bloqueio de segurança ou resposta vazia).`);
      }

      // Confirmação extra: quando a busca deveria ter sido usada, exige que o
      // Gemini tenha de fato registrado metadados de grounding (evidência real
      // de que uma pesquisa foi executada). Sem isso, o modelo pode responder
      // "normalmente" com números que parecem estatística mas são só memória
      // própria — trata como falha desta tentativa em vez de aceitar às cegas.
      if (usarBusca && !dados?.candidates?.[0]?.groundingMetadata) {
        throw new Error(`Gemini (${modelo}, busca=${usarBusca}) respondeu sem evidência de busca real (sem groundingMetadata) — descartando para não aceitar estatística não verificada.`);
      }

      return parsearJSON(texto);
    } catch (e) {
      ultimoErro = e;
      // Erros de rede/parse também tentam o próximo candidato, por segurança.
      continue;
    }
  }

  throw ultimoErro || new Error(`Nenhum modelo Gemini candidato respondeu (busca=${usarBusca}).`);
}

// ==================== PROVEDOR: ANTHROPIC ====================
async function lerComAnthropic({ apiKey, systemInstrucoes, textoBilhete, imagemBase64, mediaType, comBusca, textoCorrecoes, schemaTipo }) {
  const blocoConteudo = textoBilhete
    ? { type: 'text', text: textoBilhete }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: imagemBase64 } };
  // Correções aprendidas de leituras anteriores (memória de correções): entram como
  // um bloco de texto adicional, antes do conteúdo do bilhete em si — fora do
  // "system" (que fica em cache) para não gerar um cache novo a cada correção.
  const conteudoMensagem = textoCorrecoes ? [{ type: 'text', text: textoCorrecoes }, blocoConteudo] : [blocoConteudo];

  const corpoRequisicao = {
    model: 'claude-sonnet-4-6',
    // Buscas na web consomem tokens extras (resultados de pesquisa entram no
    // contexto) — usa um teto maior quando a busca está habilitada.
    max_tokens: comBusca ? 4000 : 2000,
    // Prompt caching: as instruções fixas (schema, regras, mapeamento de mercados,
    // exemplos) são reaproveitadas entre chamadas dentro de 1h, reduzindo custo
    // em sessões de importação com vários bilhetes seguidos.
    system: [
      { type: 'text', text: systemInstrucoes, cache_control: { type: 'ephemeral', ttl: '1h' } },
    ],
    messages: [{ role: 'user', content: conteudoMensagem }],
  };
  // Ferramenta de busca na web da própria Anthropic: usada na rota de Analisar
  // Aposta (estatísticas) e na rota de Buscar Liga.
  if (comBusca) {
    const ferramentaBusca = { type: 'web_search_20250305', name: 'web_search', max_uses: 5 };
    // Só na Busca de Liga: restringe de verdade a fontes conhecidas por terem essa
    // informação organizada (sofascore.com, 365scores.com). A API da Anthropic
    // suporta essa restrição de domínio de forma real (allowed_domains); a API
    // pública do Gemini usada no provedor primário NÃO suporta isso (só exclusão
    // de domínio) — por isso essa restrição só existe aqui, no fallback.
    if (schemaTipo === 'buscar-liga') {
      ferramentaBusca.allowed_domains = ['sofascore.com', '365scores.com'];
    }
    corpoRequisicao.tools = [ferramentaBusca];
  }

  const resposta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(corpoRequisicao),
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

  // Com a ferramenta de busca ativa, a resposta pode conter vários blocos
  // (buscas realizadas, resultados, texto intermediário) — pega o ÚLTIMO
  // bloco de texto, que é a resposta final do modelo após concluir as buscas.
  const blocosTexto = (dados.content || []).filter((b) => b.type === 'text');
  const blocoTexto = blocosTexto[blocosTexto.length - 1];
  if (!blocoTexto) {
    throw new Error('Anthropic não retornou texto utilizável.');
  }

  const resultado = parsearJSON(blocoTexto.text);
  // Mesma garantia aplicada ao Gemini: se a busca estava habilitada mas não há
  // evidência de que uma pesquisa real foi executada (bloco de resultado de
  // busca no retorno), não confia em nenhuma estatística que o modelo tenha
  // escrito — evita aceitar números "de memória" disfarçados de pesquisa real.
  if (comBusca) {
    const houveBuscaReal = (dados.content || []).some((b) => b.type === 'web_search_tool_result' || b.type === 'server_tool_use');
    if (!houveBuscaReal) {
      return sanearRespostaSemBusca(resultado, schemaTipo);
    }
  }
  return resultado;
}

// ==================== RESOLUÇÃO LOCAL DE MERCADOS DE PLACAR ====================
// Usada dentro da cascata de handleCheckApostas (ver comentário logo antes
// dessa função, mais abaixo) como 1º passo — a resolução mais rápida e
// barata, direto do placar final + intervalo, sem custo de IA. Cobre os
// mercados mais comuns: Resultado, Resultado Final, Empate, Empate Anula,
// Chance Dupla, Gols, Handicap, Handicap Asiático, Faixa de Gols.
//
// Não existe lista fixa de "mercados suportados" bloqueando tudo o que
// estiver fora dela — resolverMercadoFutebol() resolve localmente os
// mercados que sabe (função pura); qualquer coisa que ela não reconheça
// (mercado combinado, variação de texto, mercado que precisa de estatística)
// cai para o próximo passo da cascata em handleCheckApostas.

function normalizarTexto(s) {
  return (s || '')
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .trim();
}

// Tenta achar, num texto (ex.: a seleção do bilhete), qual dos dois times do
// confronto está sendo referenciado — usando palavras significativas do nome
// (ignora palavras curtas tipo "de", "do", "fc" para reduzir falso positivo).
function identificarTimeNoTexto(texto, nomeTimeA, nomeTimeB) {
  const norm = normalizarTexto(texto);
  const palavrasSignificativas = (nome) => normalizarTexto(nome).split(/\s+/).filter(p => p.length >= 4);
  const bateComTime = (nome) => {
    const palavras = palavrasSignificativas(nome);
    if (!palavras.length) return norm.includes(normalizarTexto(nome)) && normalizarTexto(nome).length >= 3;
    return palavras.some(p => norm.includes(p));
  };
  const temA = bateComTime(nomeTimeA);
  const temB = bateComTime(nomeTimeB);
  if (temA && !temB) return 'A';
  if (temB && !temA) return 'B';
  return null;
}

// Casa dois nomes de time (o do nosso "evento" salvo vs. os da API-Football)
// usando o mesmo critério de palavras significativas, nos dois sentidos.
function nomesTimesBatem(nomeSalvo, nomeApi) {
  const a = normalizarTexto(nomeSalvo);
  const b = normalizarTexto(nomeApi);
  if (!a || !b) return false;
  if (a === b) return true;
  const palavrasA = a.split(/\s+/).filter(p => p.length >= 4);
  const palavrasB = b.split(/\s+/).filter(p => p.length >= 4);
  if (palavrasA.some(p => b.includes(p))) return true;
  if (palavrasB.some(p => a.includes(p))) return true;
  return false;
}

// Resolve uma linha numérica (handicap ou total) que pode ser inteira, de
// meio (.5) ou de quarto (.25/.75). Linhas de quarto são divididas em duas
// linhas vizinhas e os dois resultados combinados (ex.: Ganhou + Anulada =
// Ganho Parcial) — é o mesmo raciocínio usado por casas de apostas para
// handicap asiático e totais de quarto de linha.
function resolverLinhaNumerica(diferenca, linha) {
  const linhaEm4 = Math.round(linha * 4);
  const restoAbs = Math.abs(linhaEm4) % 4;

  if (restoAbs === 0) { // linha inteira — pode empurrar (push)
    const ajustado = diferenca + linha;
    if (ajustado > 0) return 'Ganhou';
    if (ajustado === 0) return 'Anulada';
    return 'Perdeu';
  }
  if (restoAbs === 2) { // linha de meio — nunca empurra
    return (diferenca + linha) > 0 ? 'Ganhou' : 'Perdeu';
  }
  // linha de quarto — divide nas duas linhas vizinhas (uma inteira/meio de cada lado)
  const linha1 = (linhaEm4 - 1) / 4;
  const linha2 = (linhaEm4 + 1) / 4;
  const r1 = resolverLinhaNumerica(diferenca, linha1);
  const r2 = resolverLinhaNumerica(diferenca, linha2);
  const pontos = { Ganhou: 1, Anulada: 0, Perdeu: -1 };
  const soma = pontos[r1] + pontos[r2];
  if (soma === 2) return 'Ganhou';
  if (soma === 1) return 'Ganho Parcial';
  if (soma === -1) return 'Perda Parcial';
  return 'Perdeu';
}

function resolverTotal(totalGols, valorLinha, direcaoMais) {
  return direcaoMais
    ? resolverLinhaNumerica(totalGols, -valorLinha)
    : resolverLinhaNumerica(-totalGols, valorLinha);
}

// Extrai o time (A/B) e o valor numérico (com sinal) de uma seleção de
// handicap, ex.: "River Plate -1.5" → { time:'A', linha:-1.5 }.
// Também reconhece "Casa"/"Fora" quando o nome do time não aparece.
function parseHandicapSelecao(selecao, nomeTimeA, nomeTimeB, timeAeCasa) {
  const match = (selecao || '').match(/([+-]?\d+(?:[.,]\d+)?)/);
  if (!match) return { time: null, linha: null };
  const linha = parseFloat(match[1].replace(',', '.'));
  const antes = selecao.slice(0, match.index);
  let time = identificarTimeNoTexto(antes, nomeTimeA, nomeTimeB);
  if (!time) {
    const normAntes = normalizarTexto(antes);
    if (normAntes.includes('casa') || normAntes.includes('mandante')) time = timeAeCasa ? 'A' : 'B';
    else if (normAntes.includes('fora') || normAntes.includes('visitante')) time = timeAeCasa ? 'B' : 'A';
  }
  return { time, linha };
}

// ---- Resolução por mercado — recebe o placar já identificado e devolve
// { suportado, resultado, detalhe }. "resultado" segue os status já usados
// no app: Ganhou, Perdeu, Ganho Parcial, Perda Parcial, Anulada. ----
function resolverMercadoFutebol(mercado, selecao, ctx) {
  const { nomeTimeA, nomeTimeB, timeAeCasa, golsCasa, golsFora } = ctx;
  const mercadoNorm = normalizarTexto(mercado);

  const golsTimeA = timeAeCasa ? golsCasa : golsFora;
  const golsTimeB = timeAeCasa ? golsFora : golsCasa;
  const diferencaAB = golsTimeA - golsTimeB; // > 0 se A venceu

  switch (mercadoNorm) {
    case 'vencedor':
    case 'resultado':
    case 'resultado final': {
      const time = identificarTimeNoTexto(selecao, nomeTimeA, nomeTimeB);
      if (!time) return { suportado: false, detalhe: `Não foi possível identificar o time apostado na seleção "${selecao}".` };
      if (diferencaAB === 0) return { suportado: true, resultado: 'Perdeu', detalhe: 'Empate — mercado Vencedor não cobre empate.' };
      const vencedor = diferencaAB > 0 ? 'A' : 'B';
      return { suportado: true, resultado: vencedor === time ? 'Ganhou' : 'Perdeu' };
    }
    case 'empate': {
      const invertido = normalizarTexto(selecao).includes('nao');
      const empatou = diferencaAB === 0;
      return { suportado: true, resultado: (empatou !== invertido) ? 'Ganhou' : 'Perdeu' };
    }
    case 'empate anula': {
      const time = identificarTimeNoTexto(selecao, nomeTimeA, nomeTimeB);
      if (!time) return { suportado: false, detalhe: `Não foi possível identificar o time apostado na seleção "${selecao}".` };
      if (diferencaAB === 0) return { suportado: true, resultado: 'Anulada', detalhe: 'Empate — Draw No Bet devolve o stake.' };
      const vencedor = diferencaAB > 0 ? 'A' : 'B';
      return { suportado: true, resultado: vencedor === time ? 'Ganhou' : 'Perdeu' };
    }
    case 'chance dupla': {
      const cobreA = identificarTimeNoTexto(selecao, nomeTimeA, '') === 'A';
      const cobreB = identificarTimeNoTexto(selecao, '', nomeTimeB) === 'B';
      const cobreEmpate = normalizarTexto(selecao).includes('empate');
      if (!cobreA && !cobreB && !cobreEmpate) return { suportado: false, detalhe: `Não foi possível interpretar a seleção "${selecao}" como combinação de Chance Dupla.` };
      const resultadoReal = diferencaAB === 0 ? 'empate' : (diferencaAB > 0 ? 'A' : 'B');
      const coberto = resultadoReal === 'empate' ? cobreEmpate : (resultadoReal === 'A' ? cobreA : cobreB);
      return { suportado: true, resultado: coberto ? 'Ganhou' : 'Perdeu' };
    }
    case 'ambas equipes marcam': {
      const ambasMarcaram = golsCasa > 0 && golsFora > 0;
      const apostaEmSim = !normalizarTexto(selecao).includes('nao');
      return { suportado: true, resultado: (ambasMarcaram === apostaEmSim) ? 'Ganhou' : 'Perdeu' };
    }
    case 'gols': {
      const m = (selecao || '').match(/(mais|menos|over|under)\s*de?\s*([\d.,]+)/i);
      if (!m) return { suportado: false, detalhe: `Não foi possível extrair a linha de gols da seleção "${selecao}".` };
      const direcaoMais = /mais|over/i.test(m[1]);
      const valorLinha = parseFloat(m[2].replace(',', '.'));
      const totalGols = golsCasa + golsFora;
      return { suportado: true, resultado: resolverTotal(totalGols, valorLinha, direcaoMais) };
    }
    case 'handicap':
    case 'handicap asiatico': {
      const { time, linha } = parseHandicapSelecao(selecao, nomeTimeA, nomeTimeB, timeAeCasa);
      if (!time || linha === null) return { suportado: false, detalhe: `Não foi possível interpretar time e linha na seleção "${selecao}".` };
      const diferencaDoTime = time === 'A' ? diferencaAB : -diferencaAB;
      return { suportado: true, resultado: resolverLinhaNumerica(diferencaDoTime, linha) };
    }
    case 'faixa de gols': {
      const m = (selecao || '').match(/(\d+)\s*-\s*(\d+)/);
      if (!m) return { suportado: false, detalhe: `Não foi possível extrair o intervalo da seleção "${selecao}".` };
      const totalGols = golsCasa + golsFora;
      const minimo = parseInt(m[1], 10), maximo = parseInt(m[2], 10);
      return { suportado: true, resultado: (totalGols >= minimo && totalGols <= maximo) ? 'Ganhou' : 'Perdeu' };
    }
    default:
      return { suportado: false, detalhe: `Mercado "${mercado}" não tem lógica local implementada — será enviado para julgamento por IA com o placar bruto.` };
  }
}

// Separa "Time A - Time B" (ou "Time A x Time B", "Time A vs Time B") em duas partes.
function separarTimesDoEvento(evento) {
  const partes = (evento || '').split(/\s+(?:x|vs\.?|-)\s+/i);
  if (partes.length !== 2) return null;
  return { nomeTimeA: partes[0].trim(), nomeTimeB: partes[1].trim() };
}

// ---- Julgamento por IA (Gemini → Anthropic) — passo final da cascata de
// resolução, só entra quando NEM a resolução local de placar
// (resolverMercadoFutebol) NEM a de estatísticas (resolverMercadoEstatisticas)
// reconhecem o mercado ou conseguem interpretar a seleção. Não faz busca na
// web — só recebe os dados BRUTOS que o Worker já buscou na API-Football
// (placar final, placar do intervalo quando disponível, e a estatística
// completa da partida quando disponível) e pede pro modelo aplicar o
// raciocínio sobre esses dados, sem inventar nada que não foi fornecido. ----
async function julgarMercadoComIA(env, dados) {
  const systemInstrucoes = `Você decide se uma aposta esportiva de futebol já finalizada foi GANHA, PERDIDA, teve GANHO PARCIAL / PERDA PARCIAL (linha de quarto de handicap ou total), ou foi ANULADA (push — linha exata empatou), usando SOMENTE os dados fornecidos pelo usuário nesta mensagem.

Responda APENAS um objeto JSON, sem markdown e sem texto fora do JSON, neste formato exato:
{"resultado": "Ganhou" | "Perdeu" | "Ganho Parcial" | "Perda Parcial" | "Anulada" | "Indeterminado", "motivo": "explicação curta, em 1 frase"}

Regras:
- Use apenas os dados fornecidos (placar final, placar do intervalo se disponível, estatísticas da partida se disponíveis, nomes dos times, mercado, seleção apostada). NÃO pesquise, NÃO use conhecimento próprio sobre o jogo, NÃO invente estatística que não foi dada — se um dado (ex.: desarmes, tiros de meta) simplesmente não aparecer nos dados fornecidos, é porque a API não tem esse dado, não porque foi omitido por engano.
- Use "Indeterminado" quando os dados fornecidos genuinamente não bastarem para julgar esse mercado — nesse caso não tente adivinhar, e explique em "motivo" exatamente o que faltou (ex.: "precisa do placar do intervalo, que não veio disponível para esta partida").
- "Ganho Parcial"/"Perda Parcial" só se aplicam quando a linha de handicap ou total é "de quarto" (ex.: -0.25, -0.75, 2.25, 2.75) e a aposta cobre só metade do valor.
- "Anulada" (push) só se aplica quando a linha inteira empata exatamente com o resultado apostado.
- Mercados com "&" no nome (ex.: "Resultado Final & Total de Gols", "Chance Dupla & Total de Gols") são mercados COMPOSTOS: TODAS as condições unidas pelo "&" precisam ser verdadeiras para "Ganhou" — se qualquer uma falhar, é "Perdeu" (aplique "Ganho Parcial"/"Anulada" apenas se uma das condições individualmente permitir isso, seguindo a regra de linha de quarto/push acima).
- Mercado com VÍRGULA no nome (ex.: "Chutes no gol, Finalizações") também é COMPOSTO, mesma regra do "&" acima: cada nome de mercado antes de uma vírgula corresponde, NA MESMA POSIÇÃO, a uma condição na "Seleção apostada" (que também vem separada por vírgula) — TODAS precisam ser verdadeiras para "Ganhou"; se qualquer uma falhar, é "Perdeu". Resolva CADA condição separadamente usando o dado bruto correspondente daquele mercado específico antes de combinar o resultado final, e cite no "motivo" o valor bruto usado em cada uma (ex.: "Finalizações: 18+12=30, excedeu 27.5 → perdeu essa condição; não precisa checar a outra.").
- VERIFICAÇÃO OBRIGATÓRIA ANTES DE RESPONDER (evita o erro mais comum): depois de calcular o valor real de cada condição, releia a seleção apostada e confirme a direção literalmente — "Menos de X" só GANHA se o valor real for MENOR que X (se o valor real for igual ou maior, é "Perdeu"); "Mais de X" só GANHA se o valor real for MAIOR que X (se for igual ou menor, é "Perdeu"). Nunca conclua "Ganhou" para uma condição sem antes reconferir essa comparação explicitamente.
- Mercado "Ganhar qualquer um dos Tempos" (ou variação de texto equivalente): GANHA se o time apostado venceu o 1º tempo OU o 2º tempo (não precisa ser os dois) — use o placar do intervalo (1º tempo) e a diferença entre o placar final e o do intervalo (2º tempo) para verificar cada metade separadamente. Se o placar do intervalo não estiver disponível, esse mercado é "Indeterminado".
- Mercado "Cartões": ao somar amarelos + vermelhos, o critério de contagem pode variar entre casas de apostas (ex.: 2º amarelo que também vira vermelho pode contar 1 ou 2 vezes dependendo da casa) — julgue com o critério mais comum (soma simples de todos os cartões amarelos e vermelhos mostrados nas estatísticas) e mencione essa ressalva no "motivo" quando o mercado for Cartões.`;

  const linhasEstatisticas = (dados.statsCasa || dados.statsFora)
    ? `\nEstatísticas da partida (mandante / visitante):\n` + Object.keys(Object.assign({}, dados.statsCasa, dados.statsFora)).map(campo =>
        `- ${campo}: ${dados.statsCasa && dados.statsCasa[campo] != null ? dados.statsCasa[campo] : '?'} / ${dados.statsFora && dados.statsFora[campo] != null ? dados.statsFora[campo] : '?'}`
      ).join('\n')
    : '\nEstatísticas da partida: não disponíveis para esta partida/competição.';

  const textoBilhete = `Confronto: ${dados.timeCasa} (mandante) ${dados.golsCasa} x ${dados.golsFora} ${dados.timeFora} (visitante)
Placar do intervalo: ${(dados.golsIntervaloCasa != null && dados.golsIntervaloFora != null) ? `${dados.golsIntervaloCasa} x ${dados.golsIntervaloFora}` : 'não disponível'}${linhasEstatisticas}
Mercado: ${dados.mercado}
Seleção apostada: ${dados.selecao}`;

  const STATUS_VALIDOS = ['Ganhou', 'Perdeu', 'Ganho Parcial', 'Perda Parcial', 'Anulada'];
  const tentativas = [];
  if (env.GEMINI_API_KEY) {
    tentativas.push(() => lerComGemini({ apiKey: env.GEMINI_API_KEY, systemInstrucoes, textoBilhete, comBusca: false, schemaTipo: 'resolver-mercado' }));
  }
  if (env.ANTHROPIC_API_KEY) {
    tentativas.push(() => lerComAnthropic({ apiKey: env.ANTHROPIC_API_KEY, systemInstrucoes, textoBilhete, comBusca: false, schemaTipo: 'resolver-mercado' }));
  }

  let ultimoErro = null;
  for (const tentativa of tentativas) {
    try {
      const resultado = await tentativa();
      if (resultado && typeof resultado.resultado === 'string') {
        if (STATUS_VALIDOS.includes(resultado.resultado)) {
          return { suportado: true, resultado: resultado.resultado, detalhe: (resultado.motivo ? resultado.motivo + ' ' : '') + '(via IA)' };
        }
        // "Indeterminado" ou qualquer valor fora da lista — a IA está dizendo
        // honestamente que não dá pra julgar com o que foi fornecido.
        return { suportado: false, detalhe: (resultado.motivo || 'A IA não conseguiu determinar o resultado com os dados disponíveis.') + ' (via IA)' };
      }
    } catch (e) {
      ultimoErro = e;
      continue;
    }
  }
  return {
    suportado: false,
    detalhe: 'Não foi possível consultar a IA para julgar este mercado' + (ultimoErro ? `: ${String(ultimoErro.message || ultimoErro).slice(0, 200)}` : ' (nenhum provedor de IA configurado).')
  };
}

// ==================== CONTROLE DE LIMITE DE REQUISIÇÕES DA API-FOOTBALL ====================
// O plano gratuito da API-Football permite só 10 requisições por MINUTO (além
// de um teto de 100 por DIA). Como handleCheckApostas pode gerar várias
// chamadas em sequência (1 por data única + 1 por partida distinta), sem
// espaçamento elas saem quase simultâneas e estouram o limite por minuto
// mesmo em lotes pequenos (ex.: 5 eventos em datas/jogos diferentes já geram
// até 10 chamadas). Este helper centraliza toda chamada à API-Football:
//   1. Espaça as chamadas (>6s entre uma e outra) para nunca ultrapassar
//      10/minuto, mesmo em sequência contínua.
//   2. Se ainda assim vier 429, tenta mais UMA vez após uma espera maior —
//      cobre o caso de o minuto anterior já estar quase estourado por outro
//      uso do app.
//   3. Distingue limite por MINUTO (temporário, resolve sozinho) de limite
//      DIÁRIO esgotado (só volta amanhã) usando o cabeçalho
//      x-ratelimit-requests-remaining que a API-Football devolve em toda
//      resposta.
const INTERVALO_MIN_API_FOOTBALL_MS = 6500;
const ESPERA_RETENTATIVA_429_MS = 15000;

function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// "estado" é um objeto { numChamadas: 0, cotaDiariaEsgotada: false } criado
// uma vez no início de handleCheckApostas e passado adiante, para que o
// espaçamento e a detecção de cota valham para TODAS as chamadas do lote
// (tanto as de fixtures quanto as de estatísticas).
async function chamarApiFootball(url, env, estado) {
  if (estado.numChamadas > 0) {
    await esperar(INTERVALO_MIN_API_FOOTBALL_MS);
  }
  estado.numChamadas++;

  for (let tentativa = 0; tentativa < 2; tentativa++) {
    let resp;
    try {
      resp = await fetch(url, { headers: { 'x-apisports-key': env.API_FOOTBALL_KEY } });
    } catch (e) {
      return { ok: false, erro: 'Falha de rede ao consultar API-Football: ' + e.message };
    }

    const restanteDia = resp.headers.get('x-ratelimit-requests-remaining');
    if (restanteDia !== null && Number(restanteDia) <= 0) {
      estado.cotaDiariaEsgotada = true;
    }

    if (resp.status === 429) {
      if (tentativa === 0 && !estado.cotaDiariaEsgotada) {
        // Provavelmente o limite por MINUTO (não o diário) — espera mais um
        // pouco e tenta de novo, uma única vez.
        await esperar(ESPERA_RETENTATIVA_429_MS);
        continue;
      }
      return {
        ok: false,
        erro: estado.cotaDiariaEsgotada
          ? 'Cota diária da API-Football esgotada (plano gratuito: 100 requisições/dia). A checagem volta a funcionar depois da meia-noite em Londres (21h em Brasília).'
          : 'API-Football: limite de requisições por minuto excedido, mesmo após nova tentativa. Tente checar novamente em 1 minuto.'
      };
    }

    if (!resp.ok) {
      const texto = await resp.text();
      return { ok: false, erro: `API-Football retornou ${resp.status}: ${texto.slice(0, 200)}` };
    }

    const dados = await resp.json();
    if (dados.errors && Object.keys(dados.errors).length) {
      return { ok: false, erro: 'API-Football: ' + JSON.stringify(dados.errors) };
    }
    return { ok: true, dados };
  }
}

// Busca os jogos finalizados de cada data única em "datasUnicas" — 1 chamada
// à API-Football por dia (não por evento), já que /fixtures?date=... devolve
// todos os jogos do mundo naquele dia. Compartilhada dentro de
// handleCheckApostas para achar o jogo de cada evento sem gastar uma
// requisição por evento/time.
async function buscarFixturesPorData(datasUnicas, env, estado) {
  const fixturesPorData = new Map();
  for (const data of datasUnicas) {
    const resultado = await chamarApiFootball(
      `https://v3.football.api-sports.io/fixtures?date=${data}&timezone=America/Sao_Paulo&status=FT-AET-PEN`,
      env, estado
    );
    if (!resultado.ok) {
      fixturesPorData.set(data, { erro: resultado.erro });
      continue;
    }
    fixturesPorData.set(data, { fixtures: resultado.dados.response || [] });
  }
  return fixturesPorData;
}

// Casa o confronto salvo (nomeTimeA x nomeTimeB) com um dos fixtures retornados
// para aquela data, nos dois sentidos (mandante/visitante podem estar invertidos
// em relação à ordem salva no evento).
function encontrarFixture(infoData, nomeTimeA, nomeTimeB) {
  if (!infoData || infoData.erro) return null;
  return infoData.fixtures.find(f =>
    (nomesTimesBatem(nomeTimeA, f.teams.home.name) && nomesTimesBatem(nomeTimeB, f.teams.away.name)) ||
    (nomesTimesBatem(nomeTimeB, f.teams.home.name) && nomesTimesBatem(nomeTimeA, f.teams.away.name))
  );
}

// ==================== RESOLUÇÃO LOCAL DE MERCADOS DE ESTATÍSTICA ====================
// Usada dentro da cascata de handleCheckApostas (ver comentário acima da
// função) como 2º passo, depois da resolução de placar. Cobre Finalizações,
// Chutes no Gol, Faltas, Escanteios, Cartões, Impedimentos, Defesas — total
// da partida, "da Equipe" e Handicap.
//
// Desarmes e Tiros de Meta NUNCA são resolvidos por aqui nem pelo julgamento
// por IA — a API-Football não tem esses campos em nenhum plano (pago ou
// gratuito), então não existe dado bruto disponível para nenhum dos dois.

const MAPA_ESTATISTICA_API = {
  'chutes no gol': 'Shots on Goal',
  'finalizacoes': 'Total Shots',
  'faltas': 'Fouls',
  'escanteios': 'Corner Kicks',
  'impedimentos': 'Offsides',
  'defesas': 'Goalkeeper Saves',
};
const ESTATISTICAS_BASE_SUPORTADAS = ['cartoes', 'chutes no gol', 'finalizacoes', 'faltas', 'escanteios', 'impedimentos', 'defesas'];
const NOME_EXIBICAO_ESTATISTICA = {
  'cartoes': 'Cartões', 'chutes no gol': 'Chutes no Gol', 'finalizacoes': 'Finalizações',
  'faltas': 'Faltas', 'escanteios': 'Escanteios', 'impedimentos': 'Impedimentos', 'defesas': 'Defesas',
};
const AVISO_CONTAGEM_CARTOES = 'Confira a regra de contagem de cartões da casa antes de aplicar — algumas casas contam o 2º amarelo (que também vira vermelho) de forma diferente.';

// Lê o valor de uma estatística para um time a partir do mapa {type: value}
// retornado pela API-Football. "Cartões" soma amarelos + vermelhos (ver aviso
// de contagem acima). Retorna null quando a competição não registra aquela
// estatística (não é erro — é buraco de cobertura da própria API).
function valorEstatistica(statsTime, chaveBase) {
  if (!statsTime) return null;
  if (chaveBase === 'cartoes') {
    const amarelos = statsTime['Yellow Cards'];
    const vermelhos = statsTime['Red Cards'];
    if (amarelos == null && vermelhos == null) return null;
    return (Number(amarelos) || 0) + (Number(vermelhos) || 0);
  }
  const campoApi = MAPA_ESTATISTICA_API[chaveBase];
  if (!campoApi) return null;
  const v = statsTime[campoApi];
  return (v === null || v === undefined) ? null : Number(v);
}

// Extrai time + direção ("mais"/"menos") + linha de uma seleção "da Equipe",
// ex.: "River Plate - Mais de 4.5" → { time:'A', direcaoMais:true, valorLinha:4.5 }.
function parseEstatisticaEquipeSelecao(selecao, nomeTimeA, nomeTimeB) {
  const m = (selecao || '').match(/(mais|menos|over|under)\s*de?\s*([\d.,]+)/i);
  if (!m) return { time: null, direcaoMais: null, valorLinha: null };
  const antes = selecao.slice(0, m.index);
  const time = identificarTimeNoTexto(antes, nomeTimeA, nomeTimeB);
  const direcaoMais = /mais|over/i.test(m[1]);
  const valorLinha = parseFloat(m[2].replace(',', '.'));
  return { time, direcaoMais, valorLinha };
}

// ---- Resolução por mercado de estatística — mesmo formato de retorno de
// resolverMercadoFutebol: { suportado, resultado, detalhe, aviso? } ----
function resolverMercadoEstatisticas(mercado, selecao, ctx) {
  const { nomeTimeA, nomeTimeB, timeAeCasa, statsA, statsB } = ctx;
  const mercadoNorm = normalizarTexto(mercado);

  if ((mercado || '').includes(',')) {
    return { suportado: false, detalhe: 'Mercado combinado (múltiplas condições no mesmo evento) — revise manualmente.' };
  }

  const matchHandicap = mercadoNorm.match(/^handicap de (chutes no gol|escanteios|finalizacoes)$/);
  if (matchHandicap) {
    const chaveBase = matchHandicap[1];
    const valA = valorEstatistica(statsA, chaveBase);
    const valB = valorEstatistica(statsB, chaveBase);
    if (valA == null || valB == null) {
      return { suportado: false, detalhe: `Estatística "${NOME_EXIBICAO_ESTATISTICA[chaveBase]}" não disponível pela API para essa partida/competição.` };
    }
    const { time, linha } = parseHandicapSelecao(selecao, nomeTimeA, nomeTimeB, timeAeCasa);
    if (!time || linha === null) {
      return { suportado: false, detalhe: `Não foi possível interpretar time e linha na seleção "${selecao}".` };
    }
    const diferenca = time === 'A' ? (valA - valB) : (valB - valA);
    return { suportado: true, resultado: resolverLinhaNumerica(diferenca, linha), detalhe: `${nomeTimeA} ${valA} x ${valB} ${nomeTimeB} (${NOME_EXIBICAO_ESTATISTICA[chaveBase]})` };
  }

  const matchEquipe = mercadoNorm.match(/^(cartoes|chutes no gol|finalizacoes|faltas|escanteios|impedimentos|defesas) da equipe$/);
  if (matchEquipe) {
    const chaveBase = matchEquipe[1];
    const { time, direcaoMais, valorLinha } = parseEstatisticaEquipeSelecao(selecao, nomeTimeA, nomeTimeB);
    if (!time || valorLinha === null) {
      return { suportado: false, detalhe: `Não foi possível interpretar time e linha na seleção "${selecao}".` };
    }
    const statsTime = time === 'A' ? statsA : statsB;
    const valor = valorEstatistica(statsTime, chaveBase);
    if (valor == null) {
      return { suportado: false, detalhe: `Estatística "${NOME_EXIBICAO_ESTATISTICA[chaveBase]}" não disponível pela API para essa partida/competição.` };
    }
    const resultado = resolverTotal(valor, valorLinha, direcaoMais);
    const resp = { suportado: true, resultado, detalhe: `${time === 'A' ? nomeTimeA : nomeTimeB}: ${valor} ${NOME_EXIBICAO_ESTATISTICA[chaveBase].toLowerCase()}` };
    if (chaveBase === 'cartoes') resp.aviso = AVISO_CONTAGEM_CARTOES;
    return resp;
  }

  if (ESTATISTICAS_BASE_SUPORTADAS.includes(mercadoNorm)) {
    const chaveBase = mercadoNorm;
    const valA = valorEstatistica(statsA, chaveBase);
    const valB = valorEstatistica(statsB, chaveBase);
    if (valA == null || valB == null) {
      return { suportado: false, detalhe: `Estatística "${NOME_EXIBICAO_ESTATISTICA[chaveBase]}" não disponível pela API para essa partida/competição.` };
    }
    const m = (selecao || '').match(/(mais|menos|over|under)\s*de?\s*([\d.,]+)/i);
    if (!m) {
      return { suportado: false, detalhe: `Não foi possível extrair a linha da seleção "${selecao}".` };
    }
    const direcaoMais = /mais|over/i.test(m[1]);
    const valorLinha = parseFloat(m[2].replace(',', '.'));
    const total = valA + valB;
    const resultado = resolverTotal(total, valorLinha, direcaoMais);
    const resp = { suportado: true, resultado, detalhe: `${nomeTimeA} ${valA} + ${nomeTimeB} ${valB} = ${total}` };
    if (chaveBase === 'cartoes') resp.aviso = AVISO_CONTAGEM_CARTOES;
    return resp;
  }

  return { suportado: false, detalhe: `Mercado "${mercado}" não suportado pela checagem de estatísticas (Desarmes e Tiros de Meta não existem na API-Football em nenhum plano).` };
}

// ==================== CHECAGEM UNIFICADA DE APOSTAS (API-FOOTBALL + IA) ====================
// Rota: POST /api/checar-apostas
// Entrada: { eventos: [{ idAposta, idEvento, esporte, evento, mercado, selecao, dataEvento }, ...] }
// Um único fluxo (era dividido em /api/checar-resultados + /api/checar-estatisticas
// até a v1.28.0) — pra cada evento válido: busca o placar (final + intervalo) E as
// estatísticas completas da partida, então resolve em cascata:
//   1. resolverMercadoFutebol — lógica local determinística a partir do placar
//      (rápida, sem custo de IA, cobre os mercados mais comuns: Resultado,
//      Resultado Final, Empate, Empate Anula, Chance Dupla, Gols, Handicap,
//      Handicap Asiático, Faixa de Gols).
//   2. Se não resolveu: resolverMercadoEstatisticas — mesma ideia, a partir das
//      estatísticas (Cartões, Escanteios, Finalizações, Chutes no Gol, Faltas,
//      Impedimentos, Defesas — total, "da Equipe" e Handicap).
//   3. Se ainda não resolveu (mercado combinado tipo "Resultado Final & Total
//      de Gols", variação de texto não prevista, "Ganhar qualquer um dos
//      Tempos" etc.): julgarMercadoComIA — recebe TODOS os dados brutos já
//      buscados (placar final, intervalo, estatística completa da partida) e
//      julga por raciocínio, sem pesquisa na web e sem chamada extra à
//      API-Football (os dados já foram buscados nos passos 1-2).
// Só cai em "não suportado" de fato quando NENHUM dos três passos consegue
// (ex.: Desarmes e Tiros de Meta, que a API-Football simplesmente não tem em
// nenhum plano — não tem dado bruto pra nenhum dos três passos usar).
//
// Estratégia de cota: agrupa por DATA única pra achar os jogos (1 chamada por
// dia, não por evento) e por PARTIDA distinta pra estatísticas (1 chamada por
// jogo, não por evento — jogos repetidos entre apostas do mesmo lote não
// geram chamada extra).
//
// NOTA: cogitamos usar /fixtures?ids=... pra buscar estatísticas de várias
// partidas numa chamada só, mas a própria API-Football confirmou que esse
// parâmetro não está disponível no plano gratuito ("Free plans do not have
// access to the Ids parameter"). Por isso a estratégia continua sendo 1
// chamada por partida distinta, com o espaçamento e a retentativa de
// chamarApiFootball cuidando do limite de 10/minuto.

async function handleCheckApostas(payload, env, headers) {
  if (!env.API_FOOTBALL_KEY) {
    return new Response(JSON.stringify({
      error: 'Chave da API-Football não configurada no servidor (variável API_FOOTBALL_KEY). Adicione-a em Workers & Pages → seu Worker → Settings → Variables and Secrets.'
    }), { status: 500, headers });
  }

  const eventos = (payload && Array.isArray(payload.eventos)) ? payload.eventos : [];
  if (!eventos.length) {
    return new Response(JSON.stringify({ error: 'Envie "eventos" (array) para checar.' }), { status: 400, headers });
  }

  const resultados = [];
  const eventosValidos = [];
  for (const ev of eventos) {
    if (normalizarTexto(ev.esporte) !== 'futebol') {
      resultados.push({ idAposta: ev.idAposta, idEvento: ev.idEvento, encontrado: false, motivo: 'Só Futebol é suportado pela checagem automática por enquanto.' });
      continue;
    }
    if (!ev.dataEvento) {
      resultados.push({ idAposta: ev.idAposta, idEvento: ev.idEvento, encontrado: false, motivo: 'Evento sem data do jogo cadastrada — preencha "Data/Hora da Partida" para habilitar a checagem.' });
      continue;
    }
    if (!separarTimesDoEvento(ev.evento)) {
      resultados.push({ idAposta: ev.idAposta, idEvento: ev.idEvento, encontrado: false, motivo: `Não foi possível separar os dois times a partir de "${ev.evento}".` });
      continue;
    }
    eventosValidos.push(ev);
  }

  // Estado compartilhado de controle de limite de requisições da API-Football
  // (espaçamento anti-rajada + detecção de cota diária esgotada) — vale para
  // TODAS as chamadas deste lote, tanto de fixtures quanto de estatísticas.
  const estadoApiFootball = { numChamadas: 0, cotaDiariaEsgotada: false };

  // Etapa 1: localizar o fixture (jogo) de cada evento — 1 chamada por DATA única.
  const datasUnicas = [...new Set(eventosValidos.map(ev => String(ev.dataEvento).slice(0, 10)))];
  const fixturesPorData = await buscarFixturesPorData(datasUnicas, env, estadoApiFootball);

  const fixturePorEvento = new Map(); // "idAposta::idEvento" -> fixture
  const fixturesUnicos = new Map();   // fixture.fixture.id -> fixture (dedupe entre eventos da mesma partida)
  for (const ev of eventosValidos) {
    const chaveEvento = `${ev.idAposta}::${ev.idEvento}`;
    const data = String(ev.dataEvento).slice(0, 10);
    const infoData = fixturesPorData.get(data);
    if (infoData && infoData.erro) {
      resultados.push({ idAposta: ev.idAposta, idEvento: ev.idEvento, encontrado: false, motivo: infoData.erro });
      continue;
    }
    const { nomeTimeA, nomeTimeB } = separarTimesDoEvento(ev.evento);
    const fixture = encontrarFixture(infoData, nomeTimeA, nomeTimeB);
    if (!fixture) {
      resultados.push({ idAposta: ev.idAposta, idEvento: ev.idEvento, encontrado: false, motivo: `Confronto "${ev.evento}" não encontrado (ou ainda não finalizado) na data ${data}.` });
      continue;
    }
    fixturePorEvento.set(chaveEvento, fixture);
    fixturesUnicos.set(fixture.fixture.id, fixture);
  }

  // Etapa 2: buscar estatísticas — 1 chamada por PARTIDA distinta (não por evento).
  // Sempre busca (mesmo pra mercados de placar), já que o julgamento por IA no
  // passo 3 pode se beneficiar dos dois conjuntos de dados juntos.
  const statsPorFixtureId = new Map();
  for (const [fixtureId] of fixturesUnicos) {
    const resultado = await chamarApiFootball(
      `https://v3.football.api-sports.io/fixtures/statistics?fixture=${fixtureId}`,
      env, estadoApiFootball
    );
    if (!resultado.ok) {
      statsPorFixtureId.set(fixtureId, { erro: resultado.erro });
      continue;
    }
    const resposta = resultado.dados.response || [];
    if (!resposta.length) {
      statsPorFixtureId.set(fixtureId, { erro: 'Essa competição não tem estatísticas detalhadas registradas na API-Football para esse jogo.' });
      continue;
    }
    const statsPorTimeId = new Map();
    for (const bloco of resposta) {
      const mapa = {};
      for (const stat of (bloco.statistics || [])) mapa[stat.type] = stat.value;
      statsPorTimeId.set(bloco.team.id, mapa);
    }
    statsPorFixtureId.set(fixtureId, { statsPorTimeId });
  }

  // Etapa 3: resolver cada evento válido, em cascata (placar local → estatística local → IA).
  for (const ev of eventosValidos) {
    const chaveEvento = `${ev.idAposta}::${ev.idEvento}`;
    if (!fixturePorEvento.has(chaveEvento)) continue; // já registrado como não encontrado na etapa 1
    const fixture = fixturePorEvento.get(chaveEvento);
    const { nomeTimeA, nomeTimeB } = separarTimesDoEvento(ev.evento);
    const timeAeCasa = nomesTimesBatem(nomeTimeA, fixture.teams.home.name);
    const golsCasa = fixture.goals.home;
    const golsFora = fixture.goals.away;
    const golsIntervaloCasa = fixture.score && fixture.score.halftime ? fixture.score.halftime.home : null;
    const golsIntervaloFora = fixture.score && fixture.score.halftime ? fixture.score.halftime.away : null;
    const placarTexto = `${fixture.teams.home.name} ${golsCasa}-${golsFora} ${fixture.teams.away.name}`;

    const infoStats = statsPorFixtureId.get(fixture.fixture.id);
    const statsDisponiveis = infoStats && !infoStats.erro;
    const statsCasaRaw = statsDisponiveis ? infoStats.statsPorTimeId.get(fixture.teams.home.id) : null;
    const statsForaRaw = statsDisponiveis ? infoStats.statsPorTimeId.get(fixture.teams.away.id) : null;
    const statsA = timeAeCasa ? statsCasaRaw : statsForaRaw;
    const statsB = timeAeCasa ? statsForaRaw : statsCasaRaw;

    let resolucao = resolverMercadoFutebol(ev.mercado, ev.selecao, { nomeTimeA, nomeTimeB, timeAeCasa, golsCasa, golsFora });

    if (!resolucao.suportado && statsDisponiveis) {
      resolucao = resolverMercadoEstatisticas(ev.mercado, ev.selecao, { nomeTimeA, nomeTimeB, timeAeCasa, statsA, statsB });
    }

    if (!resolucao.suportado) {
      resolucao = await julgarMercadoComIA(env, {
        timeCasa: fixture.teams.home.name,
        timeFora: fixture.teams.away.name,
        golsCasa,
        golsFora,
        golsIntervaloCasa,
        golsIntervaloFora,
        statsCasa: statsCasaRaw,
        statsFora: statsForaRaw,
        mercado: ev.mercado,
        selecao: ev.selecao
      });
    }

    resultados.push({
      idAposta: ev.idAposta,
      idEvento: ev.idEvento,
      encontrado: true,
      placar: placarTexto,
      ...resolucao
    });
  }

  return new Response(JSON.stringify({ resultados }), { status: 200, headers });
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
