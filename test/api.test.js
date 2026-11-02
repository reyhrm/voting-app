// Integration tests: run against a live `wrangler dev` (local D1). Start it first:
//   npx wrangler d1 migrations apply event-vote-db --local && npx wrangler dev --port 8799
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const BASE = process.env.BASE || "http://localhost:8799";
const PASS = process.env.ADMIN_PASSWORD || "test-admin-pass";
let cookie = "";

const call = async (path, { method = "GET", body, admin = false, headers = {}, raw } = {}) => {
  const h = { ...headers };
  if (body !== undefined && !raw) h["content-type"] = "application/json";
  if (admin) { h.cookie = cookie; h["x-requested-with"] = "fetch"; }
  const r = await fetch(BASE + path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
};
const adminGet = (p) => call(p, { admin: true });
const adminSend = (p, method, body) => call(p, { method, body, admin: true });
const vote = (code, choices, id = randomUUID()) => call("/api/vote", { method: "POST", body: { code, submission_id: id, choices } });
const genCodes = async (n) => {
  await adminSend("/api/admin/codes", "POST", { count: n });
  const csv = (await adminGet("/api/admin/codes.csv")).text;
  return csv.split("\r\n").slice(1).filter((l) => l.includes("disponible")).map((l) => l.split(",")[0].replace("-", ""));
};
const tally = async () => (await adminGet("/api/admin/state")).json.results;

test("login: wrong password rejected, right password sets HttpOnly cookie", async () => {
  const bad = await call("/api/admin/login", { method: "POST", body: { password: "nope" } });
  assert.equal(bad.status, 401);
  const ok = await call("/api/admin/login", { method: "POST", body: { password: PASS } });
  assert.equal(ok.status, 200);
  const sc = ok.headers.get("set-cookie");
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
  cookie = sc.split(";")[0];
});

test("unauthorised users cannot use any admin endpoint", async () => {
  const targets = [["GET", "/api/admin/state"], ["PUT", "/api/admin/settings"], ["POST", "/api/admin/voting"], ["POST", "/api/admin/reset"],
    ["POST", "/api/admin/codes"], ["GET", "/api/admin/export.csv"], ["GET", "/api/admin/codes.csv"], ["PUT", "/api/admin/candidates/1"], ["PUT", "/api/admin/categories/1"], ["PUT", "/api/admin/candidates/1/photo"], ["PUT", "/api/admin/logo"]];
  for (const [m, p] of targets) {
    const r = await call(p, { method: m, body: m === "GET" ? undefined : {}, headers: { "x-requested-with": "fetch" } });
    assert.equal(r.status, 401, `${m} ${p}`);
  }
  const forged = await call("/api/admin/state", { headers: { cookie: "admin_session=9999999999999.deadbeef" } });
  assert.equal(forged.status, 401);
});

test("admin mutations need the CSRF header even with a valid cookie", async () => {
  const r = await call("/api/admin/voting", { method: "POST", body: { open: true }, headers: { cookie } });
  assert.equal(r.status, 403);
});

test("public event data shows both categories and all four candidates", async () => {
  const r = await call("/api/event");
  assert.equal(r.status, 200);
  assert.equal(r.json.categories.length, 2);
  for (const c of r.json.categories) assert.equal(c.candidates.length, 2);
  assert.equal(r.json.categories.flatMap((c) => c.candidates).length, 4);
  assert.ok(!("results" in r.json));
});

test("voting is closed by default and rejects votes", async () => {
  await adminSend("/api/admin/voting", "POST", { open: false });
  const [code] = await genCodes(1);
  const r = await vote(code, { 1: 1, 2: 3 });
  assert.equal(r.status, 403); assert.equal(r.json.error, "closed");
  assert.equal((await tally()).ballots, 0);
});

test("admin can edit event, categories, candidates (persisted)", async () => {
  let r = await adminSend("/api/admin/settings", "PUT", { event_name: "Gala 2026", tagline: "Elige", results_mode: "private", code_mode: "required" });
  assert.equal(r.status, 200);
  assert.equal((await adminSend("/api/admin/categories/1", "PUT", { name: "Mejor Disfraz" })).status, 200);
  assert.equal((await adminSend("/api/admin/categories/2", "PUT", { name: "Mejor Look" })).status, 200);
  const names = [["Ana", "Ella"], ["Beto", "Él"], ["Carla", "Ella"], ["Dani", "Él"]];
  for (let i = 0; i < 4; i++) assert.equal((await adminSend(`/api/admin/candidates/${i + 1}`, "PUT", { name: names[i][0], description: names[i][1] })).status, 200);
  const ev = (await call("/api/event")).json;
  assert.equal(ev.event_name, "Gala 2026"); assert.equal(ev.categories[0].name, "Mejor Disfraz");
  assert.equal(ev.categories[1].candidates[1].name, "Dani");
  assert.equal((await adminSend("/api/admin/categories/1", "PUT", { name: "  " })).status, 400);
});

test("photo upload: valid PNG accepted, wrong type and oversize rejected", async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const up = (body) => call("/api/admin/candidates/1/photo", { method: "PUT", admin: true, raw: body, headers: { "content-type": "image/png" } });
  assert.equal((await up(png)).status, 200);
  const photo = (await call("/api/event")).json.categories[0].candidates[0].photo;
  assert.ok(photo);
  const img = await fetch(BASE + photo);
  assert.equal(img.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), png);
  assert.equal((await up(Buffer.from("<svg onload=alert(1)>"))).status, 415);
  assert.equal((await up(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(401 * 1024)]))).status, 413);
});

test("open voting: valid vote is stored; results private for public", async () => {
  await adminSend("/api/admin/voting", "POST", { open: true });
  const [code] = await genCodes(1);
  const r = await vote(code, { 1: 1, 2: 4 });
  assert.equal(r.status, 200);
  const res = await tally();
  assert.equal(res.ballots, 1);
  assert.equal(res.categories[0].candidates[0].votes, 1);
  assert.equal(res.categories[1].candidates[1].votes, 1);
  assert.equal(res.categories[0].candidates[0].percent, 100);
  assert.equal(res.categories[0].winner, null, "no winner while voting is open");
  assert.equal((await call("/api/results")).status, 403, "private results blocked");
  assert.ok(!(await call("/api/event")).text.includes('"votes"'));
});

test("duplicate: same code cannot vote twice; retry with same submission id is idempotent", async () => {
  const [code] = await genCodes(1);
  const id = randomUUID();
  const before = (await tally()).ballots;
  assert.equal((await vote(code, { 1: 2, 2: 3 }, id)).status, 200);
  const retry = await vote(code, { 1: 2, 2: 3 }, id);          // lost-response retry
  assert.equal(retry.status, 200); assert.equal(retry.json.already_recorded, true);
  const again = await vote(code, { 1: 1, 2: 4 });              // new submission, same code
  assert.equal(again.status, 409); assert.equal(again.json.error, "code_used");
  assert.equal((await tally()).ballots, before + 1);
});

test("invalid inputs rejected: bad code, missing/foreign candidate, junk body", async () => {
  const [code] = await genCodes(1);
  assert.equal((await vote("ZZZZZZZZ", { 1: 1, 2: 3 })).json.error, "invalid_code");
  assert.equal((await vote(code, { 1: 1 })).status, 400);
  assert.equal((await vote(code, { 1: 3, 2: 4 })).status, 400, "candidate from the wrong category");
  assert.equal((await vote(code, { 1: 1, 2: 3, 3: 1 })).status, 400, "extra category");
  assert.equal((await vote(code, { 1: "1; DROP TABLE votes", 2: 3 })).status, 400);
  assert.equal((await call("/api/vote", { method: "POST", raw: "{not json", headers: { "content-type": "application/json" } })).status, 400);
  assert.equal((await vote("", { 1: 1, 2: 3 })).json.error, "code_required");
  const still = await vote(code, { 1: 1, 2: 3 });               // code was not burned by the failed attempts
  assert.equal(still.status, 200);
});

test("concurrency: 25 parallel submissions with ONE code record exactly one ballot", async () => {
  const [code] = await genCodes(1);
  const before = (await tally()).ballots;
  const rs = await Promise.all(Array.from({ length: 25 }, (_, i) => vote(code, { 1: 1 + (i % 2), 2: 3 + (i % 2) })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1);
  assert.equal(rs.filter((r) => r.status === 409).length, 24);
  const res = await tally();
  assert.equal(res.ballots, before + 1);
  const total = res.categories.map((c) => c.total);
  assert.equal(total[0], total[1], "each ballot counted once per category");
});

test("concurrency: 25 parallel RETRIES of one submission id record exactly one ballot", async () => {
  const [code] = await genCodes(1);
  const id = randomUUID(); const before = (await tally()).ballots;
  const rs = await Promise.all(Array.from({ length: 25 }, () => vote(code, { 1: 1, 2: 3 }, id)));
  assert.ok(rs.every((r) => r.status === 200), JSON.stringify(rs.map((r) => r.status)));
  assert.equal((await tally()).ballots, before + 1);
});

test("concurrency: 40 different codes voting at once are all counted", async () => {
  const codes = await genCodes(40); const before = (await tally()).ballots;
  const rs = await Promise.all(codes.slice(0, 40).map((c, i) => vote(c, { 1: 1 + (i % 2), 2: 3 + (i % 2) })));
  assert.ok(rs.every((r) => r.status === 200));
  assert.equal((await tally()).ballots, before + 40);
});

test("closing voting rejects new votes; winner appears; after_close results become public", async () => {
  const [code] = await genCodes(1);
  await adminSend("/api/admin/settings", "PUT", { event_name: "Gala 2026", tagline: "", results_mode: "after_close", code_mode: "required" });
  assert.equal((await call("/api/results")).status, 403, "still open => hidden");
  await adminSend("/api/admin/voting", "POST", { open: false });
  assert.equal((await vote(code, { 1: 1, 2: 3 })).json.error, "closed");
  const pub = await call("/api/results");
  assert.equal(pub.status, 200);
  const priv = await tally();
  assert.deepEqual(pub.json.categories.map((c) => c.candidates.map((k) => k.votes)), priv.categories.map((c) => c.candidates.map((k) => k.votes)));
  for (const c of pub.json.categories) {
    const sum = c.candidates.reduce((s, k) => s + k.votes, 0);
    assert.equal(sum, c.total);
    if (!c.tie) assert.ok(c.winner); 
  }
});

test("public mode shows results during voting; zero-vote categories give 0%", async () => {
  await adminSend("/api/admin/settings", "PUT", { event_name: "Gala 2026", tagline: "", results_mode: "public", code_mode: "required" });
  assert.equal((await call("/api/results")).status, 200);
  await adminSend("/api/admin/reset", "POST", { confirm: "REINICIAR" });
  const r = (await call("/api/results")).json;
  for (const c of r.categories) { assert.equal(c.total, 0); assert.ok(c.candidates.every((k) => k.percent === 0)); assert.equal(c.winner, null); }
});

test("reset needs explicit confirmation, clears votes and frees codes; data persists across requests", async () => {
  await adminSend("/api/admin/voting", "POST", { open: true });
  const [code] = await genCodes(1);
  assert.equal((await vote(code, { 1: 1, 2: 3 })).status, 200);
  assert.equal((await adminSend("/api/admin/reset", "POST", {})).status, 400);
  assert.equal((await adminSend("/api/admin/reset", "POST", { confirm: "no" })).status, 400);
  assert.equal((await tally()).ballots, 1);
  assert.equal((await adminSend("/api/admin/reset", "POST", { confirm: "REINICIAR" })).status, 200);
  assert.equal((await tally()).ballots, 0);
  assert.equal((await vote(code, { 1: 2, 2: 4 })).status, 200, "code usable again after reset");
});

test("CSV export: correct numbers, BOM, formula injection neutralised", async () => {
  await adminSend("/api/admin/candidates/2", "PUT", { name: '=HYPERLINK("http://x")', description: "x" });
  const csv = await adminGet("/api/admin/export.csv");
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  const raw = new Uint8Array(await (await fetch(BASE + "/api/admin/export.csv", { headers: { cookie } })).arrayBuffer());
  assert.deepEqual([...raw.slice(0, 3)], [0xef, 0xbb, 0xbf], "UTF-8 BOM so Excel shows accents");
  assert.ok(csv.text.startsWith("categoria,candidato,votos,porcentaje,ganador"));
  assert.ok(csv.text.includes(`"'=HYPERLINK(""http://x"")"`));
  const lines = csv.text.trim().split("\r\n");
  assert.equal(lines.length, 5);
  const res = await tally();
  const row = lines.find((l) => l.startsWith("Mejor Disfraz,Ana"));
  assert.ok(row.startsWith(`Mejor Disfraz,Ana,${res.categories[0].candidates[0].votes},`));
});

test("no-code (open) mode accepts votes without a code, still idempotent", async () => {
  await adminSend("/api/admin/settings", "PUT", { event_name: "Gala 2026", tagline: "", results_mode: "private", code_mode: "open" });
  const id = randomUUID(); const before = (await tally()).ballots;
  assert.equal((await vote("", { 1: 1, 2: 3 }, id)).status, 200);
  assert.equal((await vote("", { 1: 1, 2: 3 }, id)).json.already_recorded, true);
  assert.equal((await tally()).ballots, before + 1);
  await adminSend("/api/admin/settings", "PUT", { event_name: "Gala 2026", tagline: "", results_mode: "private", code_mode: "required" });
});

test("security headers present on pages; errors do not leak internals", async () => {
  const page = await fetch(BASE + "/");
  assert.match(page.headers.get("content-security-policy") || "", /default-src 'self'/);
  const bad = await call("/api/nope");
  assert.equal(bad.status, 404); assert.ok(!/stack|at \w+/.test(bad.text));
  const admin = await fetch(BASE + "/admin.html");
  assert.equal(admin.headers.get("cache-control"), "no-store");
});

test("login is rate limited", async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await call("/api/admin/login", { method: "POST", body: { password: "wrong" + i } });
  assert.equal(last.status, 429);
});
