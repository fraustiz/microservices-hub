"use client";

import { useEffect, useState, type FormEvent } from "react";

type User = { id: string; email: string; role: string; dept: string };
type DocumentItem = { id: string; title: string; dept: string };
type Source = { ref: string; id: string; title: string };

// Vide en production : le front et l'API sont sur la même origine (la gateway).
// En `pnpm dev`, NEXT_PUBLIC_GATEWAY_URL=http://localhost : appel cross-origin, autorisé par le middleware cors.
const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "";
const SESSION_EXPIRED = "hub:session-expired";

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(GATEWAY + path, {
    ...init,
    credentials: "include",
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
  });
}

let refreshing: Promise<boolean> | undefined;

/**
 * Renouvelle la session. Les appels simultanés partagent le même renouvellement : le refresh token est à usage
 * unique, et le présenter deux fois serait pris pour un vol (auth-service révoquerait toutes les sessions).
 */
function refresh(): Promise<boolean> {
  refreshing ??= send("/auth/refresh", { method: "POST" })
    .then((res) => res.ok)
    .finally(() => (refreshing = undefined));
  return refreshing;
}

/** Appel à la gateway. Jeton d'accès expiré : un renouvellement par le refresh token, puis une seule nouvelle tentative. */
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await send(path, init);
  if (res.status === 401 && !path.startsWith("/auth/")) {
    if (await refresh()) res = await send(path, init);
    else window.dispatchEvent(new Event(SESSION_EXPIRED));
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Erreur ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

async function restoreSession(): Promise<User | null> {
  let res = await send("/auth/me");
  if (res.status === 401 && (await refresh())) res = await send("/auth/me");
  return res.ok ? ((await res.json()) as { user: User }).user : null;
}

const message = (err: unknown) => (err instanceof Error ? err.message : "Erreur inattendue");

export function Hub() {
  const [user, setUser] = useState<User | null>();

  useEffect(() => {
    restoreSession().then(setUser, () => setUser(null));
    const expired = () => setUser(null);
    window.addEventListener(SESSION_EXPIRED, expired);
    return () => window.removeEventListener(SESSION_EXPIRED, expired);
  }, []);

  if (user === undefined) return <p className="muted">Chargement…</p>;
  if (!user) return <Login onLogin={setUser} />;
  return (
    <>
      <section className="panel row">
        <p>
          Connecté : <strong>{user.email}</strong> <span className="muted">({user.role}, {user.dept})</span>
        </p>
        <button className="secondary" onClick={() => api("/auth/logout", { method: "POST" }).finally(() => setUser(null))}>
          Se déconnecter
        </button>
      </section>
      <Ask />
      <Documents />
    </>
  );
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const { user } = await api<{ user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      onLogin(user);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Connexion</h2>
      <form onSubmit={submit}>
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Mot de passe
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && <p className="error">{error}</p>}
        <button disabled={busy}>Se connecter</button>
      </form>
      <p className="muted">Comptes de démonstration : alice, bruno, chloe, david (@hub.local).</p>
    </section>
  );
}

function Ask() {
  const [result, setResult] = useState<{ answer: string; sources: Source[] }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = new FormData(event.currentTarget).get("question");
    setBusy(true);
    setError("");
    try {
      setResult(await api("/agent/ask", { method: "POST", body: JSON.stringify({ question }) }));
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel stack">
      <h2>Poser une question à l'agent</h2>
      <form onSubmit={submit}>
        <textarea name="question" maxLength={1000} required placeholder="Combien de jours de congés ai-je par an ?" />
        <button disabled={busy}>{busy ? "L'agent réfléchit…" : "Envoyer"}</button>
      </form>
      {error && <p className="error">{error}</p>}
      {result && (
        <>
          {/* Texte affiché tel quel, jamais interprété comme du HTML : la sortie du LLM n'est pas exécutée. */}
          <p className="answer">{result.answer}</p>
          {result.sources.length > 0 && (
            <ul>
              {result.sources.map((source) => (
                <li key={source.id}>
                  [{source.ref}] {source.title}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function Documents() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ documents: DocumentItem[] }>("/api/documents?limit=20").then(
      (body) => setDocuments(body.documents),
      (err) => setError(message(err)),
    );
  }, []);

  async function summarize(id: string) {
    setSummaries((s) => ({ ...s, [id]: "Résumé en cours…" }));
    try {
      const { summary } = await api<{ summary: string }>("/agent/summarize", {
        method: "POST",
        body: JSON.stringify({ documentId: id }),
      });
      setSummaries((s) => ({ ...s, [id]: summary }));
    } catch (err) {
      setSummaries((s) => ({ ...s, [id]: message(err) }));
    }
  }

  return (
    <section className="panel stack">
      <h2>Documents accessibles ({documents.length})</h2>
      {error && <p className="error">{error}</p>}
      <ul>
        {documents.map((doc) => (
          <li key={doc.id} className="stack">
            <div className="row">
              <span>{doc.title}</span>
              <span className="muted">{doc.dept}</span>
              <button className="secondary" onClick={() => summarize(doc.id)}>
                Résumer
              </button>
            </div>
            {summaries[doc.id] && <p className="answer">{summaries[doc.id]}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
