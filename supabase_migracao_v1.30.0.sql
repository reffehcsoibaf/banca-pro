-- ============================================================================
-- Migração v1.30.0 — cache local de Liga/Data-Hora por confronto (48h)
-- ============================================================================
-- Aplicar uma vez no projeto zlclakzjktpsbpfkltxa. Ver supabase.sql (schema
-- cumulativo) para a definição completa já incorporada.

CREATE TABLE public.banca_cache_partidas (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
    esporte         text NOT NULL,
    evento_chave    text NOT NULL,
    evento_exibicao text,
    liga            text,
    data_evento     timestamptz,
    origem          text,
    criado_em       timestamptz NOT NULL DEFAULT now(),
    expira_em       timestamptz NOT NULL DEFAULT (now() + interval '48 hours'),
    CONSTRAINT banca_cache_partidas_user_confronto_unique UNIQUE (user_id, esporte, evento_chave)
);

ALTER TABLE public.banca_cache_partidas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "banca_cache_partidas: somente o proprio usuario" ON public.banca_cache_partidas
    FOR ALL
    USING (auth.uid() = user_id AND modulo_habilitado('banca'))
    WITH CHECK (auth.uid() = user_id AND modulo_habilitado('banca'));

CREATE INDEX banca_cache_partidas_busca_idx
    ON public.banca_cache_partidas (user_id, esporte, evento_chave, expira_em);
