'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'scores.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS matches (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        match_date   TEXT    NOT NULL DEFAULT (date('now')),
        recorded_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        match_type   TEXT    NOT NULL DEFAULT 'singles',
        team_a1      TEXT    NOT NULL COLLATE NOCASE,
        team_a2      TEXT        NULL COLLATE NOCASE,
        team_b1      TEXT    NOT NULL COLLATE NOCASE,
        team_b2      TEXT        NULL COLLATE NOCASE,
        winner_team  TEXT    NOT NULL CHECK (winner_team IN ('A','B')),
        CHECK (match_type IN ('singles','doubles'))
      );
      CREATE INDEX IF NOT EXISTS idx_matches_date   ON matches (match_date);
      CREATE INDEX IF NOT EXISTS idx_matches_record ON matches (recorded_at);
      CREATE INDEX IF NOT EXISTS idx_matches_team_a1 ON matches (team_a1 COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_matches_team_b1 ON matches (team_b1 COLLATE NOCASE);
    `);
  }
  return db;
}

function recordMatch({ teamA, teamB, winnerTeam, matchType, date }) {
  const stmt = getDb().prepare(`
    INSERT INTO matches (match_date, match_type, team_a1, team_a2, team_b1, team_b2, winner_team)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    date,
    matchType,
    teamA[0],
    teamA[1] || null,
    teamB[0],
    teamB[1] || null,
    winnerTeam
  );
  return info.lastInsertRowid;
}

function updateMatch(id, { teamA, teamB, winnerTeam, matchType, date }) {
  getDb()
    .prepare(`
      UPDATE matches
      SET match_date = ?, match_type = ?, team_a1 = ?, team_a2 = ?, team_b1 = ?, team_b2 = ?, winner_team = ?
      WHERE id = ?
    `)
    .run(
      date,
      matchType,
      teamA[0],
      teamA[1] || null,
      teamB[0],
      teamB[1] || null,
      winnerTeam,
      id
    );
  return getMatchById(id);
}

function getMatchById(id) {
  return getDb().prepare(`SELECT * FROM matches WHERE id = ?`).get(id);
}

function getLastMatch() {
  return getDb()
    .prepare(`SELECT * FROM matches ORDER BY recorded_at DESC, id DESC LIMIT 1`)
    .get();
}

function deleteMatch(id) {
  const match = getMatchById(id);
  if (!match) return null;
  getDb().prepare(`DELETE FROM matches WHERE id = ?`).run(id);
  return match;
}

function deleteLastMatch() {
  const match = getLastMatch();
  if (!match) return null;
  getDb().prepare(`DELETE FROM matches WHERE id = ?`).run(match.id);
  return match;
}

function getRecentMatches(limit) {
  return getDb()
    .prepare(`SELECT * FROM matches ORDER BY recorded_at DESC, id DESC LIMIT ?`)
    .all(limit || 10);
}

function getAllMatches() {
  return getDb()
    .prepare(`SELECT * FROM matches ORDER BY recorded_at ASC, id ASC`)
    .all();
}

function listPlayers() {
  return getDb()
    .prepare(`
      SELECT MIN(player) AS player
      FROM (
        SELECT team_a1 AS player FROM matches
        UNION
        SELECT team_a2 AS player FROM matches WHERE team_a2 IS NOT NULL
        UNION
        SELECT team_b1 AS player FROM matches
        UNION
        SELECT team_b2 AS player FROM matches WHERE team_b2 IS NOT NULL
      )
      WHERE player IS NOT NULL
      GROUP BY LOWER(player)
      ORDER BY player COLLATE NOCASE
    `)
    .all()
    .map(row => row.player);
}

function getLeaderboard(startDate, endDate) {
  const params = [];
  let dateClause = '';
  if (startDate && endDate) {
    dateClause = 'WHERE match_date BETWEEN ? AND ?';
    params.push(startDate, endDate);
  }

  return getDb()
    .prepare(`
      WITH participants AS (
        SELECT match_date, winner_team, 'A' AS team, team_a1 AS player FROM matches
        UNION ALL
        SELECT match_date, winner_team, 'A' AS team, team_a2 AS player FROM matches WHERE team_a2 IS NOT NULL
        UNION ALL
        SELECT match_date, winner_team, 'B' AS team, team_b1 AS player FROM matches
        UNION ALL
        SELECT match_date, winner_team, 'B' AS team, team_b2 AS player FROM matches WHERE team_b2 IS NOT NULL
      )
      SELECT MIN(player) AS player,
             SUM(CASE WHEN team = winner_team THEN 1 ELSE 0 END) AS wins,
             COUNT(*) AS matches
      FROM participants
      ${dateClause}
      GROUP BY LOWER(player)
      ORDER BY wins DESC, player ASC
    `)
    .all(...params);
}

function getPlayerTotals(player) {
  return (
    getDb()
      .prepare(`
        WITH participants AS (
          SELECT match_type, winner_team, 'A' AS team, team_a1 AS player FROM matches
          UNION ALL
          SELECT match_type, winner_team, 'A' AS team, team_a2 AS player FROM matches WHERE team_a2 IS NOT NULL
          UNION ALL
          SELECT match_type, winner_team, 'B' AS team, team_b1 AS player FROM matches
          UNION ALL
          SELECT match_type, winner_team, 'B' AS team, team_b2 AS player FROM matches WHERE team_b2 IS NOT NULL
        )
        SELECT
          SUM(CASE WHEN team = winner_team THEN 1 ELSE 0 END) AS wins,
          COUNT(*) AS matches,
          SUM(CASE WHEN team = winner_team AND match_type = 'doubles' THEN 1 ELSE 0 END) AS doubles_wins
        FROM participants
        WHERE player = ? COLLATE NOCASE
      `)
      .get(player) || { wins: 0, matches: 0, doubles_wins: 0 }
  );
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  recordMatch,
  updateMatch,
  getMatchById,
  getLastMatch,
  deleteMatch,
  deleteLastMatch,
  getRecentMatches,
  getAllMatches,
  listPlayers,
  getLeaderboard,
  getPlayerTotals,
  closeDb
};
