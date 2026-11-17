'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { JobQueue, DEFAULT_PRIORITY } = require('./queue.js');

test('push assigns default priority', () => {
  const q = new JobQueue();
  const job = { id: 'a', run: async () => 1 };
  q.push(job);
  assert.strictEqual(job.priority, DEFAULT_PRIORITY);
});

test('push rejects jobs without run()', () => {
  const q = new JobQueue();
  assert.throws(() => q.push({ id: 'x' }), TypeError);
});

test('ordered groups by priority', () => {
  const q = new JobQueue();
  q.push({ id: 'low', priority: 7, run: async () => 1 });
  q.push({ id: 'high', priority: 2, run: async () => 1 });
  assert.deepStrictEqual(q.ordered().map((j) => j.id), ['high', 'low']);
});
