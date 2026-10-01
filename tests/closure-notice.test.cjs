const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { pathToFileURL } = require('node:url');

// Exercise the page's script through the browser interfaces it uses.
function openPage(time) {
  const html = readFileSync(new URL('../index.html', pathToFileURL(__filename)), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const listeners = {};
  const timers = [];
  const notice = {
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; },
  };
  let now = Date.parse(time);
  runInNewContext(scripts.map(match => match[1]).join('\n'), {
    Date: class extends Date { static now() { return now; } },
    document: {
      getElementById() { return notice; },
      addEventListener(event, callback) { listeners[event] = callback; },
    },
    setTimeout(callback, delay) { timers.push({ callback, delay }); },
  });
  return { notice, timers, listeners, setTime(time) { now = Date.parse(time); } };
}

test('visitors see the closure notice before registration reopens', () => {
  assert.equal(openPage('2026-10-01T12:00:00+02:00').notice.open, true);
});

test('notice remains visible until 08:00 Warsaw time, after the DST change', () => {
  assert.equal(openPage('2026-10-26T06:59:59.999Z').notice.open, true);
});

test('notice stays hidden at and after the reopening time', () => {
  for (const time of ['2026-10-26T07:00:00Z', '2026-11-01T12:00:00Z']) {
    const page = openPage(time);
    assert.equal(page.notice.open, false);
    assert.equal(page.timers.length, 0);
  }
});

test('an already-open page hides the notice exactly at reopening', () => {
  const page = openPage('2026-10-26T06:59:59Z');
  assert.equal(page.timers[0].delay, 1000);
  page.setTime('2026-10-26T07:00:00Z');
  page.timers[0].callback();
  assert.equal(page.notice.open, false);
});

test('returning to a suspended tab hides an expired notice', () => {
  const page = openPage('2026-10-01T12:00:00+02:00');
  assert.ok(page.timers[0].delay <= 86400000);
  page.setTime('2026-10-26T08:00:00+01:00');
  page.listeners.visibilitychange();
  assert.equal(page.notice.open, false);
});

test('expiry checks do not reopen a dismissed notice', () => {
  const page = openPage('2026-10-01T12:00:00+02:00');
  page.notice.close();
  page.timers[0].callback();
  assert.equal(page.notice.open, false);
});
