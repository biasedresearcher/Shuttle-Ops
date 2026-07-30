'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');

const NAME_LIMIT = 50;
const DAYS_ACTIVE_WINDOW = 30;
const DAYS_WEEK = 7;
const MIN_MATCHES_FOR_IMPROVED = 3;
const MIN_MATCHES_FOR_PLAYER_OF_WEEK = 3;
const MIN_BADGE_STREAK = 3;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function parseDate(dateStr) {
  if (!dateStr) return new Date();
  const parsed = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function startOfWeek(date) {
  const day = date.getUTCDay();
  const diff = (day + 6) % 7; // Monday as start
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - diff);
  return start;
}

function endOfWeek(date) {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return end;
}

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function normalizeName(name) {
  return String(name || '').trim();
}

function validatePlayers(names) {
  const cleaned = names.map(normalizeName).filter(Boolean);
  if (cleaned.some(n => n.length > NAME_LIMIT)) {
    return { error: `Player names must be ${NAME_LIMIT} characters or fewer.` };
  }
  const lowered = cleaned.map(n => n.toLowerCase());
  const deduped = new Set(lowered);
  if (deduped.size !== cleaned.length) {
    return { error: 'Player names must be unique within a match.' };
  }
  return { cleaned };
}

function validateMatchPayload(body, { allowDate = false } = {}) {
  const matchType = body.matchType === 'doubles' ? 'doubles' : 'singles';
  const teamAInput = Array.isArray(body.teamA) ? body.teamA : [];
  const teamBInput = Array.isArray(body.teamB) ? body.teamB : [];
  const { cleaned: teamA, error: teamAError } = validatePlayers(teamAInput);
  const { cleaned: teamB, error: teamBError } = validatePlayers(teamBInput);
  if (teamAError || teamBError) {
    return { error: teamAError || teamBError };
  }
  const combined = [...teamA, ...teamB];
  const combinedSet = new Set(combined.map(name => name.toLowerCase()));
  if (combinedSet.size !== combined.length) {
    return { error: 'Players cannot appear on both teams.' };
  }
  if (!teamA.length || !teamB.length) {
    return { error: 'Both teams must have at least one player.' };
  }
  if (matchType === 'singles' && (teamA.length !== 1 || teamB.length !== 1)) {
    return { error: 'Singles matches require one player per team.' };
  }
  if (matchType === 'doubles' && (teamA.length !== 2 || teamB.length !== 2)) {
    return { error: 'Doubles matches require two players per team.' };
  }

  return {
    matchType,
    teamA,
    teamB,
    winnerTeam: body.winnerTeam === 'B' ? 'B' : 'A',
    date: allowDate && body.matchDate ? body.matchDate : todayIso()
  };
}

function mapMatch(row) {
  if (!row) return null;
  return {
    id: row.id,
    matchDate: row.match_date,
    recordedAt: row.recorded_at,
    matchType: row.match_type,
    teamA: [row.team_a1, row.team_a2].filter(Boolean),
    teamB: [row.team_b1, row.team_b2].filter(Boolean),
    winnerTeam: row.winner_team
  };
}

function computeRankMovement(current, previous) {
  const prevRanks = new Map();
  previous.forEach((row, idx) => {
    prevRanks.set(row.player.toLowerCase(), idx + 1);
  });
  return current.map((row, idx) => {
    const rank = idx + 1;
    const prevRank = prevRanks.get(row.player.toLowerCase());
    const rankDelta = prevRank ? prevRank - rank : null;
    return { ...row, rank, rankDelta };
  });
}

function getRangeBounds(range, dateStr) {
  const date = parseDate(dateStr || todayIso());
  switch (range) {
    case 'week': {
      const start = startOfWeek(date);
      const end = endOfWeek(date);
      return { start: toIsoDate(start), end: toIsoDate(end), label: 'week' };
    }
    case 'month': {
      const start = startOfMonth(date);
      const end = endOfMonth(date);
      return { start: toIsoDate(start), end: toIsoDate(end), label: 'month' };
    }
    case 'all':
      return { start: null, end: null, label: 'all' };
    case 'day':
    default: {
      const day = toIsoDate(date);
      return { start: day, end: day, label: 'day' };
    }
  }
}

function compareNames(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

function extractTeams(match) {
  return {
    teamA: [match.team_a1, match.team_a2].filter(Boolean),
    teamB: [match.team_b1, match.team_b2].filter(Boolean)
  };
}

function computeStats(matches, player, opponent, formCount) {
  const statsByPlayer = new Map();
  const today = new Date();
  const cutoff30 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  cutoff30.setUTCDate(cutoff30.getUTCDate() - DAYS_ACTIVE_WINDOW);
  const cutoff7 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  cutoff7.setUTCDate(cutoff7.getUTCDate() - DAYS_WEEK);

  matches.forEach(match => {
    const teams = extractTeams(match);
    const winnerTeam = match.winner_team;
    const matchDate = new Date(`${match.match_date}T00:00:00Z`);
    const participants = [
      ...teams.teamA.map(name => ({ name, team: 'A' })),
      ...teams.teamB.map(name => ({ name, team: 'B' }))
    ];
    participants.forEach(({ name, team }) => {
      const key = name.toLowerCase();
      if (!statsByPlayer.has(key)) {
        statsByPlayer.set(key, {
          name,
          matches: 0,
          wins: 0,
          outcomes: [],
          winDates: [],
          weekendWins: 0,
          matchesLast30: 0,
          matchesLast7: 0,
          winsLast7: 0,
          monthWins: 0,
          monthMatches: 0,
          prevMonthWins: 0,
          prevMonthMatches: 0
        });
      }
      const entry = statsByPlayer.get(key);
      entry.matches += 1;
      const win = team === winnerTeam;
      entry.outcomes.push(win ? 'W' : 'L');
      if (win) {
        entry.wins += 1;
        entry.winDates.push(match.match_date);
        const day = matchDate.getUTCDay();
        if (day === 0 || day === 6) {
          entry.weekendWins += 1;
        }
      }
      if (matchDate >= cutoff30) {
        entry.matchesLast30 += 1;
      }
      if (matchDate >= cutoff7) {
        entry.matchesLast7 += 1;
        if (win) entry.winsLast7 += 1;
      }
      const monthKey = formatMonthKey(matchDate);
      const currentMonthKey = formatMonthKey(today);
      const prevMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const prevMonthKey = formatMonthKey(prevMonth);
      if (monthKey === currentMonthKey) {
        entry.monthMatches += 1;
        if (win) entry.monthWins += 1;
      } else if (monthKey === prevMonthKey) {
        entry.prevMonthMatches += 1;
        if (win) entry.prevMonthWins += 1;
      }
    });
  });

  const playerKey = player ? player.toLowerCase() : null;
  const playerStats = playerKey && statsByPlayer.get(playerKey);

  const currentStats = playerStats
    ? buildPlayerStats(playerStats, formCount)
    : null;

  const headToHead = player && opponent
    ? computeHeadToHead(matches, player, opponent)
    : null;

  const mostActive = pickMostActive(statsByPlayer);
  const mostImproved = pickMostImproved(statsByPlayer);
  const playerOfWeek = pickPlayerOfWeek(statsByPlayer);
  const badges = playerStats ? computeBadges(playerStats, statsByPlayer) : [];

  return {
    player: currentStats,
    headToHead,
    highlights: {
      mostActive,
      mostImproved,
      playerOfWeek
    },
    badges
  };
}

function formatMonthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function buildPlayerStats(entry, formCount) {
  const winPct = entry.matches ? Math.round((entry.wins / entry.matches) * 100) : 0;
  const currentStreak = computeCurrentStreak(entry.outcomes);
  const bestStreak = computeBestStreak(entry.outcomes);
  const form = entry.outcomes.slice(-formCount);
  return {
    name: entry.name,
    wins: entry.wins,
    matches: entry.matches,
    winPct,
    currentStreak,
    bestStreak,
    form
  };
}

function computeCurrentStreak(outcomes) {
  let streak = 0;
  for (let i = outcomes.length - 1; i >= 0; i -= 1) {
    if (outcomes[i] !== 'W') break;
    streak += 1;
  }
  return streak;
}

function computeBestStreak(outcomes) {
  let best = 0;
  let current = 0;
  outcomes.forEach(result => {
    if (result === 'W') {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  });
  return best;
}

function computeHeadToHead(matches, player, opponent) {
  let wins = 0;
  let losses = 0;
  matches.forEach(match => {
    const teams = extractTeams(match);
    const playerOnA = teams.teamA.some(name => compareNames(name, player));
    const playerOnB = teams.teamB.some(name => compareNames(name, player));
    const opponentOnA = teams.teamA.some(name => compareNames(name, opponent));
    const opponentOnB = teams.teamB.some(name => compareNames(name, opponent));
    if ((playerOnA && opponentOnB) || (playerOnB && opponentOnA)) {
      const playerWon = (playerOnA && match.winner_team === 'A') ||
        (playerOnB && match.winner_team === 'B');
      if (playerWon) wins += 1;
      else losses += 1;
    }
  });
  return {
    player,
    opponent,
    matches: wins + losses,
    wins,
    losses
  };
}

function pickMostActive(statsByPlayer) {
  let top = null;
  statsByPlayer.forEach(entry => {
    if (!top || entry.matchesLast30 > top.matches) {
      top = { player: entry.name, matches: entry.matchesLast30 };
    }
  });
  return top;
}

function pickMostImproved(statsByPlayer) {
  let best = null;
  statsByPlayer.forEach(entry => {
    if (entry.prevMonthMatches < MIN_MATCHES_FOR_IMPROVED || entry.monthMatches < MIN_MATCHES_FOR_IMPROVED) return;
    const prevPct = entry.prevMonthMatches ? entry.prevMonthWins / entry.prevMonthMatches : 0;
    const currentPct = entry.monthMatches ? entry.monthWins / entry.monthMatches : 0;
    const delta = currentPct - prevPct;
    if (!best || delta > best.delta) {
      best = {
        player: entry.name,
        delta: Math.round(delta * 100)
      };
    }
  });
  return best;
}

function pickPlayerOfWeek(statsByPlayer) {
  let best = null;
  statsByPlayer.forEach(entry => {
    if (entry.matchesLast7 < MIN_MATCHES_FOR_PLAYER_OF_WEEK) return;
    const pct = entry.matchesLast7 ? entry.winsLast7 / entry.matchesLast7 : 0;
    if (!best || pct > best.pct || (pct === best.pct && entry.winsLast7 > best.wins)) {
      best = {
        player: entry.name,
        winPct: Math.round(pct * 100),
        matches: entry.matchesLast7
      };
    }
  });
  return best;
}

function computeBadges(playerStats, statsByPlayer) {
  const badges = [];
  const winDates = Array.from(new Set(playerStats.winDates)).sort();
  let maxWinDayStreak = 0;
  let currentStreak = 0;
  for (let i = 0; i < winDates.length; i += 1) {
    if (i === 0) {
      currentStreak = 1;
    } else {
      const prev = new Date(`${winDates[i - 1]}T00:00:00Z`);
      const curr = new Date(`${winDates[i]}T00:00:00Z`);
      const diff = (curr - prev) / (24 * 60 * 60 * 1000);
      currentStreak = diff === 1 ? currentStreak + 1 : 1;
    }
    maxWinDayStreak = Math.max(maxWinDayStreak, currentStreak);
  }
  if (maxWinDayStreak >= MIN_BADGE_STREAK) {
    badges.push({ id: 'streak-3', label: '3-day streak', detail: `${maxWinDayStreak} day win streak` });
  }

  let weekendKing = null;
  statsByPlayer.forEach(entry => {
    if (!weekendKing || entry.weekendWins > weekendKing.weekendWins) {
      weekendKing = { player: entry.name, weekendWins: entry.weekendWins };
    }
  });
  if (weekendKing && compareNames(weekendKing.player, playerStats.name) && weekendKing.weekendWins > 0) {
    badges.push({ id: 'weekend-king', label: 'Weekend king', detail: `${weekendKing.weekendWins} weekend wins` });
  }

  const outcomes = playerStats.outcomes;
  let comeback = false;
  let losingStreak = 0;
  for (let i = 0; i < outcomes.length; i += 1) {
    if (outcomes[i] === 'L') {
      losingStreak += 1;
    } else {
      if (losingStreak >= 3) comeback = true;
      losingStreak = 0;
    }
  }
  if (comeback) {
    badges.push({ id: 'comeback', label: 'Comeback player', detail: 'Bounced back after a losing streak' });
  }

  return badges;
}

// POST /api/matches - Create a new match
router.post('/matches', (req, res) => {
  const validation = validateMatchPayload(req.body);
  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }
  const { matchType, teamA, teamB, winnerTeam, date } = validation;
  const id = db.recordMatch({ teamA, teamB, winnerTeam, matchType, date });
  const match = mapMatch(db.getMatchById(id));
  const dailyBounds = getRangeBounds('day', date);
  const leaderboard = db.getLeaderboard(dailyBounds.start, dailyBounds.end);

  const winners = winnerTeam === 'A' ? teamA : teamB;
  const achievements = winners.flatMap(name => buildAchievements(name, matchType));

  res.status(201).json({
    id,
    match,
    leaderboard,
    achievements
  });
});

// PATCH /api/matches/:id - Update an existing match
router.patch('/matches/:id', (req, res) => {
  const validation = validateMatchPayload(req.body, { allowDate: true });
  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }
  const { matchType, teamA, teamB, winnerTeam, date } = validation;
  const updated = db.updateMatch(Number(req.params.id), { teamA, teamB, winnerTeam, matchType, date });
  if (!updated) {
    return res.status(404).json({ error: 'Match not found.' });
  }
  res.json({ match: mapMatch(updated) });
});

// DELETE /api/matches/:id - Delete a match by ID
router.delete('/matches/:id', (req, res) => {
  const deleted = db.deleteMatch(Number(req.params.id));
  if (!deleted) {
    return res.status(404).json({ error: 'Match not found.' });
  }
  res.json({ match: mapMatch(deleted) });
});

// POST /api/matches/undo - Delete the last recorded match
router.post('/matches/undo', (_req, res) => {
  const deleted = db.deleteLastMatch();
  if (!deleted) {
    return res.status(404).json({ error: 'No matches to undo.' });
  }
  res.json({ match: mapMatch(deleted) });
});

// GET /api/matches/recent - Get recent matches with optional limit
router.get('/matches/recent', (req, res) => {
  const limit = Number(req.query.limit) || 10;
  const matches = db.getRecentMatches(limit).map(mapMatch);
  res.json({ matches });
});

// GET /api/leaderboard?range=day|week|month|all - Get leaderboard for specified time range
router.get('/leaderboard', (req, res) => {
  const range = req.query.range || 'day';
  const date = req.query.date || todayIso();
  const bounds = getRangeBounds(range, date);
  const leaderboard = db.getLeaderboard(bounds.start, bounds.end);

  let enriched = leaderboard;
  if (bounds.label === 'day') {
    const yesterday = new Date(`${bounds.start}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const prevBounds = getRangeBounds('day', toIsoDate(yesterday));
    const prev = db.getLeaderboard(prevBounds.start, prevBounds.end);
    enriched = computeRankMovement(leaderboard, prev);
  } else {
    enriched = leaderboard.map((row, idx) => ({ ...row, rank: idx + 1, rankDelta: null }));
  }

  res.json({ range: bounds.label, date, leaderboard: enriched });
});

// GET /api/players - Get list of all players
router.get('/players', (_req, res) => {
  res.json({ players: db.listPlayers() });
});

// GET /api/stats?player=...&opponent=...&form=5 - Get player statistics and head-to-head data
router.get('/stats', (req, res) => {
  const player = req.query.player ? normalizeName(req.query.player) : null;
  const opponent = req.query.opponent ? normalizeName(req.query.opponent) : null;
  const formCount = Number(req.query.form) === 10 ? 10 : 5;
  const matches = db.getAllMatches();
  res.json(computeStats(matches, player, opponent, formCount));
});

function buildAchievements(playerName, matchType) {
  const totals = db.getPlayerTotals(playerName);
  const achievements = [];
  if (totals.wins === 10) {
    achievements.push({ id: '10-wins', title: '10 Wins!', detail: `${playerName} reached 10 wins.` });
  }
  if (totals.matches === 50) {
    achievements.push({ id: '50-matches', title: '50 Matches!', detail: `${playerName} played 50 matches.` });
  }
  if (matchType === 'doubles' && totals.doubles_wins === 1) {
    achievements.push({ id: 'first-doubles', title: 'First Doubles Win!', detail: `${playerName} secured their first doubles win.` });
  }
  return achievements;
}

module.exports = router;
