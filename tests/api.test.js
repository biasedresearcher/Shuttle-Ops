'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const os     = require('os');
const fs     = require('fs');

// Use a fresh tmp db for each test run
const tmpDb = path.join(os.tmpdir(), `shuttle-ops-test-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;

// Import server AFTER setting DB_PATH
const app = require('../server');
const http = require('http');

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

// ── helpers ──────────────────────────────────────────────────────────

async function request(method, path, body) {
  const url  = new URL(path, baseUrl);
  const opts = {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {}
  };
  return new Promise((resolve, reject) => {
    const r = http.request(url, opts, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

// ── POST /api/wins ────────────────────────────────────────────────

describe('POST /api/wins', () => {
  test('records a win and returns updated leaderboard', async () => {
    const res = await request('POST', '/api/wins', { player: 'Alice' });
    assert.equal(res.status, 201);
    assert.equal(res.body.player, 'Alice');
    assert.ok(res.body.id > 0);
    assert.ok(Array.isArray(res.body.leaderboard));
    assert.equal(res.body.leaderboard[0].player, 'Alice');
    assert.equal(res.body.leaderboard[0].wins, 1);
  });

  test('accumulates wins for the same player', async () => {
    await request('POST', '/api/wins', { player: 'Bob' });
    await request('POST', '/api/wins', { player: 'Bob' });
    const res = await request('POST', '/api/wins', { player: 'Bob' });
    assert.equal(res.status, 201);
    const bob = res.body.leaderboard.find(r => r.player === 'Bob');
    assert.equal(bob.wins, 3);
  });

  test('returns 400 when player name is missing', async () => {
    const res = await request('POST', '/api/wins', {});
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  test('returns 400 when player name is empty string', async () => {
    const res = await request('POST', '/api/wins', { player: '   ' });
    assert.equal(res.status, 400);
  });

  test('returns 400 when player name exceeds 50 chars', async () => {
    const res = await request('POST', '/api/wins', { player: 'A'.repeat(51) });
    assert.equal(res.status, 400);
  });
});

// ── GET /api/leaderboard ─────────────────────────────────────────

describe('GET /api/leaderboard', () => {
  test('returns leaderboard for today', async () => {
    const res = await request('GET', '/api/leaderboard', null);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.leaderboard));
    assert.ok(res.body.date);
  });

  test('returns empty array for a date with no wins', async () => {
    const res = await request('GET', '/api/leaderboard?date=1999-01-01', null);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.leaderboard, []);
  });
});

// ── GET /api/overall ─────────────────────────────────────────────

describe('GET /api/overall', () => {
  test('returns all-time leaderboard', async () => {
    const res = await request('GET', '/api/overall', null);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.leaderboard));
    assert.ok(res.body.leaderboard.length > 0);
  });
});

// ── GET /api/history ─────────────────────────────────────────────

describe('GET /api/history', () => {
  test('returns history array', async () => {
    const res = await request('GET', '/api/history', null);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.history));
    assert.ok(res.body.history.length > 0);
    assert.ok('win_date' in res.body.history[0]);
    assert.ok('player'   in res.body.history[0]);
    assert.ok('wins'     in res.body.history[0]);
  });
});

// ── Static files ─────────────────────────────────────────────────

describe('Static files', () => {
  test('serves index.html', async () => {
    const url  = new URL('/', baseUrl);
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
