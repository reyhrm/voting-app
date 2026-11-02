// Browser smoke test (needs Playwright + a running `wrangler dev` on :8799). Not part of `npm test`.
const { chromium, devices } = require("playwright");
const BASE = process.env.BASE || "http://localhost:8799";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  const log = []; const bad = [];
  const watch = (p) => { p.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); }); p.on("pageerror", (e) => bad.push(e.message)); };

  // --- admin (desktop): login, open voting, generate codes, upload photo
  const actx = await b.newContext(); const ap = await actx.newPage(); watch(ap);
  await ap.goto(BASE + "/admin.html");
  await ap.fill("#pw", "wrong"); await ap.click("text=Entrar"); await ap.waitForSelector("text=incorrecta"); log.push("admin wrong password rejected");
  await ap.fill("#pw", "test-admin-pass"); await ap.click("text=Entrar"); await ap.waitForSelector("text=Zona de peligro"); log.push("admin login ok");
  await ap.click("text=Abrir votación"); await ap.waitForSelector("text=ABIERTA"); log.push("voting opened");
  await ap.fill("#cc", "3"); await ap.click("button:has-text('Generar')"); await ap.waitForSelector("text=3 creados"); log.push("codes generated");
  const csv = await ap.evaluate(async () => (await fetch("/api/admin/codes.csv")).text());
  const codes = csv.trim().split("\r\n").slice(1).map((l) => l.split(",")[0]);
  // photo upload through the UI (generated JPEG)
  const jpg = await ap.evaluate(async () => { const c = document.createElement("canvas"); c.width = 1600; c.height = 1200; const x = c.getContext("2d"); x.fillStyle = "#c33"; x.fillRect(0, 0, 1600, 1200); return await new Promise((r) => c.toBlob(async (bl) => r([...new Uint8Array(await bl.arrayBuffer())]), "image/jpeg", 0.95)); });
  require("fs").writeFileSync("/tmp/p.jpg", Buffer.from(jpg));
  await ap.locator("input[type=file]").nth(1).setInputFiles("/tmp/p.jpg"); await ap.waitForSelector("text=Imagen guardada"); log.push("photo uploaded via UI (resized in browser)");

  // --- voter (iPhone-size)
  const ctx = await b.newContext({ ...devices["iPhone 13"] }); const p = await ctx.newPage(); watch(p);
  await p.goto(BASE + "/?c=" + codes[0].replace("-", ""));
  await p.waitForSelector(".cand");
  log.push("cards visible: " + await p.locator(".cand").count() + ", categories: " + await p.locator("h2").count());
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth); log.push("horizontal overflow on phone: " + overflow);
  const blocked = await p.locator("text=Revisar mi voto").getAttribute("aria-disabled"); log.push("review disabled before choosing: " + blocked);
  await p.locator(".cand").nth(0).click(); await p.locator(".cand").nth(3).click();
  await p.locator(".cand").nth(1).click(); // change mind in category 1
  await p.click("text=Revisar mi voto"); await p.waitForSelector("text=Confirma tu voto");
  log.push("review shows: " + (await p.locator(".sum").allInnerTexts()).join(" | ").replace(/\n/g, " "));
  log.push("code prefilled: " + await p.inputValue("#code"));
  await p.click("text=Cambiar selección"); await p.locator(".cand").nth(0).click(); await p.click("text=Revisar mi voto");
  await p.click("text=Enviar mis votos"); await p.waitForSelector("text=¡Voto registrado!"); log.push("success screen shown");
  await p.screenshot({ path: "/tmp/mobile-success.png" });
  // same code again from a fresh page => rejected
  const p2 = await ctx.newPage(); await p2.goto(BASE + "/?c=" + codes[0].replace("-", "")); await p2.waitForSelector(".cand");
  await p2.locator(".cand").nth(0).click(); await p2.locator(".cand").nth(2).click(); await p2.click("text=Revisar mi voto"); await p2.click("text=Enviar mis votos");
  await p2.waitForSelector("text=ya fue utilizado"); log.push("reused code rejected in UI");
  // network failure then retry: no duplicate
  const p3 = await ctx.newPage(); await p3.goto(BASE + "/?c=" + codes[1].replace("-", "")); await p3.waitForSelector(".cand");
  await p3.locator(".cand").nth(1).click(); await p3.locator(".cand").nth(3).click(); await p3.click("text=Revisar mi voto");
  let first = true;
  await p3.route("**/api/vote", async (route) => { if (first) { first = false; const r = await route.fetch(); await route.abort("failed"); /* server recorded it, response lost */ } else await route.continue(); });
  await p3.click("text=Enviar mis votos"); await p3.waitForSelector("text=No hay conexión"); log.push("network failure message shown (server DID record the vote)");
  await p3.click("text=Enviar mis votos"); await p3.waitForSelector("text=¡Voto registrado!"); log.push("retry succeeded");
  await sleep(200);
  const state = await ap.evaluate(async () => (await (await fetch("/api/admin/state")).json()).results);
  log.push("ballots in DB (expected 2): " + state.ballots + " | totals " + state.categories.map((c) => c.total));

  // results hidden while open (after_close mode)
  const rp = await ctx.newPage(); await rp.goto(BASE + "/results.html"); await rp.waitForSelector("text=aún no están disponibles"); log.push("public results hidden while voting open");
  await ap.reload(); await ap.waitForSelector("text=Zona de peligro");
  await ap.click("text=Cerrar votación"); await ap.waitForSelector("text=CERRADA");
  await rp.reload(); await rp.waitForSelector("text=Ganador"); log.push("results public + winner shown after close");
  await rp.screenshot({ path: "/tmp/mobile-results.png", fullPage: true });
  const closed = await ctx.newPage(); await closed.goto(BASE + "/"); await closed.waitForSelector("text=La votación está cerrada"); log.push("home shows closed message");
  await ap.screenshot({ path: "/tmp/admin.png", fullPage: true });
  console.log(log.join("\n")); console.log("console/page errors (incl. CSP):", bad.length ? bad : "none");
  await b.close();
})().catch((e) => { console.error("E2E FAILED", e.message); process.exit(1); });
