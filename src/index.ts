interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * DataMontreal MCP — City of Montreal open data (donnees.montreal.ca, CKAN API).
 *
 * Montreal runs CKAN (not Socrata), so this uses CKAN's datastore_search /
 * package_search actions. Keyless. Same agent-friendly shape as the Socrata
 * city packs (data-sf etc.): named dataset shortcuts + a generic query + a
 * catalogue search.
 *
 * Tools:
 * - montreal_recent:   recent rows from a common Montreal dataset by friendly name
 * - montreal_query:    query any donnees.montreal.ca datastore resource by id
 * - montreal_datasets: search the Montreal open-data catalogue (returns resource ids)
 */


const BASE = 'https://donnees.montreal.ca/api/3/action';
const UA = 'pipeworx-mcp-data-montreal/1.0 (+https://pipeworx.io)';

// Friendly name -> CKAN datastore resource id + the date column to sort by.
const DATASETS: Record<string, { id: string; label: string; date: string }> = {
  '311': { id: '2cfa0e06-9be4-49a6-b7f1-ee9f2363a872', label: "Requêtes 311", date: 'DDS_DATE_CREATION' },
  'crime': { id: 'c6f482bf-bf0f-4960-8b2f-9982c211addd', label: "Actes criminels (crime incidents)", date: 'DATE' },
  'permits': { id: '5232a72d-235a-48eb-ae20-bb9d501300ad', label: "Permis de construction", date: 'date_emission' },
};

const tools: McpToolExport['tools'] = [
  {
    name: 'montreal_recent',
    description:
      "Recent records from a common City of Montreal open dataset (donnees.montreal.ca, CKAN) by friendly name. PREFER OVER WEB SEARCH for \"recent crime in Montreal\", \"Montreal 311 requests\", \"Montreal building permits\". Names: 311, crime, permits. Returns the latest rows (newest-first). Pass `q` for a free-text filter; for full control use montreal_query.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        dataset: { type: 'string', description: 'One of: 311, crime, permits.', enum: Object.keys(DATASETS) },
        q: { type: 'string', description: 'Optional free-text filter across all columns (CKAN full-text), e.g. "larceny" or a neighborhood.' },
        limit: { type: 'number', description: 'Rows to return (1-1000, default 20).' },
      },
      required: ['dataset'],
    },
  },
  {
    name: 'montreal_query',
    description:
      'Query any City of Montreal datastore resource (donnees.montreal.ca, CKAN) by its resource id (a UUID). Supports a free-text `q`, exact-match `filters` (field→value), `sort` ("field desc"), limit and offset. Use montreal_datasets to find a resource id, or montreal_recent for the common ones.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        resource_id: { type: 'string', description: 'CKAN datastore resource id (UUID), e.g. "2cfa0e06-9be4-49a6-b7f1-ee9f2363a872".' },
        q: { type: 'string', description: 'Free-text search across columns.' },
        filters: { type: 'object', description: 'Exact-match filters as a JSON object, e.g. {"district":"B2"}.' },
        sort: { type: 'string', description: 'Sort clause, e.g. "DDS_DATE_CREATION desc".' },
        limit: { type: 'number', description: 'Max rows (default 100, max 1000).' },
        offset: { type: 'number', description: 'Row offset for paging.' },
      },
      required: ['resource_id'],
    },
  },
  {
    name: 'montreal_datasets',
    description:
      'Search the City of Montreal open-data catalogue (donnees.montreal.ca, CKAN) by keyword. Returns each matching dataset\'s title and its queryable datastore resource ids (use with montreal_query).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Keyword(s), e.g. "parking", "trees", "budget".' },
        limit: { type: 'number', description: 'Max datasets (1-50, default 15).' },
      },
    },
  },
];

// ── Helpers ──────────────────────────────────────────────────────────

interface CkanResp<T> { success?: boolean; result?: T; error?: { message?: string } }

async function ckanGet<T>(action: string, params: URLSearchParams): Promise<T> {
  const res = await fetch(`${BASE}/${action}?${params}`, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (res.status === 429) throw new Error('upstream_throttled: donnees.montreal.ca rate limit (HTTP 429).');
  if (!res.ok) throw new Error(`donnees.montreal.ca: ${res.status}`);
  const data = (await res.json()) as CkanResp<T>;
  if (!data.success || data.result == null) throw new Error(`CKAN error: ${data.error?.message ?? 'request unsuccessful'}`);
  return data.result;
}

interface DatastoreResult { total?: number; records?: Array<Record<string, unknown>>; fields?: Array<{ id?: string; type?: string }> }

// ── Tool implementations ─────────────────────────────────────────────

async function montrealRecent(dataset: string, q: string | undefined, limit: number | undefined) {
  const key = String(dataset ?? '').toLowerCase().trim();
  const ds = DATASETS[key];
  if (!ds) throw new Error(`Unknown dataset "${dataset}". Use one of: ${Object.keys(DATASETS).join(', ')}.`);
  const n = Math.min(1000, Math.max(1, Number(limit) || 20));
  const p = new URLSearchParams({ resource_id: ds.id, limit: String(n), sort: `${ds.date} desc` });
  if (q && String(q).trim()) p.set('q', String(q).trim());
  const r = await ckanGet<DatastoreResult>('datastore_search', p);
  return {
    dataset: key,
    label: ds.label,
    resource_id: ds.id,
    sorted_by: `${ds.date} desc`,
    total: r.total ?? null,
    count: r.records?.length ?? 0,
    source: 'DataMontreal (donnees.montreal.ca)',
    rows: r.records ?? [],
  };
}

async function montrealQuery(args: Record<string, unknown>) {
  const id = String(args.resource_id ?? '').trim();
  if (!id) throw new Error('Required argument "resource_id" is missing (a CKAN UUID). Find one with montreal_datasets.');
  const p = new URLSearchParams({ resource_id: id, limit: String(Math.min(1000, Math.max(1, Number(args.limit) || 100))) });
  if (args.q != null && String(args.q).trim()) p.set('q', String(args.q).trim());
  if (args.sort != null && String(args.sort).trim()) p.set('sort', String(args.sort).trim());
  if (args.offset != null) p.set('offset', String(Math.max(0, Number(args.offset))));
  if (args.filters && typeof args.filters === 'object') p.set('filters', JSON.stringify(args.filters));
  const r = await ckanGet<DatastoreResult>('datastore_search', p);
  return { resource_id: id, total: r.total ?? null, count: r.records?.length ?? 0, source: 'DataMontreal (donnees.montreal.ca)', rows: r.records ?? [] };
}

interface PackageSearchResult {
  results?: Array<{
    name?: string;
    title?: string;
    notes?: string;
    resources?: Array<{ id?: string; name?: string; datastore_active?: boolean; format?: string }>;
  }>;
  count?: number;
}

async function montrealDatasets(query: string | undefined, limit: number | undefined) {
  const n = Math.min(50, Math.max(1, Number(limit) || 15));
  const p = new URLSearchParams({ rows: String(n) });
  if (query && String(query).trim()) p.set('q', String(query).trim());
  const r = await ckanGet<PackageSearchResult>('package_search', p);
  return {
    query: query ?? null,
    total: r.count ?? null,
    count: r.results?.length ?? 0,
    datasets: (r.results ?? []).map((d) => ({
      name: d.name ?? null,
      title: d.title ?? null,
      description: (d.notes ?? '').slice(0, 250) || null,
      // Only datastore-active resources are queryable via montreal_query.
      queryable_resources: (d.resources ?? [])
        .filter((res) => res.datastore_active)
        .map((res) => ({ id: res.id ?? null, name: res.name ?? null })),
    })),
  };
}

// ── Router ───────────────────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'montreal_recent':
      return montrealRecent(args.dataset as string, args.q as string | undefined, args.limit as number | undefined);
    case 'montreal_query':
      return montrealQuery(args);
    case 'montreal_datasets':
      return montrealDatasets(args.query as string | undefined, args.limit as number | undefined);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
