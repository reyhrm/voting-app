// Poll store with two backends: Firebase Firestore (live, when configured)
// and a localStorage demo mode (syncs across tabs on one device).
import { initializeApp } from "firebase/app";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, increment } from "firebase/firestore";

const env = import.meta.env;
export const usingFirebase = Boolean(env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_API_KEY);

const DEFAULT_POLL = {
  title: "Votaciones",
  categories: [
    { key: "masculino", label: "Masculino", candidates: [{ id: "c0", label: "Candidato 1" }, { id: "c1", label: "Candidato 2" }, { id: "c2", label: "Candidato 3" }] },
    { key: "femenino", label: "Femenino", candidates: [{ id: "c0", label: "Candidata 1" }, { id: "c1", label: "Candidata 2" }, { id: "c2", label: "Candidata 3" }] },
  ],
  open: true,
  round: 1,
  counts: {},
};

function makeFirebaseStore() {
  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  });
  const ref = doc(getFirestore(app), "polls", "current");
  return {
    subscribe(cb) {
      return onSnapshot(ref, (snap) => {
        if (snap.exists()) cb(snap.data());
        else setDoc(ref, DEFAULT_POLL); // first run: seed a poll
      });
    },
    vote: (catKey, id) => updateDoc(ref, { [`counts.${catKey}__${id}`]: increment(1) }),
    save: (poll, prevRound) => setDoc(ref, { ...poll, counts: {}, round: (prevRound || 0) + 1 }),
    setOpen: (open) => updateDoc(ref, { open }),
    resetVotes: (round) => updateDoc(ref, { counts: {}, round: round + 1 }),
  };
}

function makeLocalStore() {
  const KEY = "live-vote-demo-v2";
  const read = () => JSON.parse(localStorage.getItem(KEY) || "null") || DEFAULT_POLL;
  const write = (p) => { localStorage.setItem(KEY, JSON.stringify(p)); listeners.forEach((l) => l(p)); };
  const listeners = new Set();
  window.addEventListener("storage", (e) => { if (e.key === KEY) listeners.forEach((l) => l(read())); });
  return {
    subscribe(cb) { listeners.add(cb); cb(read()); return () => listeners.delete(cb); },
    vote(catKey, id) { const p = read(); const k = `${catKey}__${id}`; p.counts[k] = (p.counts[k] || 0) + 1; write(p); },
    save(poll, prevRound) { write({ ...poll, counts: {}, round: (prevRound || 0) + 1 }); },
    setOpen(open) { write({ ...read(), open }); },
    resetVotes(round) { write({ ...read(), counts: {}, round: round + 1 }); },
  };
}

export const store = usingFirebase ? makeFirebaseStore() : makeLocalStore();
