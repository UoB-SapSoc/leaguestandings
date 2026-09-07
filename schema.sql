PRAGMA foreign_keys = ON;

CREATE TABLE players (
    player_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name    TEXT NOT NULL,
    last_name     TEXT NOT NULL,
    is_member     INTEGER NOT NULL DEFAULT 0 CHECK (is_member IN (0, 1)),
    joined_date   TEXT NOT NULL DEFAULT (date('now')),
    base_elo      FLOAT NOT NULL DEFAULT 1000,
    current_elo   FLOAT NOT NULL DEFAULT 1000,
    is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    notes         TEXT
);

CREATE TABLE semesters (
    semester_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT NOT NULL,
    start_date        TEXT NOT NULL,
    end_date          TEXT,
    status            TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('upcoming', 'active', 'completed')),
    winner_player_id  INTEGER REFERENCES players(player_id)
);

CREATE TABLE semesters_players (
    semester_id     INTEGER NOT NULL REFERENCES semesters(semester_id) ON DELETE CASCADE,
    player_id     INTEGER NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    starting_elo  INTEGER NOT NULL,
    points        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (semester_id, player_id)
);

CREATE TABLE sessions (
    session_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    semester_id     INTEGER NOT NULL REFERENCES semesters(semester_id) ON DELETE CASCADE,
    session_date  TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'in_progress'
                      CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
    UNIQUE (semester_id, session_date)
);

CREATE TABLE session_attendance (
    session_id  INTEGER NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    player_id   INTEGER NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    PRIMARY KEY (session_id, player_id)
);

CREATE TABLE rounds (
    round_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    INTEGER NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    round_number  INTEGER NOT NULL,
    UNIQUE (session_id, round_number)
);

CREATE TABLE matches (
    match_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id             INTEGER NOT NULL REFERENCES rounds(round_id) ON DELETE CASCADE,
    player1_id           INTEGER NOT NULL REFERENCES players(player_id),
    player2_id           INTEGER REFERENCES players(player_id),
    winner_id            INTEGER REFERENCES players(player_id),
    player1_elo_before   INTEGER NOT NULL,
    player2_elo_before   INTEGER,
    player1_elo_after    INTEGER,
    player2_elo_after    INTEGER,
    played_at            TEXT DEFAULT (datetime('now')),
    CHECK (player2_id IS NULL OR player1_id != player2_id),
    CHECK (winner_id IS NULL OR winner_id IN (player1_id, player2_id))
);

CREATE TABLE elo_history (
    elo_history_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id       INTEGER NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    match_id        INTEGER REFERENCES matches(match_id) ON DELETE CASCADE,
    elo_before      INTEGER NOT NULL,
    elo_after       INTEGER NOT NULL,
    elo_change      INTEGER NOT NULL,
    recorded_at     TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_matches_round     ON matches(round_id);
CREATE INDEX idx_matches_player1   ON matches(player1_id);
CREATE INDEX idx_matches_player2   ON matches(player2_id);
CREATE INDEX idx_elo_history_player ON elo_history(player_id);
CREATE INDEX idx_rounds_session    ON rounds(session_id);
CREATE INDEX idx_sessions_semester   ON sessions(semester_id);
CREATE INDEX idx_attendance_player ON session_attendance(player_id);

CREATE TRIGGER trg_sync_player_elo
AFTER INSERT ON elo_history
BEGIN
    UPDATE players
    SET current_elo = NEW.elo_after
    WHERE player_id = NEW.player_id;
END;

CREATE VIEW v_alltime_standings AS
SELECT
    p.player_id,
    p.first_name || ' ' || p.last_name AS player_name,
    p.base_elo    AS starting_elo,
    p.current_elo AS current_elo,
    COALESCE(pts.total_points, 0)      AS points,
    COALESCE(stats.wins, 0)            AS wins,
    COALESCE(stats.losses, 0)          AS losses,
    COALESCE(stats.byes, 0)            AS byes,
    COALESCE(stats.matches_played, 0)  AS matches_played
FROM players p
LEFT JOIN (
    SELECT player_id, SUM(points) AS total_points
    FROM semesters_players
    GROUP BY player_id
) pts ON pts.player_id = p.player_id
LEFT JOIN (
    SELECT
        pid,
        COUNT(CASE WHEN winner_id = pid THEN 1 END) AS wins,
        COUNT(CASE WHEN winner_id IS NOT NULL AND winner_id != pid THEN 1 END) AS losses,
        COUNT(CASE WHEN player2_id IS NULL THEN 1 END) AS byes,
        COUNT(CASE WHEN player2_id IS NOT NULL THEN 1 END) AS matches_played
    FROM (
        SELECT player1_id AS pid, winner_id, player2_id FROM matches
        UNION ALL
        SELECT player2_id AS pid, winner_id, player1_id AS player2_id
        FROM matches WHERE player2_id IS NOT NULL
    )
    GROUP BY pid
) stats ON stats.pid = p.player_id;

CREATE VIEW v_alltime_standings_active AS
SELECT v.*
FROM v_alltime_standings v
JOIN players p ON p.player_id = v.player_id
WHERE p.is_active = 1;

CREATE VIEW v_semester_standings AS
SELECT
    sp.semester_id,
    sp.player_id,
    p.first_name || ' ' || p.last_name AS player_name,
    sp.starting_elo,
    p.current_elo AS current_elo,
    sp.points AS points,
    COUNT(CASE WHEN m.winner_id = sp.player_id THEN 1 END) AS wins,
    COUNT(CASE
            WHEN m.winner_id IS NOT NULL
             AND m.winner_id != sp.player_id
             AND (m.player1_id = sp.player_id OR m.player2_id = sp.player_id)
            THEN 1
          END) AS losses,
    COUNT(CASE
            WHEN m.player2_id IS NULL AND m.player1_id = sp.player_id
            THEN 1
          END) AS byes,
    COUNT(CASE
            WHEN (m.player1_id = sp.player_id OR m.player2_id = sp.player_id)
             AND m.player2_id IS NOT NULL
            THEN 1
          END) AS matches_played
FROM semesters_players sp
JOIN players p ON p.player_id = sp.player_id
LEFT JOIN sessions s ON s.semester_id = sp.semester_id
LEFT JOIN rounds   r ON r.session_id = s.session_id
LEFT JOIN matches  m ON m.round_id = r.round_id
                     AND (m.player1_id = sp.player_id OR m.player2_id = sp.player_id)
GROUP BY sp.semester_id, sp.player_id;

CREATE VIEW v_player_elo_timeline AS
SELECT
    eh.player_id,
    p.first_name || ' ' || p.last_name AS player_name,
    eh.elo_before,
    eh.elo_after,
    eh.elo_change,
    eh.recorded_at,
    eh.match_id
FROM elo_history eh
JOIN players p ON p.player_id = eh.player_id
ORDER BY eh.recorded_at;
