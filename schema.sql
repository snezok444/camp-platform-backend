PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    total_coins INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number INTEGER NOT NULL,
    cleanliness_rating INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    login TEXT UNIQUE,
    password_hash TEXT,
    role TEXT DEFAULT 'leader',
    team_id INTEGER,
    room_id INTEGER,
    coins INTEGER DEFAULT 0,
    coins_add_blocked INTEGER DEFAULT 0,
    FOREIGN KEY (team_id) REFERENCES teams(id),
    FOREIGN KEY (room_id) REFERENCES rooms(id)
);