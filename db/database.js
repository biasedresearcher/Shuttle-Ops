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
      CREATE TABLE IF NOT EXISTS wins (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        player    TEXT    NOT NULL COLLATE NOCASE,
        win_date  TEXT    NOT NULL DEFAULT (date('now')),
        recorded_at TEXT  NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_wins_date   ON wins (win_date);
      CREATE INDEX IF NOT EXISTS idx_wins_player ON wins (player COLLATE NOCASE);
    `);
  }
  return db;
}

function recordWin(player, date) {
  const stmt = getDb().prepare(
    `INSERT INTO wins (player, win_date) VALUES (?, ?)`
  );
  const info = stmt.run(player.trim(), date);
  return info.lastInsertRowid;
}

function getDailyLeaderboard(date) {
  return getDb()
    .prepare(
      `SELECT player, COUNT(*) AS wins
       FROM wins
       WHERE win_date = ?
       GROUP BY player COLLATE NOCASE
       ORDER BY wins DESC, player ASC`
    )
    .all(date);
}

function getOverallLeaderboard() {
  return getDb()
    .prepare(
      `SELECT player, COUNT(*) AS wins
       FROM wins
       GROUP BY player COLLATE NOCASE
       ORDER BY wins DESC, player ASC`
    )
    .all();
}

function getHistory(limit) {
  return getDb()
    .prepare(
      `SELECT win_date, player, COUNT(*) AS wins
       FROM wins
       GROUP BY win_date, player COLLATE NOCASE
       ORDER BY win_date DESC, wins DESC, player ASC
       LIMIT ?`
    )
    .all(limit || 200);
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, recordWin, getDailyLeaderboard, getOverallLeaderboard, getHistory, closeDb };
