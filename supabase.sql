-- ============================================================================
-- Banca Pro — Schema cumulativo do Supabase (projeto zlclakzjktpsbpfkltxa)
-- ============================================================================
-- Este arquivo reflete o estado REAL do banco em produção, gerado a partir de
-- consultas diretas a information_schema / pg_catalog em 30/08/2026 — não é
-- um histórico de migrações, é uma "foto" cumulativa do schema atual.
--
-- Deve ser atualizado a cada entrega que envolva mudança no Supabase (nova
-- coluna, constraint, política, etc.), para servir de referência de
-- reconstrução completa das tabelas do Banca Pro, se algum dia for preciso.
--
-- IMPORTANTE: o projeto Supabase acima é COMPARTILHADO entre vários apps do
-- Fábio (Banca Pro, Contracheque, Financeiro, Saúde) — este arquivo cobre
-- SOMENTE as tabelas com prefixo "banca_", que pertencem ao Banca Pro.
-- As tabelas "contracheque_*", "financeiro_*", "saude_*" e "profiles*"
-- pertencem a outros módulos e NÃO fazem parte deste arquivo.
--
-- Dependência externa: as políticas de RLS abaixo usam a função
-- modulo_habilitado('banca'), definida fora do escopo do Banca Pro (é
-- infraestrutura compartilhada do sistema de módulos/perfis) — não é
-- redefinida aqui de propósito, para não arriscar quebrar outros apps.
-- ============================================================================


-- ============================================================================
-- banca_apostas — uma linha por aposta cadastrada (simples ou combinada)
-- ============================================================================
CREATE TABLE public.banca_apostas (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
    identificador   text NOT NULL,
    data_hora       timestamp NOT NULL,
    casa            text,
    tipster         text,
    tipo            text,
    status          text NOT NULL DEFAULT 'Aberto',
    stake           numeric NOT NULL DEFAULT 0,
    odd_total       numeric NOT NULL DEFAULT 0,
    recebido        numeric NOT NULL DEFAULT 0,
    lucro           numeric NOT NULL DEFAULT 0,
    unidades        numeric NOT NULL DEFAULT 0,
    roi             numeric NOT NULL DEFAULT 0,
    bonus           numeric NOT NULL DEFAULT 0,
    observacao      text,
    cash_out_valor  numeric,
    aposta_gratis   boolean NOT NULL DEFAULT false,
    valor_freebet   numeric NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT banca_apostas_user_identificador_unique UNIQUE (user_id, identificador)
);

ALTER TABLE public.banca_apostas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "banca_apostas: somente o proprio usuario" ON public.banca_apostas
    FOR ALL
    USING (auth.uid() = user_id AND modulo_habilitado('banca'))
    WITH CHECK (auth.uid() = user_id AND modulo_habilitado('banca'));

-- status deve ser sempre 'Aberto' (masculino) — qualquer variação faz a
-- aposta sumir silenciosamente do filtro de abertas no frontend.
-- bonus deve ser sempre numérico (0, nunca null).
-- Apostas 'Aberto' sempre têm recebido=0, lucro=0, unidades=0, roi=0.


-- ============================================================================
-- banca_eventos — um ou mais eventos por aposta (combinadas têm vários)
-- ============================================================================
CREATE TABLE public.banca_eventos (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    aposta_id    uuid NOT NULL REFERENCES public.banca_apostas(id) ON DELETE CASCADE,
    user_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
    numero       integer NOT NULL DEFAULT 1,
    esporte      text,
    liga         text,
    evento       text,
    mercado      text,
    selecao      text,
    odd          numeric NOT NULL DEFAULT 0,
    data_evento  timestamptz  -- adicionada na v1.23.0, migração aplicada na v1.24.0
);

COMMENT ON COLUMN public.banca_eventos.data_evento IS
    'Data/hora real da partida (evento esportivo), distinta de banca_apostas.data_hora (data de registro do bilhete). Usada pelos endpoints /api/checar-resultados e /api/checar-estatisticas para localizar o confronto na API-Football.';

ALTER TABLE public.banca_eventos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "banca_eventos: somente o proprio usuario" ON public.banca_eventos
    FOR ALL
    USING (auth.uid() = user_id AND modulo_habilitado('banca'))
    WITH CHECK (auth.uid() = user_id AND modulo_habilitado('banca'));

-- mercado NUNCA carrega o prefixo "Esporte::" (esse formato é só de
-- banca_opcoes) — esporte e mercado são colunas separadas aqui.
-- ON DELETE CASCADE em aposta_id: excluir uma aposta já remove seus eventos
-- automaticamente (adicionado na v1.20.6).


-- ============================================================================
-- banca_opcoes — listas dinâmicas (casas, tipsters, ligas, mercados, tipos...)
-- ============================================================================
CREATE TABLE public.banca_opcoes (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id  uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
    campo    text NOT NULL,
    valor    text NOT NULL
);

ALTER TABLE public.banca_opcoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "banca_opcoes: somente o proprio usuario" ON public.banca_opcoes
    FOR ALL
    USING (auth.uid() = user_id AND modulo_habilitado('banca'))
    WITH CHECK (auth.uid() = user_id AND modulo_habilitado('banca'));

-- "campo" = 'casa' | 'tipster' | 'tipo' | 'esporte' | 'liga' | 'mercado' | ...
-- Para liga/mercado por esporte, "valor" usa o formato composto "Esporte::Valor"
-- (ex.: "Futebol::Gols") — diferente de banca_eventos.mercado, que nunca leva o prefixo.


-- ============================================================================
-- banca_transacoes — depósitos/retiradas por casa de apostas (aba Saldos)
-- ============================================================================
CREATE TABLE public.banca_transacoes (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
    casa         text NOT NULL,
    tipo         text NOT NULL,
    valor        numeric NOT NULL,
    data         timestamp NOT NULL,
    observacao   text,
    created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.banca_transacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "banca_transacoes: somente o proprio usuario" ON public.banca_transacoes
    FOR ALL
    USING (auth.uid() = user_id AND modulo_habilitado('banca'))
    WITH CHECK (auth.uid() = user_id AND modulo_habilitado('banca'));


-- ============================================================================
-- banca_analises_ia — histórico de análises de risco/estatística geradas por IA
-- ============================================================================
CREATE TABLE public.banca_analises_ia (
    id             bigint PRIMARY KEY,
    user_id        uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
    titulo         text NOT NULL,
    resultado      jsonb NOT NULL,
    criado_em      timestamptz NOT NULL DEFAULT now(),
    aposta_id      uuid REFERENCES public.banca_apostas(id) ON DELETE SET NULL,
    identificador  text
);

ALTER TABLE public.banca_analises_ia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "banca_analises_ia: somente o proprio usuario" ON public.banca_analises_ia
    FOR ALL
    USING (auth.uid() = user_id AND modulo_habilitado('banca'))
    WITH CHECK (auth.uid() = user_id AND modulo_habilitado('banca'));


-- ============================================================================
-- banca_correcoes_ia — sistema de aprendizado de correções manuais (liga/mercado)
-- ============================================================================
CREATE TABLE public.banca_correcoes_ia (
    id             bigint PRIMARY KEY,
    user_id        uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
    campo          text NOT NULL,
    esporte        text NOT NULL,
    valor_errado   text NOT NULL,
    valor_correto  text NOT NULL,
    contexto       text,
    criado_em      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.banca_correcoes_ia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "banca_correcoes_ia: somente o proprio usuario" ON public.banca_correcoes_ia
    FOR ALL
    USING (auth.uid() = user_id AND modulo_habilitado('banca'))
    WITH CHECK (auth.uid() = user_id AND modulo_habilitado('banca'));

-- Correções de Liga expiram após ~14 meses (filtro client-side via criado_em);
-- correções de Mercado são permanentes. Armazenamento por time (não por
-- confronto) para correções de liga. Cap de 60 itens, mais recentes prevalecem.


-- ============================================================================
-- banca_ai_usage — contador de uso de IA por usuário, por finalidade
-- ============================================================================
CREATE TABLE public.banca_ai_usage (
    user_id              uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    ai_calls_bilhete      integer NOT NULL DEFAULT 0,
    ai_calls_estatisticas integer NOT NULL DEFAULT 0,
    ai_calls_liga         integer NOT NULL DEFAULT 0
);

ALTER TABLE public.banca_ai_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "banca_ai_usage: somente o proprio usuario" ON public.banca_ai_usage
    FOR SELECT
    USING (auth.uid() = user_id AND modulo_habilitado('banca'));

-- Referencia public.profiles (tabela compartilhada entre todos os módulos,
-- não é exclusiva do Banca Pro — por isso não está definida neste arquivo).
