import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { store, usingFirebase } from "./store.js";

function ShareQR() {
  const [src, setSrc] = useState("");
  const url = window.location.origin + "/";
  useEffect(() => { QRCode.toDataURL(url, { width: 480, margin: 2 }).then(setSrc); }, [url]);
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl bg-white p-4 text-zinc-900">
      {src && <img src={src} alt="QR para votar" className="h-44 w-44" />}
      <p className="text-sm font-medium">Escanea para votar</p>
      <p className="text-xs text-zinc-500 break-all">{url}</p>
    </div>
  );
}

const ADMIN_PASSCODE = import.meta.env.VITE_ADMIN_PASSCODE || "admin";

function usePoll() {
  const [poll, setPoll] = useState(null);
  useEffect(() => store.subscribe(setPoll), []);
  return poll;
}

function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  const go = (p) => { window.history.pushState({}, "", p); setPath(p); };
  return [path, go];
}

const countOf = (poll, cat, id) => poll.counts?.[`${cat.key}__${id}`] || 0;
const catTotal = (poll, cat) => cat.candidates.reduce((a, c) => a + countOf(poll, cat, c.id), 0);

function CategoryResults({ poll, cat }) {
  const t = catTotal(poll, cat);
  const max = Math.max(1, ...cat.candidates.map((c) => countOf(poll, cat, c.id)));
  return (
    <ul className="space-y-4">
      {cat.candidates.map((c) => {
        const n = countOf(poll, cat, c.id);
        const pct = t ? Math.round((n / t) * 100) : 0;
        const lead = n === max && n > 0;
        return (
          <li key={c.id}>
            <div className="mb-1 flex justify-between text-lg">
              <span className={lead ? "font-semibold text-white" : "text-zinc-300"}>{lead && "👑 "}{c.label}</span>
              <span className="tabular-nums text-zinc-400">{n} · {pct}%</span>
            </div>
            <div className="h-5 overflow-hidden rounded-full bg-zinc-800">
              <div className={`h-full rounded-full transition-all duration-500 ${lead ? "bg-fuchsia-500" : "bg-zinc-500"}`} style={{ width: `${(n / max) * 100}%` }} />
            </div>
          </li>
        );
      })}
      <li className="pt-1 text-sm text-zinc-500">{t} voto{t === 1 ? "" : "s"}</li>
    </ul>
  );
}

function AllResults({ poll, big }) {
  return (
    <div className={`grid gap-10 ${big ? "md:grid-cols-2" : ""}`}>
      {poll.categories.map((cat) => (
        <section key={cat.key}>
          <h2 className={`mb-4 font-bold uppercase tracking-wide text-fuchsia-300 ${big ? "text-3xl" : "text-xl"}`}>{cat.label}</h2>
          <CategoryResults poll={poll} cat={cat} />
        </section>
      ))}
    </div>
  );
}

function CategoryVote({ poll, cat }) {
  const key = `voted-${poll.round}-${cat.key}`;
  const [voted, setVoted] = useState(() => localStorage.getItem(key));
  const [err, setErr] = useState("");
  useEffect(() => setVoted(localStorage.getItem(key)), [key]);

  async function cast(id) {
    try {
      await store.vote(cat.key, id);
      localStorage.setItem(key, id);
      setVoted(id);
    } catch { setErr("No se pudo registrar tu voto. Intenta de nuevo."); }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-bold uppercase tracking-wide text-fuchsia-300">{cat.label}</h2>
      {voted ? (
        <p className="rounded-xl bg-zinc-900 p-4 text-fuchsia-300">✓ Voto registrado en {cat.label}. ¡Gracias!</p>
      ) : !poll.open ? (
        <p className="rounded-xl bg-zinc-900 p-4 text-zinc-400">Votación cerrada.</p>
      ) : (
        cat.candidates.map((c) => (
          <button key={c.id} onClick={() => cast(c.id)}
            className="w-full rounded-2xl bg-zinc-900 px-6 py-4 text-left text-xl font-medium ring-1 ring-zinc-700 transition active:scale-[0.98] hover:bg-fuchsia-600 hover:ring-fuchsia-400">
            {c.label}
          </button>
        ))
      )}
      {err && <p className="text-red-400">{err}</p>}
    </section>
  );
}

function Admin({ poll }) {
  const [authed, setAuthed] = useState(sessionStorage.getItem("admin") === "1");
  const [code, setCode] = useState("");
  const [title, setTitle] = useState(poll.title);
  const [lists, setLists] = useState(() => Object.fromEntries(poll.categories.map((c) => [c.key, c.candidates.map((x) => x.label).join("\n")])));

  if (!authed) return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (code === ADMIN_PASSCODE) { sessionStorage.setItem("admin", "1"); setAuthed(true); } }}>
      <input type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Contraseña de administrador"
        className="w-full rounded-xl bg-zinc-900 px-4 py-3 ring-1 ring-zinc-700" />
      <button className="w-full rounded-xl bg-fuchsia-600 py-3 font-medium">Entrar</button>
    </form>
  );

  const publish = () => {
    const categories = poll.categories.map((cat) => ({
      key: cat.key, label: cat.label,
      candidates: lists[cat.key].split("\n").map((s) => s.trim()).filter(Boolean).map((label, i) => ({ id: `c${i}`, label })),
    }));
    if (categories.some((c) => c.candidates.length < 2)) return alert("Cada categoría necesita al menos 2 candidatos.");
    store.save({ title: title.trim() || "Votaciones", categories, open: true }, poll.round);
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Nueva votación (borra los votos)</h2>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-xl bg-zinc-900 px-4 py-3 ring-1 ring-zinc-700" />
        {poll.categories.map((cat) => (
          <label key={cat.key} className="block">
            <span className="mb-1 block text-sm text-zinc-400">{cat.label}: un candidato por línea</span>
            <textarea rows={5} value={lists[cat.key]} onChange={(e) => setLists({ ...lists, [cat.key]: e.target.value })}
              className="w-full rounded-xl bg-zinc-900 px-4 py-3 ring-1 ring-zinc-700" />
          </label>
        ))}
        <button onClick={publish} className="w-full rounded-xl bg-fuchsia-600 py-3 font-medium">Publicar</button>
      </section>
      <section className="grid grid-cols-2 gap-3">
        <button onClick={() => store.setOpen(!poll.open)} className="rounded-xl bg-zinc-800 py-3">{poll.open ? "Cerrar votación" : "Reabrir votación"}</button>
        <button onClick={() => confirm("¿Borrar todos los votos?") && store.resetVotes(poll.round)} className="rounded-xl bg-zinc-800 py-3 text-red-300">Reiniciar votos</button>
      </section>
      <section className="flex justify-center"><ShareQR /></section>
      <section><h2 className="mb-3 text-lg font-semibold">Resultados en vivo</h2><AllResults poll={poll} /></section>
    </div>
  );
}

export default function App() {
  const poll = usePoll();
  const [path, go] = usePath();
  if (!poll) return <p className="p-8 text-center text-zinc-400">Cargando…</p>;
  const screen = path.startsWith("/results") || path.startsWith("/resultados");
  const link = (to, text) => <a href={to} onClick={(e) => { e.preventDefault(); go(to); }}>{text}</a>;
  return (
    <main className={`mx-auto min-h-screen px-5 py-8 ${screen ? "max-w-5xl" : "max-w-xl"}`}>
      {!usingFirebase && <p className="mb-4 rounded-lg bg-amber-900/40 px-3 py-2 text-sm text-amber-200">Modo demo: Firebase no está configurado, los votos quedan solo en este dispositivo. Ver README.</p>}
      <header className="mb-8">
        <h1 className={`font-bold leading-tight ${screen ? "text-5xl" : "text-3xl"}`}>{poll.title}</h1>
        <p className="mt-2 text-sm text-zinc-500">{poll.open ? "● Votación abierta" : "Votación cerrada"}</p>
      </header>
      {path.startsWith("/admin") ? <Admin poll={poll} />
        : screen ? <div className="space-y-10"><AllResults poll={poll} big /><div className="flex justify-center"><ShareQR /></div></div>
        : <div className="space-y-10">
            {poll.categories.map((cat) => <CategoryVote key={cat.key} poll={poll} cat={cat} />)}
            <div><h2 className="mb-4 text-xl font-bold">Resultados en vivo</h2><AllResults poll={poll} /></div>
          </div>}
      <nav className="mt-10 flex gap-4 text-sm text-zinc-600">
        {link("/", "Votar")}{link("/resultados", "Pantalla de resultados")}{link("/admin", "Admin")}
      </nav>
    </main>
  );
}
