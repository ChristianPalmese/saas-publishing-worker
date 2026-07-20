-- =====================================================================
-- Migrazione 001 — Sessioni worker + coda multi-account
--
-- Da eseguire nel SQL Editor di Supabase.
-- Tutte le colonne nuove hanno un default o sono nullable: le righe
-- esistenti in publishing_jobs non si rompono.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Sessioni browser, una per account social
--
-- Contiene lo storageState di Playwright (cookie + localStorage) cifrato.
-- Tabella separata da social_accounts di proposito: il frontend non deve
-- MAI poterla leggere. Nessuna policy RLS = nessun accesso per gli utenti
-- autenticati; solo la service role key del worker ci arriva.
-- ---------------------------------------------------------------------
create table if not exists worker_sessions (
  social_account_id uuid primary key
    references social_accounts(id) on delete cascade,

  -- storageState JSON cifrato con AES-256-GCM (vedi src/lib/crypto.ts)
  state_encrypted text not null,

  -- 'active'  = sessione valida, il worker la usa
  -- 'expired' = login scaduto, serve riconnettere l'account a mano
  status text not null default 'active'
    check (status in ('active', 'expired')),

  last_used_at timestamptz,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

alter table worker_sessions enable row level security;

comment on table worker_sessions is
  'Sessioni browser cifrate per la pubblicazione automatica. Accesso solo service role.';


-- ---------------------------------------------------------------------
-- 2. publishing_jobs: sapere SU QUALE account pubblicare
-- ---------------------------------------------------------------------

-- Su quale profilo social va pubblicato questo job.
alter table publishing_jobs
  add column if not exists social_account_id uuid
    references social_accounts(id) on delete set null;

-- Formato del contenuto: decide quale "ricetta" usa il publisher.
-- photo | carousel | reel | story | video
alter table publishing_jobs
  add column if not exists format text;

-- Lock: quale worker ha preso il job e quando.
alter table publishing_jobs
  add column if not exists claimed_by text;

alter table publishing_jobs
  add column if not exists claimed_at timestamptz;

-- Tentativi: attempts si incrementa a ogni claim, non a ogni errore.
alter table publishing_jobs
  add column if not exists attempts int not null default 0;

alter table publishing_jobs
  add column if not exists max_attempts int not null default 3;


-- Indice per la query della coda (status + orario).
create index if not exists idx_publishing_jobs_coda
  on publishing_jobs (status, scheduled_at)
  where status = 'pending';

-- Indice per il controllo "questo account ha gia' un job in corso?"
create index if not exists idx_publishing_jobs_account_attivi
  on publishing_jobs (social_account_id)
  where status = 'processing';


-- ---------------------------------------------------------------------
-- 3. Claim atomico
--
-- Sostituisce il select+update di queue.ts. Fa quattro cose che il
-- codice applicativo non puo' fare in modo affidabile:
--
--   a) rimette in coda i job rimasti appesi (worker crashato)
--   b) FOR UPDATE SKIP LOCKED: due worker non prendono mai lo stesso job
--   c) non prende un job se quell'account ne ha gia' uno in corso
--      (serializza per account, parallelizza tra account)
--   d) incrementa attempts e scrive il lock in un colpo solo
-- ---------------------------------------------------------------------
create or replace function claim_next_publishing_job(
  p_worker_id    text,
  p_stale_after  interval default '15 minutes'
)
returns publishing_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job publishing_jobs;
begin
  -- (a) Recupero dei job appesi: un worker morto lascia righe in
  -- 'processing' che nessuno tocchera' piu'. Se non hanno esaurito i
  -- tentativi tornano in coda, altrimenti falliscono in modo esplicito.
  update publishing_jobs
     set status      = 'pending',
         claimed_by  = null,
         claimed_at  = null,
         current_step = 'ripreso-dopo-timeout'
   where status = 'processing'
     and claimed_at is not null
     and claimed_at < now() - p_stale_after
     and attempts < max_attempts;

  update publishing_jobs
     set status      = 'failed',
         error_code  = 'MAX_ATTEMPTS_REACHED',
         current_step = 'tentativi-esauriti'
   where status = 'processing'
     and claimed_at is not null
     and claimed_at < now() - p_stale_after
     and attempts >= max_attempts;

  -- (b) + (c) Seleziona un candidato bloccando la riga.
  select *
    into v_job
    from publishing_jobs j
   where j.status = 'pending'
     and j.scheduled_at <= now()
     and (
       j.social_account_id is null
       or not exists (
         select 1
           from publishing_jobs altro
          where altro.social_account_id = j.social_account_id
            and altro.status = 'processing'
       )
     )
   order by j.scheduled_at asc
   limit 1
   for update skip locked;

  if not found then
    return null;
  end if;

  -- (d) Prende in carico.
  update publishing_jobs
     set status       = 'processing',
         claimed_by   = p_worker_id,
         claimed_at   = now(),
         attempts     = attempts + 1,
         current_step = 'claimed'
   where id = v_job.id
   returning * into v_job;

  return v_job;
end;
$$;

comment on function claim_next_publishing_job is
  'Prende in carico un job in modo atomico. Un job per account alla volta.';