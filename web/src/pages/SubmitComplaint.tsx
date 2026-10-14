import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorText, post, uploadEvidence } from '../api';
import { ErrorNote, Section } from '../components/ui';

interface Receipt { caseId: string; pseudonym: string; txId: string; status: string }
interface Uploaded { name: string; sha256Plain: string; txId: string }

const STEPS = ['Describe', 'Asset & location', 'Evidence', 'Review'];

export function SubmitComplaint() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ title: '', description: '', assetRefs: '', locationRef: '', occurredAt: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [uploaded, setUploaded] = useState<Uploaded[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await post<Receipt>('/cases', {
        title: form.title, description: form.description, locationRef: form.locationRef.trim(),
        assetRefs: form.assetRefs.split(/[\s,]+/).filter(Boolean),
        occurredAt: new Date(form.occurredAt).toISOString(),
      });
      setReceipt(r);
      for (const f of files) {
        const u = await uploadEvidence(r.caseId, f);
        setUploaded((x) => [...x, { name: f.name, sha256Plain: u.sha256Plain, txId: u.txId }]);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (receipt) {
    return (
      <Section title="Complaint registered">
        <dl className="grid grid-cols-[10rem_1fr] gap-y-1.5 text-sm">
          <dt className="text-ink/60">Case ID</dt><dd className="font-mono">{receipt.caseId}</dd>
          <dt className="text-ink/60">Your pseudonym</dt><dd className="font-mono">{receipt.pseudonym}</dd>
          <dt className="text-ink/60">Ledger transaction</dt><dd className="mono">{receipt.txId}</dd>
          {uploaded.map((u) => (
            <Fragment key={u.txId}><dt className="text-ink/60">{u.name}</dt><dd className="mono">SHA-256 {u.sha256Plain}</dd></Fragment>
          ))}
        </dl>
        <ErrorNote error={error} />
        <p className="mt-4 text-sm text-ink/70">Your identity is not shared with investigators. Track progress under <Link className="text-accent underline" to="/cases">My cases</Link>.</p>
      </Section>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <ol className="flex gap-2 text-sm">
        {STEPS.map((s, i) => <li key={s} className={`rounded px-2 py-1 ${i === step ? 'bg-accent text-white' : 'bg-white text-ink/60'}`}>{i + 1}. {s}</li>)}
      </ol>
      <Section title={STEPS[step]}>
        {step === 0 && (
          <div className="space-y-3">
            <div><label className="label" htmlFor="t">Title</label><input id="t" className="input" value={form.title} onChange={set('title')} maxLength={200} /></div>
            <div><label className="label" htmlFor="d">What happened</label><textarea id="d" className="input h-36" value={form.description} onChange={set('description')} maxLength={5000} />
              <p className="mt-1 text-xs text-ink/50">At least 20 characters. Encrypted before storage; only a hash goes on the ledger.</p></div>
            <div><label className="label" htmlFor="o">When did it happen</label><input id="o" className="input" type="datetime-local" value={form.occurredAt} onChange={set('occurredAt')} /></div>
          </div>
        )}
        {step === 1 && (
          <div className="space-y-3">
            <div><label className="label" htmlFor="l">Location</label><input id="l" className="input font-mono" placeholder="DEP-02/MAG-01/BAY-04" value={form.locationRef} onChange={set('locationRef')} /></div>
            <div><label className="label" htmlFor="a">Lot numbers (optional, comma separated)</label><input id="a" className="input font-mono" placeholder="LOT-B03-2025-0117" value={form.assetRefs} onChange={set('assetRefs')} /></div>
          </div>
        )}
        {step === 2 && (
          <div>
            <label className="label" htmlFor="f">Evidence files (images, PDF, audio, text; up to 25 MB each)</label>
            <input id="f" type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.mp3,.wav,.txt,.csv,.json" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
            <ul className="mt-2 text-sm">{files.map((f) => <li key={f.name}>{f.name} · {(f.size / 1024).toFixed(0)} KB</li>)}</ul>
          </div>
        )}
        {step === 3 && (
          <dl className="grid grid-cols-[10rem_1fr] gap-y-1.5 text-sm">
            <dt className="text-ink/60">Title</dt><dd>{form.title}</dd>
            <dt className="text-ink/60">Location</dt><dd className="font-mono">{form.locationRef}</dd>
            <dt className="text-ink/60">Lots</dt><dd className="font-mono">{form.assetRefs || '—'}</dd>
            <dt className="text-ink/60">Evidence</dt><dd>{files.length} file(s)</dd>
          </dl>
        )}
        <ErrorNote error={error} />
        <div className="mt-4 flex justify-between">
          <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
          {step < 3
            ? <button className="btn-primary" disabled={step === 0 && (form.title.length < 5 || form.description.length < 20 || !form.occurredAt)} onClick={() => setStep(step + 1)}>Next</button>
            : <button className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit complaint'}</button>}
        </div>
      </Section>
    </div>
  );
}
