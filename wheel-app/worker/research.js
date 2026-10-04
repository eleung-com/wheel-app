// Research relay — SEC EDGAR, FMP and Finnhub for the Research tab ("Run a stock").
// Served by the Cloudflare Pages Function functions/research/[[path]].js on the
// app's own address, so Cloudflare Access protects it (decided 10-03). The
// keys + SEC contact header stay server-side as Pages secrets.
// Pure relay: the app does the parsing and scoring. Edge-cached per target.
//
// /research/sec/files/…   → www.sec.gov/files/…   (ticker → CIK list)
// /research/sec/api/…     → data.sec.gov/api/…    (XBRL company concepts)
// /research/fmp/…         → financialmodelingprep.com/… + apikey
// /research/finnhub/…     → finnhub.io/… + token
// Only these upstream hosts are reachable, and only by path under them.
const SEC_UA = (email) => `wheel-desk research ${email}`;

export function researchTarget(url, env) {
  const rest = url.pathname.slice('/research/'.length);
  const q = new URLSearchParams(url.search);
  if (rest.startsWith('sec/')) {
    if (!env.SEC_CONTACT_EMAIL) return { error: 'SEC_CONTACT_EMAIL secret is not set', status: 500 };
    const p = rest.slice(4);
    const host = p.startsWith('files/') ? 'https://www.sec.gov/' : p.startsWith('api/') ? 'https://data.sec.gov/' : null;
    if (!host) return { error: 'unknown sec path', status: 404 };
    return {
      url: host + p,
      headers: { 'User-Agent': SEC_UA(env.SEC_CONTACT_EMAIL), Accept: 'application/json' },
      ttl: p.startsWith('files/') ? 86400 : 21600, // ticker list daily; filings every 6 h
    };
  }
  if (rest.startsWith('fmp/')) {
    if (!env.FMP_KEY) return { error: 'FMP_KEY secret is not set', status: 500 };
    q.set('apikey', env.FMP_KEY);
    return { url: `https://financialmodelingprep.com/${rest.slice(4)}?${q}`, headers: { Accept: 'application/json' }, ttl: 86400 };
  }
  if (rest.startsWith('finnhub/')) {
    if (!env.FINNHUB_KEY) return { error: 'FINNHUB_KEY secret is not set', status: 500 };
    q.set('token', env.FINNHUB_KEY);
    return { url: `https://finnhub.io/${rest.slice(8)}?${q}`, headers: { Accept: 'application/json' }, ttl: 86400 };
  }
  return { error: 'unknown research route', status: 404 };
}

/** Fetch one research target and stream it back with the given extra headers. */
export async function fetchResearch(url, env, headers = {}) {
  const json = (body, status) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', ...headers },
  });
  const target = researchTarget(url, env);
  if (target.error) return json({ error: target.error }, target.status);
  try {
    const res = await fetch(target.url, {
      headers: target.headers,
      cf: { cacheTtl: target.ttl, cacheEverything: true },
    });
    return new Response(res.body, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') || 'application/json', ...headers },
    });
  } catch (e) {
    return json({ error: String(e.message || e) }, 502);
  }
}
