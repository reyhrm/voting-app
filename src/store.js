// Poll store with two backends: Firebase Firestore (live, when configured)
// and a localStorage demo mode (syncs across tabs on one device).
import { initializeApp } from "firebase/app";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, increment } from "firebase/firestore";

const env = import.meta.env;
export const usingFirebase = Boolean(env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_API_KEY);

const DEFAULT_POLL = {
  question: "Which act should close the night?",
  options: [
    { id: "a", label: "Option A" },
    { id: "b", label: "Option B" },
    { id: "c", label: "Option C" },
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
    vote: (optionId) => updateDoc(ref, { [`counts.${optionId}`]: increment(1) }),
    save: (poll, prevRound) => setDoc(ref, { ...poll, counts: {}, round: (prevRound || 0) + 1 }),
    setOpen: (open) => updateDoc(ref, { open }),
    resetVotes: (round) => updateDoc(ref, { counts: {}, round: round + 1 }),
  };
}

function makeLocalStore() {
  const KEY = "live-vote-demo";
  const read = () => JSON.parse(localStorage.getItem(KEY) || "null") || DEFAULT_POLL;
  const write = (p) => { localStorage.setItem(KEY, JSON.stringify(p)); listeners.forEach((l) => l(p)); };
  const listeners = new Set();
  window.addEventListener("storage", (e) => { if (e.key === KEY) listeners.forEach((l) => l(read())); });
  return {
    subscribe(cb) { listeners.add(cb); cb(read()); return () => listeners.delete(cb); },
    vote(id) { const p = read(); p.counts[id] = (p.counts[id] || 0) + 1; write(p); },
    save(poll, prevRound) { write({ ...poll, counts: {}, round: (prevRound || 0) + 1 }); },
    setOpen(open) { write({ ...read(), open }); },
    resetVotes(round) { write({ ...read(), counts: {}, round: round + 1 }); },
  };
}

export const store = usingFirebase ? makeFirebaseStore() : makeLocalStore();
