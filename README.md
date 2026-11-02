# Live Vote

Real-time voting for live events. React + Vite + Tailwind + Firebase Firestore, deploys to Vercel.

- `/` – attendees vote once per category (Masculino, Femenino) per device and see live results
- `/resultados` – big-screen live results, Masculino and Femenino side by side
- `/admin` – passcode-protected: publish a new poll, open/close voting, reset votes

## Setup
1. Create a Firebase project + Firestore database, add a web app, copy config into `.env` (see `.env.example`).
2. Paste `firestore.rules` into Firestore > Rules.
3. `npm install && npm run dev`
4. Deploy: import the repo in Vercel and add the same `VITE_*` env vars.

Without Firebase env vars the app runs in demo mode (localStorage).

Note: the admin passcode and "one vote per device" are client-side checks, fine for a party/event, not for high-stakes votes.
