-- Migração v1.23.0 — data do jogo por evento.
--
-- Motivo: para automatizar a checagem de resultados via API-Football
-- (endpoint /api/checar-resultados), é preciso saber a data/hora real da
-- PARTIDA de cada evento — diferente de banca_apostas.data_hora, que é a
-- data de REGISTRO do bilhete. Sem isso, não dá para localizar o confronto
-- certo na API com confiança (nomes de time se repetem entre ligas/datas).
--
-- Coluna nova, opcional (nullable) — bilhetes já importados continuam
-- funcionando normalmente, só não participam da checagem automática até
-- terem essa data preenchida (manualmente ou reimportando via IA).

ALTER TABLE banca_eventos
  ADD COLUMN IF NOT EXISTS data_evento TIMESTAMPTZ NULL;

COMMENT ON COLUMN banca_eventos.data_evento IS
  'Data/hora real da partida (evento esportivo), distinta de banca_apostas.data_hora (data de registro do bilhete). Usada pelo endpoint /api/checar-resultados para localizar o confronto na API-Football.';
