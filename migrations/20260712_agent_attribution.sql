-- Agent FinOps pilot: first-class economic attribution dimensions.
-- Safe to run once against an existing LLMKit Supabase database.

alter table requests add column if not exists customer_id text;
alter table requests add column if not exists feature_id text;
alter table requests add column if not exists agent_id text;

create index if not exists idx_requests_customer
  on requests(customer_id) where customer_id is not null;
create index if not exists idx_requests_feature
  on requests(feature_id) where feature_id is not null;
create index if not exists idx_requests_agent
  on requests(agent_id) where agent_id is not null;
