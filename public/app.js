'use strict';

document.getElementById('year').textContent = new Date().getFullYear();

const form = document.getElementById('match-form');
const matchType = document.getElementById('match-type');
const winnerTeam = document.getElementById('winner-team');
const teamA1 = document.getElementById('team-a1');
const teamA2 = document.getElementById('team-a2');
const teamB1 = document.getElementById('team-b1');
const teamB2 = document.getElementById('team-b2');
const submitButton = document.getElementById('submit-button');
const cancelEditButton = document.getElementById('cancel-edit');
const undoButton = document.getElementById('undo-button');
const formMessage = document.getElementById('form-message');

const dailyBoard = document.getElementById('daily-leaderboard');
const weeklyBoard = document.getElementById('weekly-leaderboard');
const monthlyBoard = document.getElementById('monthly-leaderboard');
const overallBoard = document.getElementById('overall-leaderboard');
const dailyHeading = document.getElementById('daily-heading');

const focusPlayer = document.getElementById('focus-player');
const formLength = document.getElementById('form-length');
const statWinPct = document.getElementById('stat-win-pct');
const statMatches = document.getElementById('stat-matches');
const statCurrentStreak = document.getElementById('stat-current-streak');
const statBestStreak = document.getElementById('stat-best-streak');
const statForm = document.getElementById('stat-form');
const highlightActive = document.getElementById('highlight-active');
const highlightImproved = document.getElementById('highlight-improved');
const highlightWeek = document.getElementById('highlight-week');
const headA = document.getElementById('head-a');
const headB = document.getElementById('head-b');
const headToHeadResult = document.getElementById('head-to-head-result');
const badgeList = document.getElementById('badge-list');

const recentMatches = document.getElementById('recent-matches');
const toastContainer = document.getElementById('toast-container');

let editingMatchId = null;
let recentMatchCache = [];

// ── Helpers ────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setMessage(text, type) {
  formMessage.textContent = text;
  formMessage.className = `form-message ${type}`;
}

function rankEmoji(i) {
  return ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
}

function movementLabel(rankDelta) {
  if (rankDelta === null || rankDelta === undefined) return { text: '—', className: 'rank-move new' };
  if (rankDelta > 0) return { text: `↑${rankDelta}`, className: 'rank-move up' };
  if (rankDelta < 0) return { text: `↓${Math.abs(rankDelta)}`, className: 'rank-move down' };
  return { text: '→0', className: 'rank-move new' };
}

function showToast(achievement) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<h5>${escHtml(achievement.title)}</h5><p>${escHtml(achievement.detail)}</p>`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 5000);
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

// ── Render leaderboards ─────────────────────────────────────────────

function renderLeaderboard(container, rows, { showMovement, showTrophy } = {}) {
  if (!rows.length) {
    container.innerHTML = '<p class="empty-msg">No matches yet.</p>';
    return;
  }
  const maxWins = rows[0].wins || 1;
  const tableRows = rows.map((row, i) => {
    const movement = movementLabel(row.rankDelta);
    const trophy = showTrophy && i === 0 ? ' 🏆' : '';
    return `
      <tr>
        <td class="rank-cell">${rankEmoji(i)}</td>
        <td>${escHtml(row.player)}${trophy}</td>
        <td class="movement-cell"><span class="${movement.className}">${movement.text}</span></td>
        <td class="wins-cell">${row.wins}</td>
        <td class="matches-cell">${row.matches}</td>
        <td class="wins-bar-cell">
          <div class="wins-bar-bg">
            <div class="wins-bar-fill" style="width:${Math.round((row.wins / maxWins) * 100)}%"></div>
          </div>
        </td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <table class="leaderboard-table">
      <thead>
        <tr>
          <th class="rank-cell">#</th>
          <th>Player</th>
          <th class="movement-cell">Δ</th>
          <th class="wins-cell">Wins</th>
          <th class="matches-cell">Matches</th>
          <th class="wins-bar-cell"></th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>`;
}

function renderRecentMatches(matches) {
  if (!matches.length) {
    recentMatches.innerHTML = '<p class="empty-msg">No recent matches yet.</p>';
    return;
  }
  recentMatches.innerHTML = matches.map(match => `
    <div class="match-row">
      <div>
        <strong>${escHtml(matchSummary(match))}</strong>
        <div class="muted">${escHtml(match.matchDate)} · ${escHtml(match.matchType)}</div>
      </div>
      <div class="match-actions">
        <button data-action="edit" data-id="${match.id}">Edit</button>
        <button data-action="delete" data-id="${match.id}">Delete</button>
      </div>
    </div>
  `).join('');
}

function matchSummary(match) {
  const teamA = match.teamA.join(' & ');
  const teamB = match.teamB.join(' & ');
  const winner = match.winnerTeam === 'A' ? teamA : teamB;
  return `${teamA} vs ${teamB} — Winner: ${winner}`;
}

// ── Data loading ────────────────────────────────────────────────────

async function loadLeaderboards() {
  const [daily, weekly, monthly, overall] = await Promise.all([
    fetchJson('/api/leaderboard?range=day'),
    fetchJson('/api/leaderboard?range=week'),
    fetchJson('/api/leaderboard?range=month'),
    fetchJson('/api/leaderboard?range=all')
  ]);
  dailyHeading.textContent = `Daily — ${new Date().toLocaleDateString()}`;
  renderLeaderboard(dailyBoard, daily.leaderboard, { showMovement: true });
  renderLeaderboard(weeklyBoard, weekly.leaderboard);
  renderLeaderboard(monthlyBoard, monthly.leaderboard, { showTrophy: true });
  renderLeaderboard(overallBoard, overall.leaderboard, { showTrophy: true });
}

async function loadRecentMatches() {
  const data = await fetchJson('/api/matches/recent?limit=10');
  recentMatchCache = data.matches;
  renderRecentMatches(data.matches);
}

async function loadPlayers() {
  const data = await fetchJson('/api/players');
  const options = data.players.length
    ? data.players.map(name => `<option value="${escHtml(name)}">${escHtml(name)}</option>`).join('')
    : '<option value="">No players yet</option>';
  focusPlayer.innerHTML = options;
  headA.innerHTML = options;
  headB.innerHTML = options;
  if (data.players.length) {
    focusPlayer.value = data.players[0];
    headA.value = data.players[0];
    headB.value = data.players[1] || data.players[0];
  }
}

async function loadStats() {
  const player = focusPlayer.value;
  const opponent = headB.value && headB.value !== player ? headB.value : '';
  if (!player) {
    statWinPct.textContent = '—';
    statMatches.textContent = '—';
    statCurrentStreak.textContent = '—';
    statBestStreak.textContent = '—';
    statForm.textContent = '—';
    headToHeadResult.textContent = '—';
    badgeList.innerHTML = '';
    highlightActive.textContent = '—';
    highlightImproved.textContent = '—';
    highlightWeek.textContent = '—';
    return;
  }

  const data = await fetchJson(`/api/stats?player=${encodeURIComponent(player)}&opponent=${encodeURIComponent(opponent)}&form=${formLength.value}`);
  if (data.player) {
    statWinPct.textContent = `${data.player.winPct}%`;
    statMatches.textContent = data.player.matches;
    statCurrentStreak.textContent = `${data.player.currentStreak}W`;
    statBestStreak.textContent = `${data.player.bestStreak}W`;
    statForm.textContent = data.player.form.length ? data.player.form.join(' ') : '—';
  }

  if (data.headToHead && data.headToHead.matches) {
    headToHeadResult.textContent = `${data.headToHead.player} leads ${data.headToHead.wins}-${data.headToHead.losses} over ${data.headToHead.opponent} (${data.headToHead.matches} matches)`;
  } else {
    headToHeadResult.textContent = 'No head-to-head matches yet.';
  }

  if (data.highlights.mostActive) {
    highlightActive.textContent = `${data.highlights.mostActive.player} · ${data.highlights.mostActive.matches} matches (30 days)`;
  } else {
    highlightActive.textContent = '—';
  }
  if (data.highlights.mostImproved) {
    highlightImproved.textContent = `${data.highlights.mostImproved.player} · +${data.highlights.mostImproved.delta}%`;
  } else {
    highlightImproved.textContent = '—';
  }
  if (data.highlights.playerOfWeek) {
    highlightWeek.textContent = `${data.highlights.playerOfWeek.player} · ${data.highlights.playerOfWeek.winPct}% win rate`;
  } else {
    highlightWeek.textContent = '—';
  }

  badgeList.innerHTML = data.badges.length
    ? data.badges.map(badge => `<span class="badge">${escHtml(badge.label)}</span>`).join('')
    : '<span class="empty-msg">No badges yet.</span>';
}

async function refreshAll() {
  await loadLeaderboards();
  await loadRecentMatches();
  await loadPlayers();
  await loadStats();
}

// ── Form handling ───────────────────────────────────────────────────

function toggleDoublesFields() {
  const isDoubles = matchType.value === 'doubles';
  teamA2.hidden = !isDoubles;
  teamB2.hidden = !isDoubles;
  teamA2.required = isDoubles;
  teamB2.required = isDoubles;
}

function resetForm() {
  form.reset();
  editingMatchId = null;
  submitButton.textContent = '+ Record Match';
  cancelEditButton.hidden = true;
  toggleDoublesFields();
}

function fillForm(match) {
  matchType.value = match.matchType;
  winnerTeam.value = match.winnerTeam;
  teamA1.value = match.teamA[0] || '';
  teamA2.value = match.teamA[1] || '';
  teamB1.value = match.teamB[0] || '';
  teamB2.value = match.teamB[1] || '';
  toggleDoublesFields();
  editingMatchId = match.id;
  submitButton.textContent = 'Update Match';
  cancelEditButton.hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('', '');
  const payload = {
    matchType: matchType.value,
    winnerTeam: winnerTeam.value,
    teamA: [teamA1.value, teamA2.value].filter(Boolean),
    teamB: [teamB1.value, teamB2.value].filter(Boolean)
  };

  try {
    let data;
    if (editingMatchId) {
      data = await fetchJson(`/api/matches/${editingMatchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setMessage('✅ Match updated.', 'success');
    } else {
      data = await fetchJson('/api/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setMessage('✅ Match recorded!', 'success');
      (data.achievements || []).forEach(showToast);
    }
    resetForm();
    await refreshAll();
  } catch (err) {
    setMessage(err.message || 'Something went wrong.', 'error');
  }
});

matchType.addEventListener('change', toggleDoublesFields);
cancelEditButton.addEventListener('click', () => {
  resetForm();
  setMessage('Edit cancelled.', '');
});

undoButton.addEventListener('click', async () => {
  try {
    await fetchJson('/api/matches/undo', { method: 'POST' });
    setMessage('Last match undone.', 'success');
    await refreshAll();
  } catch (err) {
    setMessage(err.message || 'Unable to undo.', 'error');
  }
});

recentMatches.addEventListener('click', async (event) => {
  const action = event.target.dataset.action;
  const id = Number(event.target.dataset.id);
  if (!action || !id) return;
  const match = recentMatchCache.find(item => item.id === id);
  if (!match) return;

  if (action === 'edit') {
    fillForm(match);
    setMessage('Editing last match. Update and save.', '');
  }
  if (action === 'delete') {
    try {
      await fetchJson(`/api/matches/${id}`, { method: 'DELETE' });
      setMessage('Match deleted.', 'success');
      await refreshAll();
    } catch (err) {
      setMessage(err.message || 'Unable to delete.', 'error');
    }
  }
});

focusPlayer.addEventListener('change', loadStats);
formLength.addEventListener('change', loadStats);
headA.addEventListener('change', () => {
  focusPlayer.value = headA.value;
  loadStats();
});
headB.addEventListener('change', loadStats);

// ── Boot ───────────────────────────────────────────────────────────

toggleDoublesFields();
refreshAll();
