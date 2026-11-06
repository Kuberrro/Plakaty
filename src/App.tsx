import { useEffect, useRef, useState } from 'react';
import { configProblem, forgetUser, lastUser, rememberUser, supabase, supabaseConfigured } from './auth/client';
import { dbName, type Scope } from './data/db';
import { LoginScreen } from './ui/LoginScreen';
import { Workspace } from './ui/Workspace';

const DEMO_FLAG = 'plakaty-demo-active';

export function App() {
  const [scope, setScope] = useState<Scope | null>(null);
  const [booting, setBooting] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const userLogout = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (sessionStorage.getItem(DEMO_FLAG)) { setScope({ kind: 'demo' }); setBooting(false); return; }
      if (!supabase) { setBooting(false); return; }
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!alive) return;
        const u = data.session?.user;
        if (u) {
          rememberUser({ userId: u.id, email: u.email ?? '' });
          setScope({ kind: 'user', userId: u.id, email: u.email ?? '' });
        } else {
          // Wygasła sesja bez sieci: praca lokalna trwa, wysyłka poczeka na ponowne logowanie.
          const last = lastUser();
          if (last && (error || !navigator.onLine)) setScope({ kind: 'user', ...last });
        }
      } catch {
        const last = lastUser();
        if (last) setScope({ kind: 'user', ...last });
      }
      setBooting(false);
    })();
    const sub = supabase?.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && !userLogout.current) {
        setNotice('Sesja wygasła. Zaloguj się ponownie: niewysłane zmiany czekają na tym urządzeniu.');
        setScope((s) => (s?.kind === 'user' ? null : s));
      }
    });
    return () => { alive = false; sub?.data.subscription.unsubscribe(); };
  }, []);

  if (booting) return <div className="center-screen">Ładowanie…</div>;

  const problem = configProblem();
  if (problem) return <div className="center-screen error-text">{problem}</div>;

  if (!scope) {
    return (
      <LoginScreen
        notice={notice}
        configured={supabaseConfigured}
        onUser={(s) => { setNotice(null); rememberUser({ userId: s.userId, email: s.email }); setScope(s); }}
        onDemo={() => { sessionStorage.setItem(DEMO_FLAG, '1'); setScope({ kind: 'demo' }); }}
        onLocal={() => setScope({ kind: 'local' })}
      />
    );
  }
  return (
    <Workspace
      key={dbName(scope)}
      scope={scope}
      onLeave={async () => {
        if (scope.kind === 'demo') sessionStorage.removeItem(DEMO_FLAG);
        if (scope.kind === 'user') {
          userLogout.current = true;
          forgetUser();
          await supabase?.auth.signOut({ scope: 'local' }).catch(() => {});
          userLogout.current = false;
        }
        setScope(null);
      }}
    />
  );
}
