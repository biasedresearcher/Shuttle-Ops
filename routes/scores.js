'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');

// Helper – today's ISO date string (YYYY-MM-DD)
function today() {
  return new Date().toISOString().slice(0, 10);
}

// POST /api/wins  { player: "Alice" }
router.post('/wins', (req, res) => {
  const player = (req.body.player || '').trim();
  if (!player) {
    return res.status(400).json({ error: 'Player name is required.' });
  }
  if (player.length > 50) {
    return res.status(400).json({ error: 'Player name must be 50 characters or fewer.' });
  }
  const date = today();
  const id = db.recordWin(player, date);
  const leaderboard = db.getDailyLeaderboard(date);
  res.status(201).json({ id, player, date, leaderboard });
});

// GET /api/leaderboard?date=YYYY-MM-DD  (defaults to today)
router.get('/leaderboard', (req, res) => {
  const date = req.query.date || today();
  const leaderboard = db.getDailyLeaderboard(date);
  res.json({ date, leaderboard });
});

// GET /api/overall
router.get('/overall', (req, res) => {
  res.json({ leaderboard: db.getOverallLeaderboard() });
});

// GET /api/history
router.get('/history', (req, res) => {
  res.json({ history: db.getHistory(200) });
});

module.exports = router;
