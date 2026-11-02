// Event voting API: Cloudflare Worker + D1. Static files are served by the assets binding.

import { SCHEMA } from "./schema.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const MAX_PHOTO = 400 * 1024;
const MAX_LOGO = 250 * 1024;
const enc = new TextEncoder();

class HttpError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra },
  });

const clean = (v, max) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";

// ---------- schema bootstrap ----------
// Creates the tables on first use (idempotent), so a fresh database just works.
let schemaReady = null;
function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = (async () => {
      const has = await env.DB.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'settings'").first();
      if (!has) await env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q)));
    })().catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

// ---------- crypto helpers ----------
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Constant-time comparison (compares fixed-length HMACs of both inputs).
async function safeEqual(a, b) {
  const [x, y] = await Promise.all([hmacHex("cmp", String(a)), hmacHex("cmp", String(b))]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
const sha = async (s) => hmacHex("ip", s);

// ---------- sessions ----------
const SESSION_MS = 8 * 3600 * 1000;
const cookieName = "admin_session";
async function makeSession(env) {
  const exp = Date.now() + SESSION_MS;
  return `${exp}.${await hmacHex(env.SESSION_SECRET, String(exp))}`;
}
async function isAdmin(request, env) {
  if (!env.SESSION_SECRET) return false;
  const raw = (request.headers.get("cookie") || "").split(/;\s*/).find((c) => c.startsWith(cookieName + "="));
  if (!raw) return false;
  const val = raw.slice(cookieName.length + 1);
  const [exp, sig] = val.split(".");
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return safeEqual(sig, await hmacHex(env.SESSION_SECRET, exp));
}
async function requireAdmin(request, env) {
  if (!(await isAdmin(request, env))) throw new HttpError(401, "unauthorized", "No autorizado");
  if (request.method !== "GET") {
    // CSRF defence in depth (cookie is also SameSite=Strict): require a custom header.
    if (request.headers.get("x-requested-with") !== "fetch") throw new HttpError(403, "csrf", "Solicitud no válida");
  }
}

// ---------- rate limit (D1-backed fixed window) ----------
async function rateLimit(env, request, bucket, limit, windowMs) {
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const key = `${bucket}:${(await sha(ip)).slice(0, 24)}`;
  const win = Math.floor(Date.now() / windowMs);
  const row = await env.DB.prepare(
    `INSERT INTO rate(key, window, n) VALUES (?1, ?2, 1)
     ON CONFLICT(key) DO UPDATE SET n = CASE WHEN window = excluded.window THEN n + 1 ELSE 1 END, window = excluded.window
     RETURNING n`
  ).bind(key, win).first();
  if (row.n > limit) throw new HttpError(429, "rate_limited", "Demasiados intentos. Espera un momento e inténtalo de nuevo.");
}

// ---------- data helpers ----------
async function getSettings(env) {
  return env.DB.prepare("SELECT id, event_name, tagline, voting_open, results_mode, code_mode, logo_v FROM settings WHERE id = 1").first();
}
async function getStructure(env) {
  const [cats, cands] = await Promise.all([
    env.DB.prepare("SELECT id, name FROM categories ORDER BY position").all(),
    env.DB.prepare("SELECT id, category_id, name, description, photo_v FROM candidates ORDER BY position").all(),
  ]);
  return cats.results.map((c) => ({
    id: c.id,
    name: c.name,
    candidates: cands.results
      .filter((k) => k.category_id === c.id)
      .map((k) => ({ id: k.id, name: k.name, description: k.description, photo: k.photo_v ? `/api/photo/${k.id}?v=${k.photo_v}` : null })),
  }));
}
async function computeResults(env, settings) {
  const cats = await getStructure(env);
  const counts = await env.DB.prepare("SELECT candidate_id, COUNT(*) AS n FROM votes GROUP BY candidate_id").all();
  const byCand = new Map(counts.results.map((r) => [r.candidate_id, r.n]));
  const closed = !settings.voting_open;
  const categories = cats.map((c) => {
    const total = c.candidates.reduce((s, k) => s + (byCand.get(k.id) || 0), 0);
    const cands = c.candidates.map((k) => {
      const votes = byCand.get(k.id) || 0;
      return { id: k.id, name: k.name, photo: k.photo, votes, percent: total ? Math.round((votes / total) * 1000) / 10 : 0 };
    });
    const top = Math.max(0, ...cands.map((k) => k.votes));
    const leaders = cands.filter((k) => k.votes === top && top > 0);
    return {
      id: c.id, name: c.name, total, candidates: cands,
      tie: leaders.length > 1,
      winner: closed && leaders.length === 1 ? leaders[0].id : null,
    };
  });
  const ballots = (await env.DB.prepare("SELECT COUNT(*) AS n FROM ballots").first()).n;
  return { voting_open: !!settings.voting_open, ballots, categories };
}
const resultsVisible = (s) => s.results_mode === "public" || (s.results_mode === "after_close" && !s.voting_open);

// ---------- binary uploads ----------
function sniffImage(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}
function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
async function readImage(request, max) {
  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.length) throw new HttpError(400, "empty", "Archivo vacío");
  if (buf.length > max) throw new HttpError(413, "too_large", `La imagen supera ${Math.round(max / 1024)} KB`);
  const type = sniffImage(buf);
  if (!type) throw new HttpError(415, "bad_type", "Formato no permitido (usa JPG, PNG o WebP)");
  return { b64: toBase64(buf), type };
}
async function serveImage(row, typeCol, dataCol) {
  if (!row || !row[dataCol]) return new Response("Not found", { status: 404 });
  const bin = atob(row[dataCol]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, { headers: { "content-type": row[typeCol], "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
}

// ---------- CSV ----------
const csvCell = (v) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvResponse = (rows, filename) =>
  new Response("﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n", {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" },
  });

// ---------- voting ----------
const normCode = (c) => clean(c, 40).toUpperCase().replace(/[^A-Z0-9]/g, "");
const UUID_RE = /^[0-9a-fA-F-]{16,64}$/;

async function handleVote(request, env) {
  await rateLimit(env, request, "vote", 120, 60_000);
  let body;
  try { body = await request.json(); } catch { throw new HttpError(400, "bad_json", "Solicitud no válida"); }
  const token = typeof body.submission_id === "string" ? body.submission_id : "";
  if (!UUID_RE.test(token)) throw new HttpError(400, "bad_submission", "Solicitud no válida");

  const settings = await getSettings(env);
  const cats = await env.DB.prepare("SELECT id FROM categories ORDER BY position").all();
  const cands = await env.DB.prepare("SELECT id, category_id FROM candidates").all();

  // Validate choices against the database: exactly one valid candidate per category.
  const choices = body.choices && typeof body.choices === "object" ? body.choices : {};
  const picked = [];
  for (const c of cats.results) {
    const candId = Number(choices[c.id]);
    const ok = cands.results.find((k) => k.id === candId && k.category_id === c.id);
    if (!ok) throw new HttpError(400, "bad_choice", "Debes elegir un candidato en cada categoría");
    picked.push({ category_id: c.id, candidate_id: candId });
  }
  if (Object.keys(choices).length !== picked.length) throw new HttpError(400, "bad_choice", "Selección no válida");

  const requireCode = settings.code_mode === "required";
  const code = requireCode ? normCode(body.code) : null;
  if (requireCode && !code) throw new HttpError(400, "code_required", "Introduce tu código de votación");

  // Idempotent retry: this exact submission was already recorded (e.g. response lost on a bad network).
  const existing = await env.DB.prepare("SELECT id, code FROM ballots WHERE token = ?1").bind(token).first();
  if (existing && (!requireCode || existing.code === code)) return json({ ok: true, already_recorded: true });

  const now = Date.now();
  const stmts = [];
  if (requireCode) {
    // Atomically claim the code (only if voting is open and the code is still unused)...
    stmts.push(env.DB.prepare("UPDATE codes SET used_at = ?1, token = ?2 WHERE code = ?3 AND used_at IS NULL AND (SELECT voting_open FROM settings WHERE id = 1) = 1").bind(now, token, code));
    // ...then create the ballot only for the request that now owns the code.
    stmts.push(env.DB.prepare("INSERT INTO ballots(code, token, created_at) SELECT code, token, ?1 FROM codes WHERE code = ?2 AND token = ?3").bind(now, code, token));
  } else {
    stmts.push(env.DB.prepare("INSERT INTO ballots(code, token, created_at) SELECT NULL, ?1, ?2 WHERE (SELECT voting_open FROM settings WHERE id = 1) = 1").bind(token, now));
  }
  for (const p of picked) {
    stmts.push(env.DB.prepare("INSERT INTO votes(ballot_id, category_id, candidate_id) SELECT b.id, c.category_id, c.id FROM ballots b JOIN candidates c ON c.id = ?1 AND c.category_id = ?2 WHERE b.token = ?3").bind(p.candidate_id, p.category_id, token));
  }
  try {
    await env.DB.batch(stmts); // runs as a single transaction
  } catch (e) {
    // A concurrent identical retry hits UNIQUE(token): fall through to the check below.
  }
  const done = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM votes WHERE ballot_id = b.id) AS n FROM ballots b WHERE b.token = ?1").bind(token).first();
  if (done && done.n === picked.length) return json({ ok: true });

  // Not recorded: explain why (without revealing anything sensitive).
  const fresh = await getSettings(env);
  if (!fresh.voting_open) throw new HttpError(403, "closed", "La votación está cerrada");
  if (requireCode) {
    const row = await env.DB.prepare("SELECT used_at FROM codes WHERE code = ?1").bind(code).first();
    if (!row) throw new HttpError(400, "invalid_code", "Código no válido");
    if (row.used_at) throw new HttpError(409, "code_used", "Este código ya fue utilizado");
  }
  throw new HttpError(500, "failed", "No se pudo registrar el voto. Inténtalo de nuevo.");
}

// ---------- admin ----------
async function adminState(env) {
  const settings = await getSettings(env);
  const results = await computeResults(env, settings);
  const codes = await env.DB.prepare("SELECT COUNT(*) AS total, SUM(used_at IS NOT NULL) AS used FROM codes").first();
  return { settings, results, codes: { total: codes.total, used: codes.used || 0 } };
}

async function handleAdmin(request, env, url, path) {
  const method = request.method;

  if (path === "/api/admin/login" && method === "POST") {
    await rateLimit(env, request, "login", 8, 15 * 60_000);
    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) throw new HttpError(500, "not_configured", "El servidor no está configurado");
    let body; try { body = await request.json(); } catch { throw new HttpError(400, "bad_json", "Solicitud no válida"); }
    if (!(await safeEqual(String(body.password || ""), env.ADMIN_PASSWORD))) throw new HttpError(401, "bad_password", "Contraseña incorrecta");
    const secure = url.protocol === "https:" ? "; Secure" : "";
    return json({ ok: true }, 200, { "set-cookie": `${cookieName}=${await makeSession(env)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}` });
  }
  if (path === "/api/admin/logout" && method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
  }
  if (path === "/api/admin/me" && method === "GET") return json({ admin: await isAdmin(request, env) });

  await requireAdmin(request, env);
  const readJson = async () => { try { return await request.json(); } catch { throw new HttpError(400, "bad_json", "Solicitud no válida"); } };

  if (path === "/api/admin/state" && method === "GET") return json(await adminState(env));

  if (path === "/api/admin/settings" && method === "PUT") {
    const b = await readJson();
    const name = clean(b.event_name, 80);
    if (!name) throw new HttpError(400, "invalid", "El nombre del evento es obligatorio");
    if (!["private", "after_close", "public"].includes(b.results_mode)) throw new HttpError(400, "invalid", "Modo de resultados no válido");
    if (!["required", "open"].includes(b.code_mode)) throw new HttpError(400, "invalid", "Modo de códigos no válido");
    await env.DB.prepare("UPDATE settings SET event_name = ?1, tagline = ?2, results_mode = ?3, code_mode = ?4 WHERE id = 1")
      .bind(name, clean(b.tagline, 160), b.results_mode, b.code_mode).run();
    return json({ ok: true });
  }
  let m;
  if ((m = path.match(/^\/api\/admin\/categories\/(\d+)$/)) && method === "PUT") {
    const name = clean((await readJson()).name, 80);
    if (!name) throw new HttpError(400, "invalid", "El nombre es obligatorio");
    const r = await env.DB.prepare("UPDATE categories SET name = ?1 WHERE id = ?2").bind(name, Number(m[1])).run();
    if (!r.meta.changes) throw new HttpError(404, "not_found", "No encontrado");
    return json({ ok: true });
  }
  if ((m = path.match(/^\/api\/admin\/candidates\/(\d+)$/)) && method === "PUT") {
    const b = await readJson();
    const name = clean(b.name, 80);
    if (!name) throw new HttpError(400, "invalid", "El nombre es obligatorio");
    const r = await env.DB.prepare("UPDATE candidates SET name = ?1, description = ?2 WHERE id = ?3").bind(name, clean(b.description, 280), Number(m[1])).run();
    if (!r.meta.changes) throw new HttpError(404, "not_found", "No encontrado");
    return json({ ok: true });
  }
  if ((m = path.match(/^\/api\/admin\/candidates\/(\d+)\/photo$/)) && method === "PUT") {
    const { b64, type } = await readImage(request, MAX_PHOTO);
    const r = await env.DB.prepare("UPDATE candidates SET photo = ?1, photo_type = ?2, photo_v = ?3 WHERE id = ?4").bind(b64, type, Date.now(), Number(m[1])).run();
    if (!r.meta.changes) throw new HttpError(404, "not_found", "No encontrado");
    return json({ ok: true });
  }
  if (path === "/api/admin/logo" && method === "PUT") {
    const { b64, type } = await readImage(request, MAX_LOGO);
    await env.DB.prepare("UPDATE settings SET logo = ?1, logo_type = ?2, logo_v = ?3 WHERE id = 1").bind(b64, type, Date.now()).run();
    return json({ ok: true });
  }
  if (path === "/api/admin/voting" && method === "POST") {
    const b = await readJson();
    await env.DB.prepare("UPDATE settings SET voting_open = ?1 WHERE id = 1").bind(b.open ? 1 : 0).run();
    return json({ ok: true });
  }
  if (path === "/api/admin/codes" && method === "POST") {
    const count = Math.floor(Number((await readJson()).count));
    if (!(count >= 1 && count <= 200)) throw new HttpError(400, "invalid", "Genera entre 1 y 200 códigos por vez");
    const now = Date.now();
    const made = new Set();
    while (made.size < count) {
      const bytes = crypto.getRandomValues(new Uint8Array(8));
      made.add([...bytes].map((x) => CODE_ALPHABET[x % 32]).join(""));
    }
    const list = [...made];
    const stmts = [];
    for (let i = 0; i < list.length; i += 80) {
      const chunk = list.slice(i, i + 80);
      stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO codes(code, created_at) VALUES ${chunk.map(() => `(?, ${now})`).join(",")}`).bind(...chunk));
    }
    await env.DB.batch(stmts);
    return json({ ok: true, created: list.length });
  }
  if (path === "/api/admin/codes.csv" && method === "GET") {
    const rows = await env.DB.prepare("SELECT code, used_at FROM codes ORDER BY created_at, code").all();
    return csvResponse(
      [["codigo", "enlace", "estado"], ...rows.results.map((r) => [`${r.code.slice(0, 4)}-${r.code.slice(4)}`, `${url.origin}/?c=${r.code}`, r.used_at ? "usado" : "disponible"])],
      "codigos.csv"
    );
  }
  if (path === "/api/admin/export.csv" && method === "GET") {
    const res = await computeResults(env, await getSettings(env));
    const rows = [["categoria", "candidato", "votos", "porcentaje", "ganador"]];
    for (const c of res.categories) for (const k of c.candidates) rows.push([c.name, k.name, k.votes, `${k.percent}%`, c.winner === k.id ? "si" : ""]);
    return csvResponse(rows, "resultados.csv");
  }
  if (path === "/api/admin/reset" && method === "POST") {
    if ((await readJson()).confirm !== "REINICIAR") throw new HttpError(400, "confirm", 'Escribe "REINICIAR" para confirmar');
    await env.DB.batch([
      env.DB.prepare("DELETE FROM votes"),
      env.DB.prepare("DELETE FROM ballots"),
      env.DB.prepare("UPDATE codes SET used_at = NULL, token = NULL"),
    ]);
    return json({ ok: true });
  }
  throw new HttpError(404, "not_found", "No encontrado");
}

// ---------- router ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
      await ensureSchema(env);

      if (path.startsWith("/api/admin/")) return await handleAdmin(request, env, url, path);

      if (path === "/api/event" && request.method === "GET") {
        const s = await getSettings(env);
        return json({
          event_name: s.event_name, tagline: s.tagline, voting_open: !!s.voting_open,
          code_required: s.code_mode === "required",
          logo: s.logo_v ? `/api/logo?v=${s.logo_v}` : null,
          results_visible: resultsVisible(s),
          categories: await getStructure(env),
        });
      }
      if (path === "/api/results" && request.method === "GET") {
        const s = await getSettings(env);
        if (!resultsVisible(s)) throw new HttpError(403, "private", "Los resultados aún no están disponibles");
        return json(await computeResults(env, s));
      }
      if (path === "/api/vote" && request.method === "POST") return await handleVote(request, env);

      let m;
      if ((m = path.match(/^\/api\/photo\/(\d+)$/)) && request.method === "GET")
        return serveImage(await env.DB.prepare("SELECT photo, photo_type FROM candidates WHERE id = ?1").bind(Number(m[1])).first(), "photo_type", "photo");
      if (path === "/api/logo" && request.method === "GET")
        return serveImage(await env.DB.prepare("SELECT logo, logo_type FROM settings WHERE id = 1").first(), "logo_type", "logo");

      throw new HttpError(404, "not_found", "No encontrado");
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
      console.error("unhandled", e && e.stack ? e.stack : e); // details stay in server logs only
      return json({ error: "server_error", message: "Error del servidor. Inténtalo de nuevo." }, 500);
    }
  },
};
