'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');

const tmpDb = path.join(os.tmpdir(), `shuttle-ops-test-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;

const app = require('../server');

let server;
let baseUrl;

before(() => new Promise(resolve => {
  server = http.createServer(app);
  server.listen(0, '127.0.0.1', () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise(resolve => {
  require('../db/database').closeDb();
  server.close(() => {
    try { fs.unlinkSync(tmpDb); } catch (_) {}
    try { fs.unlinkSync(tmpDb + '-wal'); } catch (_) {}
    try { fs.unlinkSync(tmpDb + '-shm'); } catch (_) {}
    resolve();
  });
}));

async function request(method, path, body) {
  const url = new URL(path, baseUrl);
  const opts = {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {}
  };
  return new Promise((resolve, reject) => {
    const req = http.request(url, opts, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('POST /api/matches', () => {
  test('records a singles match and returns leaderboard', async () => {
    const res = await request('POST', '/api/matches', {
      matchType: 'singles',
      winnerTeam: 'A',
      teamA: ['Alice'],
      teamB: ['Bob']
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.id > 0);
    assert.equal(res.body.match.matchType, 'singles');
    assert.equal(res.body.match.teamA[0], 'Alice');
    assert.equal(res.body.match.teamB[0], 'Bob');
    assert.ok(Array.isArray(res.body.leaderboard));
  });

  test('rejects invalid names', async () => {
    const res = await request('POST', '/api/matches', {
      matchType: 'singles',
      winnerTeam: 'A',
      teamA: ['A'.repeat(51)],
      teamB: ['Bob']
    });
    assert.equal(res.status, 400);
  });
});

describe('Leaderboards', () => {
  test('returns daily leaderboard with rank movement', async () => {
    const res = await request('GET', '/api/leaderboard?range=day', null);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.leaderboard));
    if (res.body.leaderboard.length) {
      assert.ok('rank' in res.body.leaderboard[0]);
      assert.ok('rankDelta' in res.body.leaderboard[0]);
    }
  });

  test('returns weekly, monthly, and all-time leaderboards', async () => {
    const week = await request('GET', '/api/leaderboard?range=week', null);
    const month = await request('GET', '/api/leaderboard?range=month', null);
    const all = await request('GET', '/api/leaderboard?range=all', null);
    assert.equal(week.status, 200);
    assert.equal(month.status, 200);
    assert.equal(all.status, 200);
  });
});

describe('Match maintenance', () => {
  test('updates a match', async () => {
    const create = await request('POST', '/api/matches', {
      matchType: 'singles',
      winnerTeam: 'A',
      teamA: ['Charlie'],
      teamB: ['Dana']
    });
    const id = create.body.id;
    const update = await request('PATCH', `/api/matches/${id}`, {
      matchType: 'singles',
      winnerTeam: 'B',
      teamA: ['Charlie'],
      teamB: ['Dana']
    });
    assert.equal(update.status, 200);
    assert.equal(update.body.match.winnerTeam, 'B');
  });

  test('undoes the last match', async () => {
    const create = await request('POST', '/api/matches', {
      matchType: 'singles',
      winnerTeam: 'A',
      teamA: ['Eli'],
      teamB: ['Finn']
    });
    const undo = await request('POST', '/api/matches/undo', null);
    assert.equal(undo.status, 200);
    assert.equal(undo.body.match.id, create.body.id);
  });

  test('deletes a match', async () => {
    const create = await request('POST', '/api/matches', {
      matchType: 'singles',
      winnerTeam: 'A',
      teamA: ['Gina'],
      teamB: ['Hank']
    });
    const del = await request('DELETE', `/api/matches/${create.body.id}`, null);
    assert.equal(del.status, 200);
  });
});

describe('Stats and players', () => {
  test('returns player list', async () => {
    const res = await request('GET', '/api/players', null);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.players));
  });

  test('returns stats for a player', async () => {
    const res = await request('GET', '/api/stats?player=Alice&opponent=Bob&form=5', null);
    assert.equal(res.status, 200);
    assert.ok(res.body.player);
    assert.ok('winPct' in res.body.player);
  });
});

describe('Static files', () => {
  test('serves index.html', async () => {
    const url = new URL('/', baseUrl);
    const body = await new Promise((resolve, reject) => {
      http.get(url, res => {
        let d = '';
        res.on('data', c => (d += c));
        res.on('end', () => resolve({ status: res.statusCode, text: d }));
      }).on('error', reject);
    });
    assert.equal(body.status, 200);
    assert.ok(body.text.includes('Shuttle-Ops'));
  });
});
