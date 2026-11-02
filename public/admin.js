(() => {
  const app = document.getElementById("app");
  const api = async (path, opts = {}) => {
    const r = await fetch("/api/admin/" + path, { ...opts, headers: { "x-requested-with": "fetch", ...(opts.headers || {}) } });
    if (r.status === 401 && path !== "login") { loginScreen(); throw new Error("auth"); }
    return r;
  };
  const send = (path, method, body) => api(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const msg = (el, text, ok) => { el.textContent = text; el.className = ok ? "ok" : "err"; };

  // Resize an image in the browser so uploads stay small (max 900px, JPEG).
  async function shrink(file, max = 900) {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((res) => c.toBlob(res, "image/jpeg", 0.85));
  }
  async function upload(path, file, out) {
    try {
      const blob = await shrink(file);
      const r = await api(path, { method: "PUT", headers: { "content-type": blob.type }, body: blob });
      const d = await r.json();
      msg(out, r.ok ? "Imagen guardada" : d.message, r.ok);
      if (r.ok) load();
    } catch (e) { if (e.message !== "auth") msg(out, "No se pudo subir la imagen", false); }
  }

  function loginScreen() {
    const out = h("p", { role: "alert" });
    const pw = h("input", { type: "password", id: "pw", autocomplete: "current-password" });
    const form = h("form", { onsubmit: async (e) => {
      e.preventDefault();
      const r = await send("login", "POST", { password: pw.value });
      if (r.ok) load(); else msg(out, (await r.json()).message, false);
    } }, h("label", { for: "pw" }, "Contraseña de administrador"), pw, h("button", { class: "btn", type: "submit" }, "Entrar"), out);
    app.replaceChildren(h("h1", {}, "Administración"), h("section", { class: "panel" }, form));
  }

  async function load() {
    let st;
    try {
      const me = await (await fetch("/api/admin/me")).json();
      if (!me.admin) return loginScreen();
      const r = await api("state");
      if (!r.ok) return loginScreen();
      st = await r.json();
    } catch { return; }
    dashboard(st);
  }

  function dashboard({ settings: s, results, codes }) {
    const n = (id) => document.getElementById(id);
    // ---- event settings
    const sOut = h("p", { role: "status" });
    const evName = h("input", { id: "evn", value: s.event_name, maxlength: "80" });
    const tag = h("input", { id: "tag", value: s.tagline, maxlength: "160" });
    const mode = h("select", { id: "mode" }, [["private", "Privados (solo administrador)"], ["after_close", "Públicos al cerrar la votación"], ["public", "Públicos durante la votación"]].map(([v, l]) => h("option", { value: v, selected: v === s.results_mode }, l)));
    const cmode = h("select", { id: "cmode" }, [["required", "Código único obligatorio (recomendado)"], ["open", "Sin código (cualquiera con el enlace; sin control de duplicados)"]].map(([v, l]) => h("option", { value: v, selected: v === s.code_mode }, l)));
    const logoIn = h("input", { type: "file", accept: "image/*", id: "logo", onchange: (e) => e.target.files[0] && upload("logo", e.target.files[0], sOut) });
    const settingsPanel = h("section", { class: "panel" }, h("h2", {}, "Evento"),
      h("label", { for: "evn" }, "Nombre del evento"), evName, h("label", { for: "tag" }, "Descripción corta"), tag,
      h("label", { for: "mode" }, "Resultados"), mode, h("label", { for: "cmode" }, "Control de votos"), cmode,
      h("label", { for: "logo" }, "Logo (opcional)"), logoIn,
      h("button", { class: "btn", type: "button", onclick: async () => {
        const r = await send("settings", "PUT", { event_name: evName.value, tagline: tag.value, results_mode: mode.value, code_mode: cmode.value });
        msg(sOut, r.ok ? "Guardado" : (await r.json()).message, r.ok);
      } }, "Guardar ajustes"), sOut);

    // ---- voting toggle
    const vOut = h("p", { role: "status" });
    const votingPanel = h("section", { class: "panel" }, h("h2", {}, "Votación"),
      h("p", {}, "Estado: ", h("strong", { class: s.voting_open ? "ok" : "err" }, s.voting_open ? "ABIERTA" : "CERRADA"), ` · ${results.ballots} papeletas recibidas`),
      h("button", { class: "btn", type: "button", onclick: async () => { await send("voting", "POST", { open: !s.voting_open }); load(); } }, s.voting_open ? "Cerrar votación" : "Abrir votación"), vOut);

    // ---- categories & candidates
    const ccPanel = h("section", { class: "panel" }, h("h2", {}, "Categorías y candidatos"), results.categories.map((c) => {
      const cOut = h("p", { role: "status" });
      const cname = h("input", { value: c.name, maxlength: "80", "aria-label": "Nombre de la categoría" });
      return h("div", {}, h("label", {}, "Categoría"), h("div", { class: "flex" }, cname,
        h("button", { class: "btn small", type: "button", onclick: async () => { const r = await send("categories/" + c.id, "PUT", { name: cname.value }); msg(cOut, r.ok ? "Guardado" : (await r.json()).message, r.ok); } }, "Guardar")), cOut,
        c.candidates.map((k) => {
          const kOut = h("p", { role: "status" });
          const name = h("input", { value: k.name, maxlength: "80", "aria-label": "Nombre del candidato" });
          const desc = h("textarea", { rows: "2", maxlength: "280", "aria-label": "Descripción" }, "");
          desc.value = ""; // filled below from public data
          const pv = k.photo ? h("img", { class: "pv", src: k.photo, alt: "" }) : h("div", { class: "pv" });
          fetch("/api/event").then((r) => r.json()).then((ev) => { const kk = ev.categories.flatMap((x) => x.candidates).find((x) => x.id === k.id); if (kk) desc.value = kk.description; });
          return h("div", { class: "cedit" }, pv,
            h("label", {}, "Nombre"), name, h("label", {}, "Descripción"), desc,
            h("label", {}, "Foto"), h("input", { type: "file", accept: "image/*", onchange: (e) => e.target.files[0] && upload("candidates/" + k.id + "/photo", e.target.files[0], kOut) }),
            h("button", { class: "btn small", type: "button", onclick: async () => { const r = await send("candidates/" + k.id, "PUT", { name: name.value, description: desc.value }); msg(kOut, r.ok ? "Guardado" : (await r.json()).message, r.ok); } }, "Guardar candidato"), kOut);
        }));
    }));

    // ---- results
    const resPanel = h("section", {}, h("h2", {}, "Resultados"), renderResults(results), h("a", { class: "btn small", href: "/api/admin/export.csv" }, "Descargar CSV de resultados"));

    // ---- codes
    const cc = h("input", { type: "number", min: "1", max: "200", value: "50", id: "cc", "aria-label": "Cantidad de códigos" });
    const codeOut = h("p", { role: "status" });
    const codesPanel = h("section", { class: "panel" }, h("h2", {}, "Códigos de votación"),
      h("p", {}, `${codes.total} creados · ${codes.used} usados · ${codes.total - codes.used} disponibles`),
      h("label", { for: "cc" }, "Generar códigos nuevos (máx. 200 por vez)"), h("div", { class: "flex" }, cc,
        h("button", { class: "btn small", type: "button", onclick: async () => { const r = await send("codes", "POST", { count: Number(cc.value) }); const d = await r.json(); if (r.ok) load(); else msg(codeOut, d.message, false); } }, "Generar")),
      h("p", {}, h("a", { href: "/api/admin/codes.csv" }, "Descargar códigos y enlaces (CSV)")), codeOut,
      h("p", { class: "hint" }, "Reparte un código distinto a cada asistente (o su enlace/QR personal). Cada código sirve una sola vez."));

    // ---- danger zone
    const rIn = h("input", { id: "rst", placeholder: "REINICIAR", autocomplete: "off" });
    const rOut = h("p", { role: "status" });
    const dangerPanel = h("section", { class: "panel" }, h("h2", {}, "Zona de peligro"),
      h("p", {}, "Borra todos los votos y libera los códigos usados. No se puede deshacer."),
      h("label", { for: "rst" }, 'Escribe REINICIAR para confirmar'), rIn,
      h("button", { class: "btn danger", type: "button", onclick: async () => { const r = await send("reset", "POST", { confirm: rIn.value }); if (r.ok) load(); else msg(rOut, (await r.json()).message, false); } }, "Reiniciar votación"), rOut);

    const top = h("nav", { class: "top" }, h("h1", {}, "Administración"),
      h("button", { class: "btn small ghost", type: "button", onclick: async () => { await send("logout", "POST", {}); loginScreen(); } }, "Salir"));
    app.replaceChildren(top, h("p", {}, h("a", { href: "/" }, "Ver página de votación"), " · ", h("a", { href: "/results.html" }, "Página pública de resultados")),
      votingPanel, resPanel, settingsPanel, ccPanel, codesPanel, dangerPanel);
  }
  load();
})();
