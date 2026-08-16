-- Migração v1.20.6 (16/08/2026) — já aplicada diretamente no banco ao vivo.
-- Acrescentar este trecho ao supabase.sql mestre na próxima oportunidade em
-- que ele estiver disponível nesta conversa.
--
-- Motivo: excluir uma aposta falhava com violação de chave estrangeira,
-- pois os eventos ligados a ela em banca_eventos não eram apagados junto.
-- Passa a apagar em cascata: excluir uma aposta agora apaga automaticamente
-- os eventos ligados a ela.

ALTER TABLE banca_eventos
  DROP CONSTRAINT banca_eventos_aposta_id_fkey,
  ADD CONSTRAINT banca_eventos_aposta_id_fkey
    FOREIGN KEY (aposta_id) REFERENCES banca_apostas(id) ON DELETE CASCADE;
