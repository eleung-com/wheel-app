import React from 'react';

/**
 * Renders the latest Notion evaluation — the contents under the first toggle
 * header on the ticker's page, as flattened by the worker's /notion/eval route.
 *
 * The same component backs the signal card and the detail modal; only the
 * height differs, which the caller controls via the wrapper's class.
 */
export default function EvalBody({ evaluation, notes, loading }) {
  if (loading && !evaluation) {
    return <div className="evl-empty">Loading the latest evaluation…</div>;
  }
  if (!evaluation && !notes) {
    return <div className="evl-empty">No evaluation written in Notion yet.</div>;
  }

  return (
    <>
      {notes && (
        <div className="evl-notes">
          <span className="evl-notes-l">Notes</span> {notes}
        </div>
      )}

      {evaluation && (
        <>
          {evaluation.title && <div className="evl-date">{evaluation.title}</div>}
          {evaluation.blocks.map((b, i) => {
            if (b.type === 'heading') return <div key={i} className="evl-h">{b.text}</div>;
            if (b.type === 'bullet')  return <div key={i} className="evl-li">{b.text}</div>;
            if (b.type === 'text')    return <p key={i} className="evl-p">{b.text}</p>;
            if (b.type === 'table') {
              const rows = b.rows || [];
              if (!rows.length) return null;
              const head = b.hasHeader ? rows[0] : null;
              const body = b.hasHeader ? rows.slice(1) : rows;
              return (
                <div key={i} className="evl-tw">
                  <table className="evl-t">
                    {head && (
                      <thead>
                        <tr>{head.map((c, j) => <th key={j}>{c}</th>)}</tr>
                      </thead>
                    )}
                    <tbody>
                      {body.map((r, j) => (
                        <tr key={j}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            }
            return null;
          })}
        </>
      )}
    </>
  );
}
