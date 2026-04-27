import React, { useState, useCallback } from 'react';

const LS_KEY = 'wd_strategy_cards';

const CAT = {
  bull:    { label: 'Bullish',  color: 'var(--g)' },
  neutral: { label: 'Neutral',  color: 'var(--a)' },
  bear:    { label: 'Bearish',  color: 'var(--r)' },
};

// ── Initial card data ─────────────────────────────────────────────────────────
// To render cards from a dynamic source, replace INITIAL_CARDS and swap
// the hardcoded JSX with a loop over the array — renderCard(card) pattern.
const INITIAL_CARDS = [
  {
    id: 'csp',
    category: 'bull',
    title: 'Cash-Secured Put',
    badge: 'Bullish · want shares',
    subtitle: 'Stock you\'d own anyway. Cash on hand for assignment. Pullback or consolidation near support.',
    meta: { dte: '30–45', delta: '0.10–0.15', ivRank: '≥ 30' },
    checks: [
      'Cash for 100 × strike, in this account, now',
      'Strike at or below fair value',
      'RSI between 30 and 50 (oversold or neutral)',
      'Stoch %K turning up from below 20',
      'IV rank above 30',
      'No earnings or catalyst before expiration',
      'On pre-approved "would own" list',
    ],
    specs: [
      { key: 'DTE',           value: '30–45' },
      { key: 'Delta',         value: '0.10–0.15' },
      { key: 'Premium',       value: '≥ 0.5% of strike' },
      { key: 'ROC target',    value: '≥ 1% per 30 days' },
      { key: 'Spread',        value: '< 10% of mid' },
      { key: 'Open interest', value: '500+' },
    ],
    manageRules: [
      'Take profit at 50% of max premium',
      'If assigned, sell a covered call (the wheel)',
      'Never roll for a debit',
      'Close by 7 DTE if not at target',
    ],
  },
  {
    id: 'cc',
    category: 'neutral',
    title: 'Covered Call',
    badge: 'Neutral · own shares',
    subtitle: 'Own 100+ shares. Range-bound or topping. OK with shares being called away at strike.',
    meta: { dte: '30–45', delta: '0.10–0.15', ivRank: '≥ 30' },
    checks: [
      'Strike at or above cost basis',
      'RSI between 50 and 70 (not overbought)',
      'Stoch %K rolling over from above 80',
      'IV rank above 30',
      'No earnings or ex-div before expiration',
      'Genuinely OK if shares are called away',
    ],
    specs: [
      { key: 'DTE',           value: '30–45' },
      { key: 'Delta',         value: '0.10–0.15' },
      { key: 'Premium',       value: '≥ 0.3% of share price' },
      { key: 'Spread',        value: '< 10% of mid' },
      { key: 'Open interest', value: '500+' },
    ],
    manageRules: [
      'Take profit at 50% of max premium',
      'Roll up & out for net credit only',
      'Close by 7 DTE if not at target',
      'If called away: that\'s a win, not a loss',
    ],
  },
];

function loadCards() {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) return JSON.parse(saved);
  } catch (_) { /* ignore */ }
  return INITIAL_CARDS;
}

function saveCards(cards) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(cards)); } catch (_) { /* ignore */ }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function BlockLabel({ text }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 700, color: 'var(--mu)',
      textTransform: 'uppercase', letterSpacing: '0.8px',
      padding: '12px 0 6px', fontFamily: 'var(--sans)',
    }}>
      {text}
    </div>
  );
}

function InlineInput({ value, onChange, style = {}, onClick }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 'none',
        borderBottom: '1px solid var(--b2)',
        outline: 'none',
        fontFamily: 'inherit',
        color: 'inherit',
        padding: '2px 0',
        ...style,
      }}
    />
  );
}

function DeleteBtn({ onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none', border: 'none',
        color: 'var(--r)', fontSize: 18,
        cursor: 'pointer', padding: '0 4px',
        lineHeight: 1, flexShrink: 0,
      }}
    >×</button>
  );
}

function AddRowBtn({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 11, color: 'var(--g)',
        background: 'none', border: 'none',
        cursor: 'pointer', padding: '8px 0',
        fontFamily: 'var(--sans)',
      }}
    >{label}</button>
  );
}

// ── Strategy card ─────────────────────────────────────────────────────────────

function StrategyCard({
  card, editMode, isExpanded,
  checkStates, onToggleExpand, onToggleCheck, onResetChecks,
  onAddPosition,
  onUpdateField, onUpdateMeta,
  onUpdateCheck, onDeleteCheck, onAddCheck,
  onUpdateSpec,  onDeleteSpec,  onAddSpec,
  onUpdateRule,  onDeleteRule,  onAddRule,
  onDeleteCard,
}) {
  const cat = CAT[card.category] || CAT.bull;
  const checkedCount = checkStates.filter(Boolean).length;
  const totalChecks  = card.checks.length;
  const stop = e => e.stopPropagation();

  const posType = card.category === 'bull'
    ? 'short_put'
    : card.category === 'neutral'
      ? 'short_call'
      : null;

  return (
    <div style={{
      background: 'var(--s1)',
      border: '1px solid var(--b1)',
      borderRadius: 'var(--rr)',
      marginBottom: 10,
      overflow: 'hidden',
    }}>
      {/* ── Header ── */}
      <div
        onClick={!editMode ? onToggleExpand : undefined}
        style={{ padding: '12px 14px', cursor: editMode ? 'default' : 'pointer', userSelect: editMode ? 'text' : 'none' }}
      >
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            {editMode ? (
              <InlineInput
                value={card.title}
                onChange={v => onUpdateField('title', v)}
                onClick={stop}
                style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--sans)', flex: 1 }}
              />
            ) : (
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{card.title}</div>
            )}
            <span style={{
              fontSize: 9, fontWeight: 600,
              padding: '2px 7px', borderRadius: 10,
              background: `${cat.color}22`, color: cat.color,
              whiteSpace: 'nowrap', letterSpacing: '0.3px',
              fontFamily: 'var(--sans)', flexShrink: 0,
            }}>
              {editMode ? (
                <InlineInput
                  value={card.badge}
                  onChange={v => onUpdateField('badge', v)}
                  onClick={stop}
                  style={{ fontSize: 9, fontWeight: 600, color: cat.color, fontFamily: 'var(--sans)', width: `${Math.max(card.badge.length, 8)}ch` }}
                />
              ) : card.badge}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 8 }}>
            {editMode
              ? <button onClick={e => { stop(e); onDeleteCard(); }} style={{ background: 'var(--r)', color: '#fff', border: 'none', borderRadius: 4, width: 22, height: 22, cursor: 'pointer', fontSize: 14, fontWeight: 700, lineHeight: '22px' }}>×</button>
              : <span style={{ fontSize: 10, color: 'var(--mu)', lineHeight: 1 }}>{isExpanded ? '▲' : '▼'}</span>
            }
          </div>
        </div>

        {/* Subtitle */}
        {editMode ? (
          <InlineInput
            value={card.subtitle}
            onChange={v => onUpdateField('subtitle', v)}
            onClick={stop}
            style={{ fontSize: 11, color: 'var(--mu)', fontFamily: 'var(--sans)', width: '100%', display: 'block', marginBottom: 8 }}
          />
        ) : (
          <div style={{ fontSize: 11, color: 'var(--mu)', marginBottom: 8, lineHeight: 1.4 }}>{card.subtitle}</div>
        )}

        {/* Meta row */}
        <div style={{ display: 'flex', gap: 20 }}>
          {[
            { label: 'DTE',     key: 'dte'    },
            { label: 'Delta',   key: 'delta'  },
            { label: 'IV Rank', key: 'ivRank' },
          ].map(({ label, key }) => (
            <div key={key}>
              <div style={{ fontSize: 8, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'var(--mono)', marginBottom: 2 }}>{label}</div>
              {editMode ? (
                <InlineInput
                  value={card.meta[key]}
                  onChange={v => onUpdateMeta(key, v)}
                  onClick={stop}
                  style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--mono)', width: 64 }}
                />
              ) : (
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--mono)' }}>{card.meta[key]}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Expanded body ── */}
      {isExpanded && (
        <div style={{ borderTop: '1px solid var(--b1)', padding: '0 14px 14px' }}>

          {/* CONFIRM */}
          <BlockLabel text="Confirm" />
          {card.checks.map((check, idx) => {
            const checked = !editMode && !!checkStates[idx];
            return (
              <div key={idx} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '7px 0',
                borderBottom: idx < card.checks.length - 1 ? '1px solid var(--b1)' : 'none',
                minHeight: 44,
              }}>
                <div
                  onClick={!editMode ? () => onToggleCheck(idx) : undefined}
                  style={{
                    width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                    border: `2px solid ${checked ? 'var(--g)' : 'var(--b2)'}`,
                    background: checked ? 'var(--g)' : 'transparent',
                    cursor: editMode ? 'default' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {checked && <span style={{ color: '#000', fontSize: 10, fontWeight: 700 }}>✓</span>}
                </div>
                {editMode ? (
                  <>
                    <InlineInput
                      value={check}
                      onChange={v => onUpdateCheck(idx, v)}
                      style={{ flex: 1, fontSize: 12, color: 'var(--fg)', fontFamily: 'var(--sans)' }}
                    />
                    <DeleteBtn onClick={() => onDeleteCheck(idx)} />
                  </>
                ) : (
                  <span
                    onClick={() => onToggleCheck(idx)}
                    style={{ fontSize: 12, color: 'var(--fg)', flex: 1, lineHeight: 1.4, cursor: 'pointer', textDecoration: checked ? 'line-through' : 'none', opacity: checked ? 0.5 : 1 }}
                  >{check}</span>
                )}
              </div>
            );
          })}
          {editMode && <AddRowBtn label="+ Add check" onClick={onAddCheck} />}

          {/* EXECUTE */}
          <BlockLabel text="Execute" />
          <div style={{ background: 'var(--s2)', borderRadius: 'var(--rr)', overflow: 'hidden' }}>
            {card.specs.map((spec, idx) => (
              <div key={idx} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px',
                borderBottom: idx < card.specs.length - 1 ? '1px solid var(--b1)' : 'none',
              }}>
                {editMode ? (
                  <>
                    <InlineInput
                      value={spec.key}
                      onChange={v => onUpdateSpec(idx, 'key', v)}
                      style={{ width: 100, fontSize: 11, color: 'var(--mu)', fontFamily: 'var(--sans)' }}
                    />
                    <InlineInput
                      value={spec.value}
                      onChange={v => onUpdateSpec(idx, 'value', v)}
                      style={{ flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--mono)' }}
                    />
                    <DeleteBtn onClick={() => onDeleteSpec(idx)} />
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 11, color: 'var(--mu)', flex: '0 0 110px', fontFamily: 'var(--sans)' }}>{spec.key}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--mono)' }}>{spec.value}</span>
                  </>
                )}
              </div>
            ))}
          </div>
          {editMode && <AddRowBtn label="+ Add spec" onClick={onAddSpec} />}

          {/* Add position CTA (view mode only) */}
          {!editMode && onAddPosition && posType && (
            <button
              onClick={() => onAddPosition(posType)}
              style={{
                width: '100%', marginTop: 12, marginBottom: 2,
                padding: '10px', borderRadius: 'var(--rr)',
                border: `1px solid ${cat.color}55`,
                background: `${cat.color}11`,
                color: cat.color,
                fontSize: 11, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'var(--sans)',
                letterSpacing: '0.3px',
              }}
            >
              + Add {card.title} Position
            </button>
          )}

          {/* MANAGE */}
          <BlockLabel text="Manage" />
          {card.manageRules.map((rule, idx) => (
            <div key={idx} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 0',
              borderBottom: idx < card.manageRules.length - 1 ? '1px solid var(--b1)' : 'none',
              minHeight: 36,
            }}>
              {!editMode && <span style={{ fontSize: 10, color: 'var(--mu)', flexShrink: 0 }}>›</span>}
              {editMode ? (
                <>
                  <InlineInput
                    value={rule}
                    onChange={v => onUpdateRule(idx, v)}
                    style={{ flex: 1, fontSize: 12, color: 'var(--fg)', fontFamily: 'var(--sans)' }}
                  />
                  <DeleteBtn onClick={() => onDeleteRule(idx)} />
                </>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--fg)', flex: 1, lineHeight: 1.4 }}>{rule}</span>
              )}
            </div>
          ))}
          {editMode && <AddRowBtn label="+ Add rule" onClick={onAddRule} />}

          {/* Progress bar (view mode only) */}
          {!editMode && totalChecks > 0 && (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--b1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: 'var(--mu)', fontFamily: 'var(--mono)' }}>
                  {checkedCount} / {totalChecks} checks
                </span>
                <button
                  onClick={onResetChecks}
                  style={{ fontSize: 10, color: 'var(--mu)', background: 'none', border: '1px solid var(--b2)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontFamily: 'var(--sans)' }}
                >Reset</button>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: 'var(--b1)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${totalChecks > 0 ? (checkedCount / totalChecks) * 100 : 0}%`,
                  background: checkedCount === totalChecks ? 'var(--g)' : 'var(--a)',
                  borderRadius: 2, transition: 'width 0.3s',
                }} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StrategiesTab({ onAddPosition }) {
  const [filter,     setFilter]     = useState('bull');
  const [editMode,   setEditMode]   = useState(false);
  const [cards,      setCards]      = useState(loadCards);
  const [editCards,  setEditCards]  = useState(null);
  const [expanded,   setExpanded]   = useState(() => new Set(['csp']));
  const [checks,     setChecks]     = useState({});
  const [showSaved,  setShowSaved]  = useState(false);

  const activeCards = editMode ? editCards : cards;

  function getCheckStates(cardId, len) {
    const arr = checks[cardId] || [];
    const padded = [...arr];
    while (padded.length < len) padded.push(false);
    return padded.slice(0, len);
  }

  function toggleCheck(cardId, idx) {
    setChecks(prev => {
      const card = cards.find(c => c.id === cardId);
      const arr  = getCheckStates(cardId, card.checks.length);
      const next = [...arr];
      next[idx] = !next[idx];
      return { ...prev, [cardId]: next };
    });
  }

  function toggleExpand(cardId) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId); else next.add(cardId);
      return next;
    });
  }

  function enterEdit() {
    setEditCards(JSON.parse(JSON.stringify(cards)));
    setExpanded(prev => new Set([...prev, ...cards.map(c => c.id)]));
    setEditMode(true);
  }

  function exitEdit() {
    saveCards(editCards);
    setCards(editCards);
    setEditCards(null);
    setEditMode(false);
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 1500);
  }

  // ── Edit helpers ──

  const mutate = useCallback((cardId, fn) => {
    setEditCards(prev => prev.map(c => c.id === cardId ? fn(c) : c));
  }, []);

  const updateField   = (id, k, v) => mutate(id, c => ({ ...c, [k]: v }));
  const updateMeta    = (id, k, v) => mutate(id, c => ({ ...c, meta: { ...c.meta, [k]: v } }));
  const updateCheck   = (id, i, v) => mutate(id, c => { const a = [...c.checks]; a[i] = v; return { ...c, checks: a }; });
  const deleteCheck   = (id, i) => {
    mutate(id, c => ({ ...c, checks: c.checks.filter((_, j) => j !== i) }));
    setChecks(prev => { const a = [...(prev[id] || [])]; a.splice(i, 1); return { ...prev, [id]: a }; });
  };
  const addCheck      = (id) => mutate(id, c => ({ ...c, checks: [...c.checks, 'New check item'] }));
  const updateSpec    = (id, i, f, v) => mutate(id, c => { const s = c.specs.map((x, j) => j === i ? { ...x, [f]: v } : x); return { ...c, specs: s }; });
  const deleteSpec    = (id, i) => mutate(id, c => ({ ...c, specs: c.specs.filter((_, j) => j !== i) }));
  const addSpec       = (id) => mutate(id, c => ({ ...c, specs: [...c.specs, { key: 'Field', value: '—' }] }));
  const updateRule    = (id, i, v) => mutate(id, c => { const a = [...c.manageRules]; a[i] = v; return { ...c, manageRules: a }; });
  const deleteRule    = (id, i) => mutate(id, c => ({ ...c, manageRules: c.manageRules.filter((_, j) => j !== i) }));
  const addRule       = (id) => mutate(id, c => ({ ...c, manageRules: [...c.manageRules, 'New rule'] }));
  const deleteCard    = (id) => {
    setEditCards(prev => prev.filter(c => c.id !== id));
    setExpanded(prev => { const s = new Set(prev); s.delete(id); return s; });
  };

  function addCard() {
    const id = `card_${Date.now()}`;
    setEditCards(prev => [...prev, {
      id, category: 'bull',
      title: 'New Strategy', badge: 'Bullish',
      subtitle: 'Describe when to use this strategy.',
      meta: { dte: '—', delta: '—', ivRank: '—' },
      checks: ['New check item'],
      specs: [{ key: 'Field', value: '—' }],
      manageRules: ['New rule'],
    }]);
    setExpanded(prev => new Set([...prev, id]));
  }

  const filteredCards = editMode
    ? activeCards
    : activeCards.filter(c => c.category === filter);

  return (
    <div style={{ position: 'relative' }}>
      {/* ── Top bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {['bull', 'neutral', 'bear'].map(cat => (
            <button
              key={cat}
              onClick={() => { if (!editMode) setFilter(cat); }}
              style={{
                padding: '5px 12px', borderRadius: 20,
                border: `1px solid ${filter === cat && !editMode ? CAT[cat].color : 'var(--b2)'}`,
                background: filter === cat && !editMode ? `${CAT[cat].color}22` : 'transparent',
                color: filter === cat && !editMode ? CAT[cat].color : 'var(--mu)',
                fontSize: 11, fontWeight: 600,
                cursor: editMode ? 'default' : 'pointer',
                fontFamily: 'var(--sans)', letterSpacing: '0.3px',
                opacity: editMode ? 0.4 : 1,
                transition: 'all .15s',
              }}
            >{CAT[cat].label}</button>
          ))}
        </div>
        <button
          onClick={editMode ? exitEdit : enterEdit}
          style={{
            padding: '5px 14px', borderRadius: 6,
            border: '1px solid var(--b2)',
            background: editMode ? 'var(--g)' : 'transparent',
            color: editMode ? '#000' : 'var(--mu)',
            fontSize: 11, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'var(--sans)',
            transition: 'all .15s',
          }}
        >{editMode ? 'Done' : 'Edit'}</button>
      </div>

      {/* ── Card list ── */}
      {filteredCards.map(card => (
        <StrategyCard
          key={card.id}
          card={card}
          editMode={editMode}
          isExpanded={expanded.has(card.id)}
          checkStates={getCheckStates(card.id, card.checks.length)}
          onToggleExpand={() => toggleExpand(card.id)}
          onToggleCheck={idx => toggleCheck(card.id, idx)}
          onResetChecks={() => setChecks(prev => ({ ...prev, [card.id]: [] }))}
          onAddPosition={onAddPosition}
          onUpdateField={(k, v) => updateField(card.id, k, v)}
          onUpdateMeta={(k, v) => updateMeta(card.id, k, v)}
          onUpdateCheck={(i, v) => updateCheck(card.id, i, v)}
          onDeleteCheck={i => deleteCheck(card.id, i)}
          onAddCheck={() => addCheck(card.id)}
          onUpdateSpec={(i, f, v) => updateSpec(card.id, i, f, v)}
          onDeleteSpec={i => deleteSpec(card.id, i)}
          onAddSpec={() => addSpec(card.id)}
          onUpdateRule={(i, v) => updateRule(card.id, i, v)}
          onDeleteRule={i => deleteRule(card.id, i)}
          onAddRule={() => addRule(card.id)}
          onDeleteCard={() => deleteCard(card.id)}
        />
      ))}

      {/* New card button (edit mode only) */}
      {editMode && (
        <button
          onClick={addCard}
          style={{
            width: '100%', padding: '12px',
            border: '1px dashed var(--b2)', borderRadius: 'var(--rr)',
            background: 'transparent', color: 'var(--mu)',
            fontSize: 12, cursor: 'pointer', marginTop: 8,
            fontFamily: 'var(--sans)',
          }}
        >+ New strategy card</button>
      )}

      {/* Saved toast */}
      {showSaved && (
        <div style={{
          position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--g)', color: '#000',
          padding: '8px 20px', borderRadius: 20,
          fontSize: 12, fontWeight: 600, zIndex: 9999,
          pointerEvents: 'none',
        }}>Saved</div>
      )}
    </div>
  );
}
