// Notion REST API client for LLMKit MCP Server.
// Zero dependencies. Typed blocks. Idempotent page creation (archive-and-replace).

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// --- Config ---

interface NotionConfig {
  token: string;
  parentPageId: string;
}

let cached: NotionConfig | null = null;
let checked = false;

export function loadNotionConfig(): NotionConfig | null {
  if (checked) return cached;
  checked = true;

  const token = process.env.NOTION_TOKEN;
  const pageId = process.env.NOTION_PAGE_ID;
  if (!token || !pageId) return null;

  cached = { token, parentPageId: parsePageId(pageId) };
  return cached;
}

function requireConfig(): NotionConfig {
  const cfg = loadNotionConfig();
  if (!cfg) throw new Error('NOTION_TOKEN and NOTION_PAGE_ID required for Notion tools.');
  return cfg;
}

function parsePageId(input: string): string {
  const m = input.match(
    /([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i,
  );
  return (m?.[1] ?? input).replace(/-/g, '');
}

function asUuid(hex: string): string {
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

// --- HTTP layer with 429 retry ---

async function api<T>(path: string, method: string, body?: unknown): Promise<T> {
  const { token } = requireConfig();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };

  let res = await fetch(`${NOTION_API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // single retry on rate limit
  if (res.status === 429) {
    const wait = Number(res.headers.get('Retry-After') || '1');
    await new Promise((r) => setTimeout(r, wait * 1000));
    res = await fetch(`${NOTION_API}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Notion API ${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

// --- Block type system ---

interface RichText {
  type: 'text';
  text: { content: string };
  annotations?: { bold?: boolean; italic?: boolean; code?: boolean; color?: string };
}

function rt(s: string, ann?: RichText['annotations']): RichText {
  return { type: 'text', text: { content: s }, ...(ann && { annotations: ann }) };
}

type HeadingBlock = { type: 'heading_2'; heading_2: { rich_text: RichText[] } }
  | { type: 'heading_3'; heading_3: { rich_text: RichText[] } };
type ParagraphBlock = { type: 'paragraph'; paragraph: { rich_text: RichText[] } };
type CalloutBlock = { type: 'callout'; callout: { rich_text: RichText[]; icon: { type: 'emoji'; emoji: string } } };
type DividerBlock = { type: 'divider'; divider: Record<string, never> };
type TodoBlock = { type: 'to_do'; to_do: { rich_text: RichText[]; checked: boolean } };
type TableRowBlock = { type: 'table_row'; table_row: { cells: RichText[][] } };
type TableBlock = {
  type: 'table';
  table: { table_width: number; has_column_header: boolean; has_row_header: boolean; children: TableRowBlock[] };
};

export type Block = HeadingBlock | ParagraphBlock | CalloutBlock | DividerBlock | TodoBlock | TableBlock;

function h2(s: string): HeadingBlock { return { type: 'heading_2', heading_2: { rich_text: [rt(s)] } }; }
function h3(s: string): HeadingBlock { return { type: 'heading_3', heading_3: { rich_text: [rt(s)] } }; }
function p(...parts: RichText[]): ParagraphBlock { return { type: 'paragraph', paragraph: { rich_text: parts } }; }
function note(s: string, emoji: string): CalloutBlock {
  return { type: 'callout', callout: { rich_text: [rt(s)], icon: { type: 'emoji', emoji } } };
}
function hr(): DividerBlock { return { type: 'divider', divider: {} }; }
function checkbox(s: string, done = false): TodoBlock {
  return { type: 'to_do', to_do: { rich_text: [rt(s)], checked: done } };
}
function tbl(cols: number, rows: string[][]): TableBlock {
  return {
    type: 'table',
    table: {
      table_width: cols,
      has_column_header: true,
      has_row_header: false,
      children: rows.map((cells) => ({
        type: 'table_row' as const,
        table_row: { cells: cells.map((c) => [rt(c)]) },
      })),
    },
  };
}

// --- Page ops (idempotent: archive existing, create fresh) ---

export interface NotionPage { id: string; url: string }

interface SearchResult {
  results: { id: string; properties?: { title?: { title?: { plain_text?: string }[] } } }[];
}

async function findPageByTitle(title: string): Promise<string | null> {
  const res = await api<SearchResult>('/search', 'POST', {
    query: title,
    filter: { value: 'page', property: 'object' },
    page_size: 5,
  });
  for (const pg of res.results) {
    const t = pg.properties?.title?.title?.map((x) => x.plain_text).join('') ?? '';
    if (t === title) return pg.id;
  }
  return null;
}

async function archivePage(pageId: string): Promise<void> {
  await api(`/pages/${pageId}`, 'PATCH', { archived: true });
}

async function upsertPage(title: string, blocks: Block[], icon?: string): Promise<NotionPage> {
  const cfg = requireConfig();

  const existing = await findPageByTitle(title);
  if (existing) await archivePage(existing);

  const body: Record<string, unknown> = {
    parent: { type: 'page_id', page_id: asUuid(cfg.parentPageId) },
    properties: { title: { title: [rt(title)] } },
    children: blocks,
  };
  if (icon) body.icon = { type: 'emoji', emoji: icon };

  return api<NotionPage>('/pages', 'POST', body);
}

// --- Page builders ---

export interface CostSnapshot {
  period: string;
  requests: number;
  spendUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheHitRate: number;
  models: { model: string; requests: number; costUsd: number }[];
}

export async function syncCostSnapshot(snap: CostSnapshot): Promise<NotionPage> {
  const date = new Date().toISOString().slice(0, 10);
  const title = `Cost Snapshot: ${snap.period}`;

  const blocks: Block[] = [
    note(`Synced ${date} via LLMKit. Period: ${snap.period}.`, '\u{1f4ca}'),
    h2('Summary'),
    tbl(2, [
      ['Metric', 'Value'],
      ['Total spend', `$${snap.spendUsd.toFixed(2)}`],
      ['Requests', snap.requests.toLocaleString()],
      ['Input tokens', snap.inputTokens.toLocaleString()],
      ['Output tokens', snap.outputTokens.toLocaleString()],
      ['Cache read tokens', snap.cacheReadTokens.toLocaleString()],
      ['Cache hit rate', `${snap.cacheHitRate}%`],
    ]),
  ];

  if (snap.models.length > 0) {
    blocks.push(
      h2('Model Breakdown'),
      tbl(3, [
        ['Model', 'Requests', 'Cost'],
        ...snap.models.map((m) => [m.model, String(m.requests), `$${m.costUsd.toFixed(4)}`]),
      ]),
    );
  }

  blocks.push(hr(), p(rt('Synced by LLMKit MCP Server', { italic: true })));
  return upsertPage(title, blocks, '\u{1f4b0}');
}

export interface BudgetEntry {
  name: string;
  limitUsd: number;
  spentUsd: number;
  period: string;
}

export async function syncBudgetStatus(budgets: BudgetEntry[]): Promise<NotionPage> {
  const date = new Date().toISOString().slice(0, 10);
  const title = 'Budget Status';

  const blocks: Block[] = [
    note(`Synced ${date} via LLMKit. ${budgets.length} active budget(s).`, '\u{1f4ca}'),
    h2('Active Budgets'),
    tbl(5, [
      ['Budget', 'Limit', 'Spent', 'Remaining', 'Period'],
      ...budgets.map((b) => {
        const pct = b.limitUsd > 0 ? ((b.spentUsd / b.limitUsd) * 100).toFixed(0) : '0';
        const rem = b.limitUsd - b.spentUsd;
        return [b.name, `$${b.limitUsd.toFixed(2)}`, `$${b.spentUsd.toFixed(2)} (${pct}%)`, `$${rem.toFixed(2)}`, b.period];
      }),
    ]),
  ];

  const overBudget = budgets.filter((b) => b.limitUsd > 0 && b.spentUsd / b.limitUsd >= 0.8);
  if (overBudget.length > 0) {
    blocks.push(h2('Alerts'));
    for (const b of overBudget) {
      const pct = ((b.spentUsd / b.limitUsd) * 100).toFixed(0);
      blocks.push(note(`${b.name} at ${pct}% of ${b.period} limit ($${b.spentUsd.toFixed(2)} / $${b.limitUsd.toFixed(2)})`, '\u{26a0}\u{fe0f}'));
    }
  }

  blocks.push(
    h2('Approval'),
    p(rt('Review the status above. Check the box to approve.')),
    checkbox('Approve current budget allocations'),
    checkbox('Request budget increase (add details in notes)'),
    h3('Notes'),
    p(rt('')),
    hr(),
    p(rt('Synced by LLMKit MCP Server', { italic: true })),
  );

  return upsertPage(title, blocks, '\u{1f6e1}\u{fe0f}');
}

export interface SessionEntry {
  id: string;
  requests: number;
  costUsd: number;
  durationMin: number;
  models: string[];
}

export async function syncSessionReport(source: string, sessions: SessionEntry[]): Promise<NotionPage> {
  const date = new Date().toISOString().slice(0, 10);
  const title = `Session Report: ${source}`;
  const totalCost = sessions.reduce((acc, s) => acc + s.costUsd, 0);
  const avgDur = sessions.length > 0
    ? Math.round(sessions.reduce((acc, s) => acc + s.durationMin, 0) / sessions.length)
    : 0;

  const blocks: Block[] = [
    note(`Synced ${date} via LLMKit. Source: ${source}. ${sessions.length} session(s).`, '\u{1f4ca}'),
    h2('Overview'),
    tbl(2, [
      ['Metric', 'Value'],
      ['Sessions', String(sessions.length)],
      ['Total cost', `$${totalCost.toFixed(4)}`],
      ['Avg duration', `${avgDur}m`],
    ]),
  ];

  if (sessions.length > 0) {
    blocks.push(
      h2('Sessions'),
      tbl(4, [
        ['Session', 'Requests', 'Cost', 'Models'],
        ...sessions.map((s) => [
          s.id.length > 16 ? `${s.id.slice(0, 16)}...` : s.id,
          String(s.requests),
          `$${s.costUsd.toFixed(4)}`,
          s.models.join(', '),
        ]),
      ]),
    );
  }

  blocks.push(hr(), p(rt('Synced by LLMKit MCP Server', { italic: true })));
  return upsertPage(title, blocks, '\u{1f4cb}');
}
