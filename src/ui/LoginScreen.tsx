import { useState, type FormEvent } from 'react';
import { supabase } from '../auth/client';

interface Props {
  notice: string | null;
  configured: boolean;
  onUser: (s: { kind: 'user'; userId: string; email: string }) => void;
  onDemo: () => void;
  onLocal: () => void;
}

export function LoginScreen({ notice, configured, onUser, onDemo, onLocal }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase!.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err || !data.user) {
      setError(/fetch|network/i.test(err?.message ?? '') ? 'Brak połączenia. Pierwsze logowanie wymaga internetu.' : 'Nieprawidłowy e-mail lub hasło.');
      return;
    }
    onUser({ kind: 'user', userId: data.user.id, email: data.user.email ?? '' });
  }

  return (
    <div className="login">
      <h1>Plakaty</h1>
      <p className="muted">Plan i rejestr rozwieszania plakatów</p>
      {notice && <p className="notice">{notice}</p>}
      {configured ? (
        <form onSubmit={submit} className="stack">
          <label>E-mail<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Hasło<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn primary" disabled={busy}>{busy ? 'Logowanie…' : 'Zaloguj się'}</button>
        </form>
      ) : (
        <>
          <p className="notice">Chmura nie jest skonfigurowana. Dane będą tylko na tym urządzeniu.</p>
          <button className="btn primary" onClick={onLocal}>Pracuj lokalnie (bez chmury)</button>
        </>
      )}
      <hr />
      <button className="btn" onClick={onDemo}>Tryb demonstracyjny</button>
      <p className="muted small">Dane fikcyjne, odseparowane od prawdziwej bazy.</p>
    </div>
  );
}
