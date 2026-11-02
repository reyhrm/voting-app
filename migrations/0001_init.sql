CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  event_name TEXT NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  voting_open INTEGER NOT NULL DEFAULT 0,
  results_mode TEXT NOT NULL DEFAULT 'private' CHECK (results_mode IN ('private','after_close','public')),
  code_mode TEXT NOT NULL DEFAULT 'required' CHECK (code_mode IN ('required','open')),
  logo TEXT, logo_type TEXT, logo_v INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY, position INTEGER NOT NULL, name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  photo TEXT, photo_type TEXT, photo_v INTEGER NOT NULL DEFAULT 0
);
-- One row per voting code. "token" is the submission id of the ballot that consumed it.
CREATE TABLE IF NOT EXISTS codes (
  code TEXT PRIMARY KEY, created_at INTEGER NOT NULL, used_at INTEGER, token TEXT
);
-- One ballot per submission. UNIQUE(code) and UNIQUE(token) are the hard guarantees
-- against double voting, even under concurrent requests.
CREATE TABLE IF NOT EXISTS ballots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE REFERENCES codes(code),
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS votes (
  ballot_id INTEGER NOT NULL REFERENCES ballots(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  PRIMARY KEY (ballot_id, category_id)
);
CREATE INDEX IF NOT EXISTS votes_candidate ON votes(candidate_id);
CREATE TABLE IF NOT EXISTS rate (key TEXT PRIMARY KEY, window INTEGER NOT NULL, n INTEGER NOT NULL);

INSERT OR IGNORE INTO settings (id, event_name, tagline) VALUES (1, 'Mi Evento', 'Vota por tus favoritos');
INSERT OR IGNORE INTO categories (id, position, name) VALUES (1, 1, 'Categoría 1'), (2, 2, 'Categoría 2');
INSERT OR IGNORE INTO candidates (id, category_id, position, name, description) VALUES
 (1, 1, 1, 'Candidato 1A', 'Descripción corta del candidato.'),
 (2, 1, 2, 'Candidato 1B', 'Descripción corta del candidato.'),
 (3, 2, 1, 'Candidato 2A', 'Descripción corta del candidato.'),
 (4, 2, 2, 'Candidato 2B', 'Descripción corta del candidato.');
