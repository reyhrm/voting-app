// Translations. Spanish is the default; add another language by adding a new key below
// (e.g. fr: {...}) and a link such as /?lang=fr. Missing keys fall back to Spanish.
const I18N = {
  es: {
    howTitle: "Cómo votar",
    how1: "Elige un candidato en cada categoría.",
    how2: "Revisa tu selección y escribe tu código de votación.",
    how3: "Envía tus votos. Solo puedes votar una vez.",
    pick: "Elegir", picked: "Elegido", review: "Revisar mi voto", changeSel: "Cambiar selección",
    needBoth: "Elige un candidato en cada categoría para continuar",
    reviewTitle: "Confirma tu voto", reviewHint: "Revisa tus elecciones antes de enviar.",
    codeLabel: "Código de votación", codeHelp: "Lo recibiste del organizador del evento.",
    send: "Enviar mis votos", sending: "Enviando…",
    successTitle: "¡Voto registrado!", successText: "Gracias por participar. Tu voto fue guardado correctamente.",
    viewResults: "Ver resultados",
    closedTitle: "La votación está cerrada", closedText: "Gracias por tu interés.",
    notOpenTitle: "La votación aún no está abierta", notOpenText: "Vuelve a intentarlo cuando el organizador la abra.",
    netError: "No hay conexión. Tu voto no se duplicará: puedes volver a intentarlo.",
    loadError: "No se pudo cargar. Actualiza la página.",
    resultsTitle: "Resultados", votes: "votos", vote: "voto", winner: "Ganador", tie: "Empate",
    totalVotes: "Total de votos", resultsPrivate: "Los resultados aún no están disponibles.", back: "Volver",
    errors: { invalid_code: "Código no válido", code_used: "Este código ya fue utilizado", closed: "La votación está cerrada", code_required: "Introduce tu código de votación", rate_limited: "Demasiados intentos. Espera un momento.", bad_choice: "Elige un candidato en cada categoría" },
  },
  en: {
    howTitle: "How to vote",
    how1: "Choose one candidate in each category.",
    how2: "Review your selection and enter your voting code.",
    how3: "Submit your votes. You can only vote once.",
    pick: "Choose", picked: "Chosen", review: "Review my vote", changeSel: "Change selection",
    needBoth: "Choose one candidate in each category to continue",
    reviewTitle: "Confirm your vote", reviewHint: "Check your choices before submitting.",
    codeLabel: "Voting code", codeHelp: "You received it from the event organizer.",
    send: "Submit my votes", sending: "Sending…",
    successTitle: "Vote recorded!", successText: "Thanks for taking part. Your vote was saved.",
    viewResults: "View results",
    closedTitle: "Voting is closed", closedText: "Thank you for your interest.",
    notOpenTitle: "Voting is not open yet", notOpenText: "Please come back once the organizer opens it.",
    netError: "No connection. Your vote won't be duplicated: you can try again.",
    loadError: "Could not load. Please refresh the page.",
    resultsTitle: "Results", votes: "votes", vote: "vote", winner: "Winner", tie: "Tie",
    totalVotes: "Total votes", resultsPrivate: "Results are not available yet.", back: "Back",
    errors: { invalid_code: "Invalid code", code_used: "This code has already been used", closed: "Voting is closed", code_required: "Enter your voting code", rate_limited: "Too many attempts. Please wait a moment.", bad_choice: "Choose a candidate in each category" },
  },
};
const LANG = (() => {
  const q = new URLSearchParams(location.search).get("lang");
  let l = q || "";
  try { if (q) localStorage.setItem("lang", q); else l = localStorage.getItem("lang") || ""; } catch {}
  return I18N[l] ? l : "es";
})();
document.documentElement.lang = LANG;
function t(key) { return I18N[LANG][key] ?? I18N.es[key] ?? key; }
function tError(code, fallback) { return (I18N[LANG].errors || {})[code] || (I18N.es.errors || {})[code] || fallback || ""; }
// Tiny DOM helper: all text goes through textContent, never innerHTML.
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}
