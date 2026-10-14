import { type FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { errorText } from '../api';
import { useAuth } from '../auth';
import { ErrorNote } from '../components/ui';
import { homeFor } from '../routes';

export function Login() {
  const { user, login, verify } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mfa, setMfa] = useState<{ mfaToken: string; otpauthUrl?: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  const run = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await fn(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  const secret = mfa?.otpauthUrl ? new URL(mfa.otpauthUrl).searchParams.get('secret') : null;

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm">
        <h1 className="mb-1 text-lg font-semibold">Aegis<span className="text-accent">Resolve</span></h1>
        <p className="mb-4 text-sm text-ink/60">Evidence-based complaint processing</p>
        {!mfa ? (
          <form className="space-y-3" onSubmit={run(async () => setMfa(await login(username, password)))}>
            <div><label className="label" htmlFor="u">Username</label><input id="u" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></div>
            <div><label className="label" htmlFor="p">Password</label><input id="p" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
            <ErrorNote error={error} />
            <button className="btn-primary w-full justify-center" disabled={busy}>Continue</button>
          </form>
        ) : (
          <form className="space-y-3" onSubmit={run(() => verify(mfa.mfaToken, code))}>
            {secret && (
              <div className="rounded border border-line bg-paper p-3 text-sm">
                <p className="mb-1">Set up your authenticator app with this key, then enter the 6-digit code.</p>
                <p className="mono select-all">{secret}</p>
              </div>
            )}
            <div><label className="label" htmlFor="c">Authenticator code</label>
              <input id="c" className="input font-mono tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus /></div>
            <ErrorNote error={error} />
            <button className="btn-primary w-full justify-center" disabled={busy || code.length !== 6}>Verify</button>
          </form>
        )}
      </div>
    </div>
  );
}
