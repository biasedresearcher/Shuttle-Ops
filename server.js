'use strict';

const express   = require('express');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate-limit the API: max 60 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

app.use('/api', apiLimiter, require('./routes/scores'));

// Light rate limit for static HTML responses
const pageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests, please try again later.'
});

// Serve index.html for any non-API route (SPA-style)
app.get('*', pageLimiter, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

/* istanbul ignore next */
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Shuttle-Ops running on http://localhost:${PORT}`);
  });
}

module.exports = app;
