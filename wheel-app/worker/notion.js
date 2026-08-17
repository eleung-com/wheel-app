// Notion helpers — split out of worker.js so the scheduled scan (scan.js) can
// reuse readWatchlist() without an import cycle back through worker.js's fetch().

const NOTION_ORIGIN  = 'https://api.notion.com';
const NOTION_VERSION = '2022-06-28';

// Stock Scan Results
const NOTION_DB_ID = '35c400a3-854e-80ff-9b36-fd7ddaa3a850';

export const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

function notionFetch(env, path, init) {
  return fetch(NOTION_ORIGIN + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'content-type': 'application/json',
      ...(init && init.headers),
    },
  });
}

function plain(rich) {
  return (rich || []).map((t) => t.plain_text).join('');
}

/** First present Notion date property from `names`, as its ISO start, else ''. */
function dateProp(props, names) {
  for (const n of names) {
    if (props[n] && props[n].date && props[n].date.start) return props[n].date.start;
  }
  return '';
}

/** Every page where TV Lists is non-empty, flattened for the app. */
export async function readWatchlist(env) {
  const rows = [];
  let cursor = null;

  do {
    const body = {
      page_size: 100,
      filter: { property: 'TV Lists', multi_select: { is_not_empty: true } },
      ...(cursor ? { start_cursor: cursor } : {}),
    };
    const res = await notionFetch(env, `/v1/databases/${NOTION_DB_ID}/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`notion query ${res.status}: ${detail.slice(0, 300)}`);
    }

    const data = await res.json();
    for (const page of data.results) {
      const p = page.properties || {};
      const ticker = plain(p.Ticker && p.Ticker.title).trim().toUpperCase();
      if (!ticker) continue;

      rows.push({
        pageId:   page.id,
        ticker,
        notes:    plain(p.Notes && p.Notes.rich_text),
        verdict:  p['scanner verdict'] && p['scanner verdict'].select
          ? p['scanner verdict'].select.name : '',
        // Drives which tickers the news feed pulls — '🔥 Priority' rows lead it.
        diveIn:   p['Dive-In'] && p['Dive-In'].select
          ? p['Dive-In'].select.name : '',
        // Shown as pills on the signal cards. These ride along on the query the
        // watchlist already makes, so they cost nothing extra and still render
        // when the (much more expensive) page-body fetch fails.
        wheel:    p['Wheel (CSP)'] && p['Wheel (CSP)'].select
          ? p['Wheel (CSP)'].select.name : '',
        fundamentals: p.Fundamentals && p.Fundamentals.select
          ? p.Fundamentals.select.name : '',
        lastEval: p['Last Eval Date'] && p['Last Eval Date'].date
          ? p['Last Eval Date'].date.start : '',
        // Drives the Home news-tab earnings calendar. Read by whichever of these
        // names the database uses, so renaming the Notion property to any of them
        // keeps working; '' when none is set or the date is empty.
        earnings: dateProp(p, ['Earnings Date', 'Earnings', 'Next Earnings']),
        // Groups the watchlist cards and the chart's ticker strip.
        sector:   p.sector && p.sector.select ? p.sector.select.name : '',
        addedAt:  Date.parse(page.created_time) || null,
      });
    }

    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return rows;
}

// ── Latest evaluation ────────────────────────────────────────────────────────
// Each ticker page is a stack of toggle headers, newest first, whose titles are
// eval dates ("# 07-21-2026"). The newest evaluation is therefore everything
// nested under the FIRST toggle header on the page. Nothing below that first
// header is read, so older evals never leak into the app.

const EVAL_MAX_BLOCKS = 60;   // guards against an unusually long eval
const EVAL_MAX_TABLES = 6;    // each table costs an extra round trip

async function blockChildren(env, id) {
  const res = await notionFetch(env, `/v1/blocks/${id}/children?page_size=100`);
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`notion blocks ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.results || [];
}

/** A toggle block, or a heading with the toggle arrow turned on. */
function isToggleHeader(b) {
  if (b.type === 'toggle') return true;
  const h = b.type === 'heading_1' || b.type === 'heading_2' || b.type === 'heading_3';
  return h && b[b.type] && b[b.type].is_toggleable === true;
}

export async function readEval(env, pageId) {
  const top    = await blockChildren(env, pageId);
  const header = top.find(isToggleHeader);
  if (!header) return null;

  const title = plain(header[header.type].rich_text);
  const kids  = header.has_children ? await blockChildren(env, header.id) : [];

  const blocks = [];
  let tables = 0;

  for (const b of kids.slice(0, EVAL_MAX_BLOCKS)) {
    switch (b.type) {
      case 'heading_1':
      case 'heading_2':
      case 'heading_3':
        blocks.push({ type: 'heading', text: plain(b[b.type].rich_text) });
        break;
      case 'paragraph': {
        const text = plain(b.paragraph.rich_text);
        if (text.trim()) blocks.push({ type: 'text', text });
        break;
      }
      case 'quote':
        blocks.push({ type: 'text', text: plain(b.quote.rich_text) });
        break;
      case 'bulleted_list_item':
        blocks.push({ type: 'bullet', text: plain(b.bulleted_list_item.rich_text) });
        break;
      case 'numbered_list_item':
        blocks.push({ type: 'bullet', text: plain(b.numbered_list_item.rich_text) });
        break;
      case 'table': {
        if (!b.has_children || tables >= EVAL_MAX_TABLES) break;
        tables++;
        const rowBlocks = await blockChildren(env, b.id);
        const rows = rowBlocks
          .filter(r => r.type === 'table_row')
          .map(r => (r.table_row.cells || []).map(plain))
          // Notion tables often carry an empty first row when the header is
          // styled but unfilled — dropping blank rows keeps the app's table honest.
          .filter(cells => cells.some(c => c.trim()));
        if (rows.length) {
          blocks.push({ type: 'table', hasHeader: !!(b.table && b.table.has_column_header), rows });
        }
        break;
      }
      default:
        break; // dividers, images, embeds — not part of the written evaluation
    }
  }

  return { title, blocks };
}

/** Patch the one property the app owns. Nothing else is ever written. */
export async function updatePage(env, pageId, patch) {
  const properties = {};

  if (typeof patch.notes === 'string') {
    // Notion caps a single rich_text chunk at 2000 chars.
    const content = patch.notes.slice(0, 2000);
    properties.Notes = { rich_text: content ? [{ text: { content } }] : [] };
  }

  if (!Object.keys(properties).length) throw new Error('nothing to update');

  const res = await notionFetch(env, `/v1/pages/${pageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`notion patch ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}
