'use strict';

document.getElementById('year').textContent = new Date().getFullYear();

const form         = document.getElementById('win-form');
const playerInput  = document.getElementById('player-input');
const formMessage  = document.getElementById('form-message');
const dailyBoard   = document.getElementById('daily-leaderboard');
const overallBoard = document.getElementById('overall-leaderboard');
const historyPanel = document.getElementById('history-panel');
const dailyHeading = document.getElementById('daily-heading');

// ── Helpers ────────────────────────────────────────────────────────

function todayLabel() {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

function rankEmoji(i) {
  return ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
}

function setMessage(text, type) {
  formMessage.textContent = text;
  formMessage.className   = `form-message ${type}`;
}

// ── Render leaderboard ─────────────────────────────────────────────

function renderLeaderboard(container, rows) {
  if (!rows.length) {
    container.innerHTML = '<p class="empty-msg">No wins recorded yet. Be the first!</p>';
    return;
  }
  const maxWins = rows[0].wins;
  const tableRows = rows.map((r, i) => `
    <tr>
      <td class="rank-cell">${rankEmoji(i)}</td>
      <td>${escHtml(r.player)}</td>
      <td class="wins-cell">${r.wins}</td>
      <td class="wins-bar-cell">
        <div class="wins-bar-bg">
          <div class="wins-bar-fill" style="width:${Math.round((r.wins / maxWins) * 100)}%"></div>
        </div>
      </td>
    </tr>`).join('');

  container.innerHTML = `
    <table class="leaderboard-table">
      <thead>
        <tr>
          <th class="rank-cell">#</th>
          <th>Player</th>
          <th class="wins-cell">Wins</th>
          <th class="wins-bar-cell"></th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>`;
}

// ── Render history ─────────────────────────────────────────────────

function renderHistory(rows) {
  if (!rows.length) {
    historyPanel.innerHTML = '<p class="empty-msg">No history yet.</p>';
    return;
  }
  // Group by date
  const byDate = {};
  rows.forEach(r => {
    (byDate[r.win_date] = byDate[r.win_date] || []).push(r);
  });

  historyPanel.innerHTML = Object.entries(byDate).map(([date, entries]) => {
    const label = new Date(date + 'T00:00:00Z').toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    });
    const entriesHtml = entries.map(e => `
      <div class="history-row">
        <span>${escHtml(e.player)}</span>
        <span class="history-wins">${e.wins} ${e.wins === 1 ? 'win' : 'wins'}</span>
      </div>`).join('');
    return `<div class="history-date-group">
      <div class="history-date-label">${escHtml(label)}</div>
      <div class="history-rows">${entriesHtml}</div>
    </div>`;
  }).join('');
}

// ── Simple HTML escaper ────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Data fetching ──────────────────────────────────────────────────

async function loadDailyLeaderboard() {
  try {
    const res  = await fetch('/api/leaderboard');
    const data = await res.json();
    dailyHeading.textContent = `📅 Today's Leaderboard — ${todayLabel()}`;
    renderLeaderboard(dailyBoard, data.leaderboard);
  } catch {
    dailyBoard.innerHTML = '<p class="empty-msg">Could not load leaderboard.</p>';
  }
}

async function loadOverallLeaderboard() {
  try {
    const res  = await fetch('/api/overall');
    const data = await res.json();
    renderLeaderboard(overallBoard, data.leaderboard);
  } catch {
    overallBoard.innerHTML = '<p class="empty-msg">Could not load leaderboard.</p>';
  }
}

async function loadHistory() {
  try {
    const res  = await fetch('/api/history');
    const data = await res.json();
    renderHistory(data.history);
  } catch {
    historyPanel.innerHTML = '<p class="empty-msg">Could not load history.</p>';
  }
}

function refreshAll() {
  loadDailyLeaderboard();
  loadOverallLeaderboard();
  loadHistory();
}

// ── Form submission ────────────────────────────────────────────────

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const player = playerInput.value.trim();
  if (!player) return;

  setMessage('', '');

  try {
    const res = await fetch('/api/wins', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ player })
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || 'Something went wrong.', 'error');
      return;
    }
    setMessage(`✅ Win recorded for ${player}!`, 'success');
    playerInput.value = '';
    renderLeaderboard(dailyBoard, data.leaderboard);
    loadOverallLeaderboard();
    loadHistory();
  } catch {
    setMessage('Network error — please try again.', 'error');
  }
});

// ── Boot ───────────────────────────────────────────────────────────

refreshAll();
