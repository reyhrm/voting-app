// Shared results renderer (used by results.html and the admin dashboard).
function renderResults(data) {
  return data.categories.map((cat) =>
    h("section", { class: "panel" },
      h("h2", {}, cat.name),
      cat.candidates.map((k) => {
        const win = cat.winner === k.id;
        return h("div", { class: "row" },
          h("div", { class: "top" }, h("span", {}, win ? h("span", { class: "crown" }, "🏆 ") : null, k.name, win ? " · " + t("winner") : ""),
            h("span", { class: "stat" }, `${k.votes} ${k.votes === 1 ? t("vote") : t("votes")} · ${k.percent}%`)),
          h("div", { class: "bar", role: "progressbar", "aria-valuenow": String(k.percent), "aria-valuemin": "0", "aria-valuemax": "100", "aria-label": k.name },
            (() => { const i = h("i"); i.style.width = k.percent + "%"; return i; })()));
      }),
      h("p", { class: "hint stat" }, `${t("totalVotes")}: ${cat.total}`, cat.tie ? " · " + t("tie") : "")));
}
if (document.body.dataset.page === "results") {
  const app = document.getElementById("app");
  const load = async () => {
    try {
      const [ev, res] = await Promise.all([fetch("/api/event").then((r) => r.json()), fetch("/api/results")]);
      document.title = ev.event_name + " · " + t("resultsTitle");
      const head = h("header", { class: "hero" }, ev.logo ? h("img", { src: ev.logo, alt: "" }) : null, h("h1", {}, ev.event_name), h("p", { class: "tagline" }, t("resultsTitle")));
      if (!res.ok) return app.replaceChildren(head, h("p", { class: "panel center" }, t("resultsPrivate")), h("a", { class: "btn ghost", href: "/" }, t("back")));
      app.replaceChildren(head, ...renderResults(await res.json()));
    } catch { app.replaceChildren(h("p", { class: "err center" }, t("loadError"))); }
  };
  load(); setInterval(load, 10000);
}
