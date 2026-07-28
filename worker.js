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
  - Em ambos os casos: "selecao" = todas as condições unidas com " + " na ordem do bilhete; "odd" = a odd combinada do conjunto (não a soma das individuais).

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
  Evento 1: esporte "Futebol", liga "Copa do Mundo 2026" (confiancaLiga: 0.95), evento "Inglaterra - RD do Congo", mercado "Classificar, Escanteios da Equipe" (ambos reconhecidos — "Se Classificar" → "Classificar", "Inglaterra - Total de Escanteios" → "Escanteios da Equipe" — por isso NÃO usa "Criador de Apostas" aqui), selecao "Classificar + Inglaterra - Mais de 4.5" (nome do time preservado), odd 1.35
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
  "confianca": "number de 0 a 1 — o quanto você confia nesse resultado (leve em conta ambiguidade de nomes de time repetidos em vários países)",
  "observacao": "string curta — se encontrado=true, cite brevemente a base (ex: 'confirmado via tabela do campeonato atual'). Se encontrado=false, explique objetivamente por que (ex: 'não encontrei esse confronto específico nas competições em andamento')"
}`;

const PROMPT_BUSCAR_LIGA = `Você é um assistente que identifica em qual liga ou competição esportiva um confronto específico foi ou será disputado, usando a ferramenta de busca na web disponível. Você vai receber o esporte, o nome do evento/confronto (ex: "Time A x Time B") e, quando disponível, uma data de referência (data em que a aposta foi registrada — o confronto costuma ter sido disputado próximo dessa data), em formato JSON.

USO DA DATA DE REFERÊNCIA — MUITO IMPORTANTE:
- Quando "dataReferencia" vier preenchida, use-a para achar a temporada/rodada certa do confronto, não a mais recente disponível hoje. Times mudam de divisão entre temporadas (acesso/rebaixamento) — a liga de um time HOJE pode não ser a mesma de quando o confronto aconteceu.
- Sem "dataReferencia", assuma que o confronto é recente/atual e busque a temporada em andamento.

USO DA BUSCA NA WEB — MUITO IMPORTANTE:
- Pesquise o confronto informado (times + data de referência, se houver) para descobrir a liga/competição/campeonato em que ele foi disputado.
- Ao formular suas buscas, dê preferência a fontes como sofascore.com e 365scores.com quando fizer sentido — costumam ter esse tipo de informação de forma organizada — mas use qualquer fonte confiável que encontrar.
- Nomes de time podem ser ambíguos (o mesmo nome existe em várias ligas/países diferentes) — use o contexto disponível (esporte informado, data de referência, outros times mencionados) para reduzir ambiguidade, mas NUNCA garanta uma resposta apenas por familiaridade com um nome de time conhecido sem confirmar via busca.
- Se não encontrar o confronto específico com confiança razoável (ex: nome de time comum a várias ligas, informação insuficiente, evento não encontrado, data de referência ausente e ambiguidade alta), defina "encontrado": false e "liga": "" — NUNCA invente ou "chute" uma liga só para preencher o campo.

REGRAS DE FORMATO:
- A liga deve seguir o padrão "País - Divisão" (ex: "Brasil - Série A", "Inglaterra - Premier League", "Espanha - La Liga"), EXCETO torneios internacionais/continentais, que mantêm o nome padrão sem prefixo de país (ex: "Champions League", "Copa Libertadores", "Copa do Mundo").
- Nunca use nome comercial de patrocínio da liga (ex: use "Inglaterra - Premier League", não "Sky Bet Championship" ou nomes com marca de patrocinador, a menos que seja o nome oficial sem alternativa).
- Responda APENAS com o JSON puro, sem texto antes ou depois, sem markdown, sem crases — mesmo tendo usado a ferramenta de busca antes, a resposta final deve ser só o JSON.

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
    env.SUPABASE_URL + '/rest/v1/profiles?id=eq.' + userData.id + '&select=ai_enabled',
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
  const funcaoRpc = tipo === 'estatisticas' ? 'increment_ai_calls_estatisticas'
    : tipo === 'liga' ? 'increment_ai_calls_liga'
    : 'increment_ai_calls_bilhete';
  try {
    await fetch(env.SUPABASE_URL + '/rest/v1/rpc/' + funcaoRpc, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json'
      },
      body: '{}'
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
    const ROTAS_API = ['/api/ler-bilhete', '/api/analisar-aposta', '/api/buscar-liga'];
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

    let imagemBase64, mediaType, textoBilhete, systemInstrucoes, textoCorrecoes;
    // Busca real na web só nas rotas que precisam de dado atualizado/externo.
    const comBusca = url.pathname === '/api/analisar-aposta' || url.pathname === '/api/buscar-liga';
    const tipoUso = url.pathname === '/api/analisar-aposta' ? 'estatisticas'
      : url.pathname === '/api/buscar-liga' ? 'liga'
      : 'bilhete';
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
      const { esporte, evento, dataReferencia } = payload || {};
      if (!esporte || !evento) {
        return new Response(JSON.stringify({ error: 'Envie "esporte" e "evento" para buscar a liga.' }), { status: 400, headers });
      }
      systemInstrucoes = PROMPT_BUSCAR_LIGA;
      textoBilhete = JSON.stringify({ esporte, evento, dataReferencia: dataReferencia || null });
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
        const linhas = correcoesConhecidas.slice(0, 60).map((c) => {
          const campo = c.campo === 'liga' ? 'Liga' : c.campo === 'mercado' ? 'Mercado' : c.campo;
          const contexto = c.contexto ? ` (contexto: ${c.contexto})` : '';
          return `- [${campo}] Em vez de "${c.valorErrado}", o usuário já corrigiu para "${c.valorCorreto}" — esporte: ${c.esporte}${contexto}.`;
        }).join('\n');
        textoCorrecoes = `CORREÇÕES APRENDIDAS DE LEITURAS ANTERIORES — o usuário já corrigiu manualmente estas sugestões da IA em bilhetes passados. Quando o contexto do bilhete atual combinar (mesmos times, mesma liga/competição, ou claramente o mesmo caso), priorize a preferência já confirmada pelo usuário abaixo em vez da sua própria inferência. Se o contexto não combinar com nenhuma linha, ignore esta lista normalmente:\n${linhas}\n\nAgora, aplicando essas preferências quando fizerem sentido, extraia os dados do bilhete a seguir, seguindo todas as regras do system prompt.`;
      }
    }

    // ---- 1ª TENTATIVA: GEMINI (grátis) ----
    let erroGeminiDetalhe = null;
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
        console.log('[fallback] Gemini falhou, tentando Anthropic:', erroGemini.message);
        // Guarda o erro real (truncado) para devolver ao usuário se a Anthropic
        // também falhar — assim dá para diagnosticar sem precisar de `wrangler tail`.
        erroGeminiDetalhe = String(erroGemini.message || erroGemini).slice(0, 500);
      }
    } else {
      console.log('[fallback] GEMINI_API_KEY não configurada, indo direto para Anthropic.');
      erroGeminiDetalhe = 'GEMINI_API_KEY não configurada neste Worker.';
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
        comBusca,
        textoCorrecoes,
        schemaTipo,
      });
      ctx.waitUntil(registrarUsoIA(accessToken, env, tipoUso));
      return new Response(JSON.stringify({ ...extraido, _provedor: 'anthropic' }), { status: 200, headers });
    } catch (erroAnthropic) {
      return new Response(
        JSON.stringify({
          error: 'Erro ao ler bilhete (Gemini e Anthropic falharam): ' + erroAnthropic.message +
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
        ? 'ATENÇÃO: a ferramenta de busca na web NÃO está disponível nesta chamada — você não pesquisou nada agora, mesmo que "lembre" de informações gerais sobre os times. É TERMINANTEMENTE PROIBIDO preencher "liga" com qualquer valor baseado em memória própria — defina "encontrado": false, "liga": "" e em "observacao" escreva apenas algo como "Busca na web indisponível nesta chamada".'
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
    resultado.observacao = 'Busca na web indisponível nesta chamada — não foi possível confirmar a liga.';
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

// ==================== AUXILIAR ====================
function parsearJSON(texto) {
  const limpo = texto.replace(/```json\s*|```\s*/g, '').trim();
  try {
    return JSON.parse(limpo);
  } catch (e) {
    throw new Error('Não foi possível interpretar a resposta como JSON: ' + limpo.slice(0, 200));
  }
}
