'use client';
import { useEffect, useState } from 'react';

type Item = { reviewId: string; reason: string; detail: string; candidateSiteIds?: string[] | null; provisionalKey?: string | null; siteId?: string | null; resolution?: string | null };

const labels: Record<string, string> = {
  dup_source_id: 'Repeated source id',
  address_flag: 'Address needs review',
  coverage_excluded: 'Coverage exclusion',
  new_unreviewed: 'New unreviewed row',
  address_changed: 'Address changed',
  missing_in_new_batch: 'Missing from latest file',
  fp_collision: 'Fingerprint collision',
  region_mismatch: 'Region mismatch',
  classification_changed: 'Classification changed',
};

export default function ReviewQueue() {
  const [payload, setPayload] = useState<any>(null);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('All open');
  const [busy, setBusy] = useState('');

  async function load() {
    setError('');
    const response = await fetch('/api/admin/review');
    const body = await response.json().catch(() => ({})) as { message?: string };
    if (!response.ok) {
      setPayload(null);
      setError(body.message || (response.status === 403 ? 'This identity cannot open the review queue.' : 'The review queue is not available.'));
      return;
    }
    setPayload(body);
  }

  useEffect(() => { void load(); }, []);

  async function act(reviewId: string, resolution: 'keep_separate' | 'defer') {
    setBusy(reviewId);
    const response = await fetch('/api/admin/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reviewId, resolution }) });
    const body = await response.json().catch(() => ({})) as { message?: string };
    setBusy('');
    if (!response.ok) {
      setError(body.message || 'The review action was not saved.');
      return;
    }
    setPayload((current: any) => current ? { ...current, items: current.items.map((item: Item) => item.reviewId === reviewId ? { ...item, resolution } : item) } : current);
  }

  const items: Item[] = payload?.items || [];
  const visible = items.filter((item) => reason === 'All open' || item.reason === reason);
  const reasons = ['All open', ...new Set(items.map((item) => item.reason))];

  return <section className="panel review-queue" aria-label="Site review queue">
    <div className="panel-heading"><div><span className="eyebrow">REVIEW QUEUE</span><h2>Rows held for a person</h2><p>Nothing in this queue is merged or deleted automatically. Repeated ids stay separate, and a missing file row stays in the database.</p></div></div>
    {payload?.execution === 'simulation' && <p className="notice" role="status">Simulated sample. {payload.note}</p>}
    {error && <p className="notice" role="status">{error}</p>}
    {!payload && !error && <p role="status">Loading review queue…</p>}
    {payload && <>
      <div className="tabs" role="tablist" aria-label="Review reasons">{reasons.map((item) => <button key={item} className={reason === item ? 'active' : ''} aria-pressed={reason === item} onClick={() => setReason(item)}>{labels[item] || item}</button>)}</div>
      {visible.length ? <ul className="review-list">{visible.map((item) => <li key={item.reviewId}><div><b>{labels[item.reason] || item.reason}</b><p>{item.detail}</p>{item.resolution && <small>Recorded locally as {item.resolution}. {payload.execution === 'simulation' ? 'This sample was not written to D1.' : 'Saved.'}</small>}</div><div className="review-actions"><button className="secondary" disabled={!!item.resolution || busy === item.reviewId} onClick={() => act(item.reviewId, 'keep_separate')}>Keep separate</button><button className="secondary" disabled={!!item.resolution || busy === item.reviewId} onClick={() => act(item.reviewId, 'defer')}>Defer</button></div></li>)}</ul> : <p className="empty-state">No open items for this reason.</p>}
    </>}
  </section>;
}
