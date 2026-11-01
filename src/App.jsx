import { useEffect, useState } from "react";
import { store, usingFirebase } from "./store.js";

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

const total = (poll) => Object.values(poll.counts || {}).reduce((a, b) => a + b, 0);

function Results({ poll }) {
  const t = total(poll);
  const max = Math.max(1, ...poll.options.map((o) => poll.counts?.[o.id] || 0));
  return (
    <ul className="space-y-4">
      {poll.options.map((o) => {
        const n = poll.counts?.[o.id] || 0;
        const pct = t ? Math.round((n / t) * 100) : 0;
        const lead = n === max && n > 0;
        return (
          <li key={o.id}>
            <div className="mb-1 flex justify-between text-lg">
              <span className={lead ? "font-semibold text-white" : "text-zinc-300"}>{o.label}</span>
              <span className="tabular-nums text-zinc-400">{n} · {pct}%</span>
            </div>
            <div className="h-5 overflow-hidden rounded-full bg-zinc-800">
              <div className={`h-full rounded-full transition-all duration-500 ${lead ? "bg-fuchsia-500" : "bg-zinc-500"}`} style={{ width: `${(n / max) * 100}%` }} />
            </div>
          </li>
        );
      })}
      <li className="pt-2 text-sm text-zinc-500">{t} vote{t === 1 ? "" : "s"} total</li>
    </ul>
  );
}

function Vote({ poll }) {
  const key = `voted-round-${poll.round}`;
  const [voted, setVoted] = useState(() => localStorage.getItem(key));
  useEffect(() => setVoted(localStorage.getItem(key)), [key]);
  const [err, setErr] = useState("");

  async function cast(id) {
    try {
      await store.vote(id);
      localStorage.setItem(key, id);
      setVoted(id);
    } catch (e) { setErr("Couldn't record your vote. Try again."); }
  }

  if (!poll.open && !voted) return (
    <p className="rounded-xl bg-zinc-900 p-6 text-center text-zinc-300">Voting is closed. Watch the screen for results!</p>
  );
  if (voted) return (
    <div className="space-y-6">
      <p className="rounded-xl bg-zinc-900 p-4 text-center text-fuchsia-300">Vote recorded — thanks!</p>
      <Results poll={poll} />
    </div>
  );
  return (
    <div className="space-y-3">
      {poll.options.map((o) => (
        <button key={o.id} onClick={() => cast(o.id)}
          className="w-full rounded-2xl bg-zinc-900 px-6 py-5 text-left text-xl font-medium ring-1 ring-zinc-700 transition active:scale-[0.98] hover:bg-fuchsia-600 hover:ring-fuchsia-400">
          {o.label}
        </button>
      ))}
      {err && <p className="text-red-400">{err}</p>}
    </div>
  );
}

function Admin({ poll }) {
  const [authed, setAuthed] = useState(sessionStorage.getItem("admin") === "1");
  const [code, setCode] = useState("");
  const [question, setQuestion] = useState(poll.question);
  const [labels, setLabels] = useState(poll.options.map((o) => o.label).join("\n"));

  if (!authed) return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (code === ADMIN_PASSCODE) { sessionStorage.setItem("admin", "1"); setAuthed(true); } }}>
      <input type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Admin passcode"
        className="w-full rounded-xl bg-zinc-900 px-4 py-3 ring-1 ring-zinc-700" />
      <button className="w-full rounded-xl bg-fuchsia-600 py-3 font-medium">Enter</button>
    </form>
  );

  const create = () => {
    const opts = labels.split("\n").map((s) => s.trim()).filter(Boolean).map((label, i) => ({ id: `o${i}`, label }));
    if (!question.trim() || opts.length < 2) return alert("Need a question and at least 2 options.");
    store.save({ question: question.trim(), options: opts, open: true }, poll.round);
  };
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">New poll (clears votes)</h2>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} className="w-full rounded-xl bg-zinc-900 px-4 py-3 ring-1 ring-zinc-700" />
        <textarea rows={5} value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="One option per line"
          className="w-full rounded-xl bg-zinc-900 px-4 py-3 ring-1 ring-zinc-700" />
        <button onClick={create} className="w-full rounded-xl bg-fuchsia-600 py-3 font-medium">Publish poll</button>
      </section>
      <section className="grid grid-cols-2 gap-3">
        <button onClick={() => store.setOpen(!poll.open)} className="rounded-xl bg-zinc-800 py-3">{poll.open ? "Close voting" : "Reopen voting"}</button>
        <button onClick={() => confirm("Reset all votes?") && store.resetVotes(poll.round)} className="rounded-xl bg-zinc-800 py-3 text-red-300">Reset votes</button>
      </section>
      <section><h2 className="mb-3 text-lg font-semibold">Live results</h2><Results poll={poll} /></section>
    </div>
  );
}

export default function App() {
  const poll = usePoll();
  const [path, go] = usePath();
  if (!poll) return <p className="p-8 text-center text-zinc-400">Loading…</p>;
  const screen = path.startsWith("/results");
  return (
    <main className={`mx-auto min-h-screen px-5 py-8 ${screen ? "max-w-4xl" : "max-w-xl"}`}>
      {!usingFirebase && <p className="mb-4 rounded-lg bg-amber-900/40 px-3 py-2 text-sm text-amber-200">Demo mode: Firebase isn't configured, votes stay on this device. See README.</p>}
      <header className="mb-8">
        <h1 className={`font-bold leading-tight ${screen ? "text-5xl" : "text-3xl"}`}>{poll.question}</h1>
        <p className="mt-2 text-sm text-zinc-500">{poll.open ? "● Voting open" : "Voting closed"}</p>
      </header>
      {path.startsWith("/admin") ? <Admin poll={poll} /> : screen ? <Results poll={poll} /> : <Vote poll={poll} />}
      <nav className="mt-10 flex gap-4 text-sm text-zinc-600">
        <a href="/" onClick={(e) => { e.preventDefault(); go("/"); }}>Vote</a>
        <a href="/results" onClick={(e) => { e.preventDefault(); go("/results"); }}>Results screen</a>
        <a href="/admin" onClick={(e) => { e.preventDefault(); go("/admin"); }}>Admin</a>
      </nav>
    </main>
  );
}
