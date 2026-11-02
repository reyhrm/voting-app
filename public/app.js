(() => {
  const app = document.getElementById("app");
  const state = { ev: null, choice: {}, code: "", busy: false, submissionId: null };

  const initials = (n) => n.split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase();
  const photo = (k, cls = "ph") => k.photo ? h("img", { class: cls, src: k.photo, alt: "", loading: "lazy" }) : h("div", { class: cls + " none", "aria-hidden": "true" }, initials(k.name));
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join(""));

  function header() {
    const ev = state.ev;
    document.title = ev.event_name;
    return h("header", { class: "hero" },
      ev.logo ? h("img", { src: ev.logo, alt: "" }) : null,
      h("h1", {}, ev.event_name),
      ev.tagline ? h("p", { class: "tagline" }, ev.tagline) : null);
  }
  let quiet = false; // true when only the selection changed: no animation, keep scroll position
  const render = (...nodes) => {
    const y = window.scrollY;
    app.replaceChildren(h("div", { class: quiet ? "" : "fade" }, ...nodes));
    window.scrollTo(0, quiet ? y : 0);
    quiet = false;
  };

  function messageScreen(title, text, extra) {
    render(header(), h("section", { class: "panel center" }, h("h2", {}, title), h("p", {}, text)), extra);
  }

  function selectScreen() {
    const ev = state.ev;
    const ready = ev.categories.every((c) => state.choice[c.id]);
    const sections = ev.categories.map((cat) =>
      h("section", { "aria-labelledby": "cat" + cat.id },
        h("h2", { id: "cat" + cat.id }, cat.name),
        h("div", { class: "cards", role: "group", "aria-labelledby": "cat" + cat.id },
          cat.candidates.map((k) => {
            const on = state.choice[cat.id] === k.id;
            return h("button", { type: "button", class: "cand", "aria-pressed": String(on), onclick: () => { state.choice[cat.id] = k.id; quiet = true; selectScreen(); } },
              photo(k),
              h("span", { class: "body" },
                h("span", { class: "name" }, k.name),
                h("span", { class: "desc" }, k.description), 
                h("span", { class: "tag" }, on ? "✓ " + t("picked") : t("pick"))));
          }))));
    const go = h("button", { type: "button", class: "btn", "aria-disabled": String(!ready), onclick: () => ready && reviewScreen() }, t("review"));
    render(header(),
      h("section", { class: "panel" }, h("strong", {}, t("howTitle")), h("ol", {}, h("li", {}, t("how1")), h("li", {}, t("how2")), h("li", {}, t("how3")))),
      sections, go,
      ready ? null : h("p", { class: "hint" }, t("needBoth")));
  }

  function reviewScreen(error) {
    const ev = state.ev;
    const rows = ev.categories.map((cat) => {
      const k = cat.candidates.find((x) => x.id === state.choice[cat.id]);
      return h("div", { class: "sum" }, photo(k, "ph"), h("div", {}, h("small", {}, cat.name), h("strong", {}, k.name)));
    });
    const codeInput = ev.code_required ? [
      h("label", { for: "code" }, t("codeLabel")),
      h("input", { id: "code", class: "code", autocomplete: "off", autocapitalize: "characters", inputmode: "text", maxlength: "12", value: state.code, oninput: (e) => { state.code = e.target.value; } }),
      h("p", { class: "hint" }, t("codeHelp"))] : [];
    const err = h("p", { class: "err", role: "alert" }, error || "");
    const send = h("button", { type: "button", class: "btn", onclick: () => submit(send, err) }, t("send"));
    render(header(), h("section", { class: "panel" }, h("h2", {}, t("reviewTitle")), h("p", { class: "tagline" }, t("reviewHint")), rows, codeInput, err),
      send, h("button", { type: "button", class: "btn ghost", onclick: selectScreen }, t("changeSel")));
  }

  async function submit(btn, errEl) {
    if (state.busy) return;
    if (!state.submissionId) state.submissionId = uuid(); // same id on every retry => never a duplicate
    state.busy = true; btn.disabled = true; btn.textContent = t("sending"); errEl.textContent = "";
    try {
      const r = await fetch("/api/vote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: state.code, submission_id: state.submissionId, choices: state.choice }) });
      const data = await r.json().catch(() => ({}));
      if (r.ok) return successScreen();
      state.submissionId = null; // definitive rejection: a later attempt is a new submission
      errEl.textContent = tError(data.error, data.message) || data.message || t("loadError");
    } catch {
      errEl.textContent = t("netError"); // keep submissionId: retry is idempotent
    }
    state.busy = false; btn.disabled = false; btn.textContent = t("send");
  }

  function successScreen() {
    const link = state.ev.results_visible ? h("a", { class: "btn ghost", href: "/results.html" + (LANG !== "es" ? "?lang=" + LANG : "") }, t("viewResults")) : null;
    render(header(), h("section", { class: "panel center" }, h("div", { class: "big", "aria-hidden": "true" }, "🎉"), h("h2", { class: "ok" }, t("successTitle")), h("p", {}, t("successText"))), link);
  }

  async function init() {
    try {
      const r = await fetch("/api/event");
      state.ev = await r.json();
      if (!r.ok) throw new Error();
    } catch { app.replaceChildren(h("p", { class: "err center" }, t("loadError"))); return; }
    const c = new URLSearchParams(location.search).get("c");
    if (c) state.code = c.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!state.ev.voting_open) {
      const closedLink = state.ev.results_visible ? h("a", { class: "btn ghost", href: "/results.html" }, t("viewResults")) : null;
      return messageScreen(t("closedTitle"), t("closedText"), closedLink);
    }
    selectScreen();
  }
  init();
})();
