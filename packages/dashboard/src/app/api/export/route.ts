import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';
import { getAccountPlan } from '@/lib/queries';
import { createHash } from 'node:crypto';

const DETAILED_COLUMNS = [
  'timestamp', 'operator_id', 'system_id', 'end_user_id', 'model', 'provider',
  'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens',
  'cost_usd', 'duration_ms', 'session_id', 'status', 'error_code',
] as const;

const RAW_COLUMNS = [
  'created_at', 'api_key_id', 'end_user_id', 'model', 'provider',
  'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens',
  'cost_cents', 'latency_ms', 'session_id', 'status', 'error_code',
] as const;

function escCsv(v: string | number | null): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response('unauthorized', { status: 401 });

  const url = new URL(req.url);
  const format = url.searchParams.get('format') || 'raw';
  const rawDays = Number(url.searchParams.get('days') || '30');
  const days = Number.isFinite(rawDays) && rawDays >= 1 && rawDays <= 365 ? rawDays : 30;
  const provider = url.searchParams.get('provider');
  const model = url.searchParams.get('model');
  const session = url.searchParams.get('session');

  const isAdmin = (await getAccountPlan(userId)) === 'admin';
  const db = createServerClient();

  // scope to user's keys unless admin
  let keyIds: string[] | null = null;
  if (!isAdmin) {
    const { data: keys } = await db.from('api_keys').select('id').eq('user_id', userId);
    if (!keys?.length) return new Response('no data', { status: 404 });
    keyIds = keys.map((k) => k.id);
  }

  let query = db
    .from('requests')
    .select('*')
    .eq('source', 'proxy')
    .order('created_at', { ascending: true })
    .limit(50000);

  if (keyIds) query = query.in('api_key_id', keyIds);
  if (days > 0) query = query.gte('created_at', new Date(Date.now() - days * 86400000).toISOString());
  if (provider) query = query.eq('provider', provider);
  if (model) query = query.eq('model', model);
  if (session) query = query.eq('session_id', session);

  const { data: rows } = await query;
  if (!rows?.length) return new Response('no data', { status: 404 });

  const isDetailed = format === 'detailed' || format === 'article12';
  const columns = isDetailed ? DETAILED_COLUMNS : RAW_COLUMNS;

  function rowToCsv(row: Record<string, unknown>): string {
    if (isDetailed) {
      return [
        escCsv(row.created_at as string),
        escCsv(row.user_id as string ?? userId),
        escCsv(row.api_key_id as string),
        escCsv(row.end_user_id as string),
        escCsv(row.model as string),
        escCsv(row.provider as string),
        escCsv(row.input_tokens as number),
        escCsv(row.output_tokens as number),
        escCsv(row.cache_read_tokens as number),
        escCsv(row.cache_write_tokens as number),
        escCsv(Number(row.cost_cents ?? 0) / 100),
        escCsv(row.latency_ms as number),
        escCsv(row.session_id as string),
        escCsv(row.status as string),
        escCsv(row.error_code as string),
      ].join(',');
    }
    return RAW_COLUMNS.map((col) => escCsv(row[col] as string | number | null)).join(',');
  }

  // build CSV with metadata header
  const totalSpend = rows.reduce((s, r) => s + Number(r.cost_cents ?? 0), 0) / 100;
  const csvLines: string[] = [];

  csvLines.push(`# LLMKit Export`);
  csvLines.push(`# Generated: ${new Date().toISOString()}`);
  csvLines.push(`# Period: ${days}d`);
  csvLines.push(`# Records: ${rows.length}`);
  csvLines.push(`# Total spend: $${totalSpend.toFixed(2)}`);
  csvLines.push(`# Format: ${isDetailed ? 'detailed' : 'raw'}`);
  csvLines.push(columns.join(','));

  for (const row of rows) {
    csvLines.push(rowToCsv(row as Record<string, unknown>));
  }

  // hash covers header + data rows only (excludes metadata lines starting with #)
  const dataLines = csvLines.filter(l => !l.startsWith('#'));
  const hash = createHash('sha256').update(dataLines.join('\n')).digest('hex');

  csvLines.splice(1, 0, `# Integrity: sha256:${hash} (covers header + data rows, verify with: grep -v '^#' file.csv | sha256sum)`);
  const finalBody = csvLines.join('\n');

  const filename = `llmkit-export-${format}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(finalBody, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-LLMKit-Export-Hash': hash,
      'X-LLMKit-Export-Records': String(rows.length),
    },
  });
}
