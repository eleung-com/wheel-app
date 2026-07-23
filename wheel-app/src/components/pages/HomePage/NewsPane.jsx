import React, { useState } from 'react';
import { SECTORS } from '../../../hooks/useNews';

const RANK_LABEL = ['Lead', 'Second', 'Third'];

function ago(ts) {
  if (!ts) return '';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/**
 * One story. Collapsed it is a headline and a source line; expanded it adds
 * everything else Yahoo gives us.
 *
 * Yahoo's search endpoint returns no article summary — only title, publisher,
 * timestamp, related tickers and a thumbnail — so the expansion shows those
 * rather than body text. Related tickers earn their place here: they are how
 * you tell a story genuinely about your ticker from one that merely lists it.
 */
function Story({ item, ticker, headingLevel: H = 'div' }) {
  const [open, setOpen] = useState(false);
  const others = ticker ? item.tickers.filter(t => t !== ticker) : item.tickers;

  return (
    <div className={`nstory${open ? ' open' : ''}`}>
      <button
        type="button"
        className="nstory-hit"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <H className="nstory-title">{item.title}</H>
        <span className="nstory-src">
          <em>{item.publisher}</em>
          {item.publishedAt ? ` · ${ago(item.publishedAt)}` : ''}
        </span>
      </button>

      {open && (
        <div className="nstory-more">
          {item.thumb && (
            <img className="nstory-thumb" src={item.thumb} alt="" loading="lazy" />
          )}
          {others.length > 0 && (
            <div className="nstory-rel">
              <span className="nstory-rel-l">Also about</span>
              {others.map(t => <span key={t} className="nstory-tag">{t}</span>)}
            </div>
          )}
          {item.publishedAt > 0 && (
            <div className="nstory-when">
              {new Date(item.publishedAt).toLocaleString(undefined, {
                weekday: 'short', month: 'short', day: 'numeric',
                hour: 'numeric', minute: '2-digit',
              })}
            </div>
          )}
          {item.link && (
            <a className="nstory-link" href={item.link} target="_blank" rel="noopener noreferrer">
              Read on Yahoo ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default function NewsPane({ news, loading, onRefresh, priorityTickers }) {
  if (!news) {
    return (
      <div className="news-empty">
        {loading ? 'Pulling headlines…' : 'No headlines yet — tap refresh.'}
        {!loading && (
          <button type="button" className="nrefresh" onClick={onRefresh}>Refresh</button>
        )}
      </div>
    );
  }

  const top = (news.market || []).slice(0, 3);

  return (
    <>
      <div className="news-head">
        <div className="slabel">Top 3 · market</div>
        <button type="button" className="nrefresh" onClick={onRefresh} disabled={loading}>
          {loading ? 'refreshing…' : `refreshed ${ago(news.fetchedAt)}`}
        </button>
      </div>

      {top.length === 0 && <div className="news-empty">Yahoo returned nothing for the market.</div>}
      {top.map((item, i) => (
        <div className="nlead" key={item.id || i}>
          <div className="nrank">{RANK_LABEL[i]}</div>
          <Story item={item} />
        </div>
      ))}

      {priorityTickers.length > 0 && (
        <>
          <div className="news-head">
            <div className="slabel">Your tickers</div>
            <span className="news-time">🔥 Priority</span>
          </div>
          {priorityTickers.map(t => {
            const item = (news.tickers?.[t] || [])[0];
            if (!item) {
              return (
                <div className="ntkrow" key={t}>
                  <span className="ntk hot">{t}</span>
                  <span className="ntk-none">No recent stories</span>
                </div>
              );
            }
            return (
              <div className="ntkrow" key={t}>
                <span className="ntk hot">{t}</span>
                <div className="ntk-body">
                  <Story item={item} ticker={t} />
                  {!item.onTopic && (
                    <span className="nflag">⚠ mentions {t}, may not be about it</span>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}

      <div className="news-head">
        <div className="slabel">By industry · {SECTORS.length} sectors</div>
        <span className="news-time">tap to expand</span>
      </div>
      {SECTORS.map(s => {
        const items = news.sectors?.[s.etf] || [];
        return (
          <details className="nsector" key={s.etf}>
            <summary>
              <span className="netf">{s.etf}</span>
              {s.name}
              <span className="narrow">›</span>
            </summary>
            <div className="nsector-body">
              {items.length === 0 && <div className="ntk-none">No recent stories</div>}
              {items.map((item, i) => <Story key={item.id || i} item={item} />)}
            </div>
          </details>
        );
      })}
    </>
  );
}
