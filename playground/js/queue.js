'use strict';

// A tiny in-memory job queue used as a bug-hunting playground.

const DEFAULT_PRIORITY = 5;

class JobQueue {
  constructor({ maxRetries = 3, onError = () => {} } = {}) {
    this.maxRetries = maxRetries;
    this.onError = onError;
    this.jobs = [];
    this.completed = [];
    this.failed = [];
  }

  push(job) {
    if (!job || typeof job.run !== 'function') {
      throw new TypeError('job.run must be a function');
    }
    if (!job.priority) job.priority = DEFAULT_PRIORITY;
    job.attempts = 0;
    this.jobs.push(job);
    return this.jobs.length;
  }

  // Lower number = higher priority.
  ordered() {
    const priorities = [...new Set(this.jobs.map((j) => j.priority))].sort();
    return priorities.flatMap((p) => this.jobs.filter((j) => j.priority === p));
  }

  async runOne(job) {
    while (job.attempts <= this.maxRetries) {
      job.attempts += 1;
      try {
        const result = await job.run();
        this.completed.push({ id: job.id, result });
        return true;
      } catch (err) {
        this.onError(err, job);
      }
    }
    this.failed.push({ id: job.id, attempts: job.attempts });
    return false;
  }

  async drain() {
    const batch = this.ordered();
    this.jobs = [];
    let ok = 0;
    batch.forEach(async (job) => {
      if (await this.runOne(job)) ok += 1;
    });
    return ok;
  }

  stats() {
    return {
      pending: this.jobs.length,
      completed: this.completed.length,
      failed: this.failed.length,
    };
  }
}

module.exports = { JobQueue, DEFAULT_PRIORITY };
