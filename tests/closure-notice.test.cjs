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
  const elements = {};
  const notice = {
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; },
  };
  let now = Date.parse(time);
  runInNewContext(scripts.map(match => match[1]).join('\n'), {
    Date: class extends Date { static now() { return now; } },
    document: {
      getElementById(id) {
        if (id === 'closure-notice') return notice;
        return elements[id] ||= { textContent: '' };
      },
      addEventListener(event, callback) { listeners[event] = callback; },
    },
    setTimeout(callback, delay) { timers.push({ callback, delay }); },
    clearTimeout() {},
  });
  return { notice, elements, timers, listeners, setTime(time) { now = Date.parse(time); } };
}

test('visitors see the closure notice before registration reopens', () => {
  assert.equal(openPage('2026-10-01T12:00:00+02:00').notice.open, true);
});

test('October notice is hidden before its four-week announcement window', () => {
  assert.equal(openPage('2026-09-13T23:59:59.999+02:00').notice.open, false);
});

test('notice remains visible until 08:00 Warsaw time, after the DST change', () => {
  assert.equal(openPage('2026-10-26T06:59:59.999Z').notice.open, true);
});

test('notice stays hidden at and after the reopening time', () => {
  for (const time of ['2026-10-26T07:00:00Z', '2026-11-01T12:00:00Z']) {
    const page = openPage(time);
    assert.equal(page.notice.open, false);
  }
});

test('winter vacation notice shows its dates and approved registration date', () => {
  const page = openPage('2026-11-16T00:00:00+01:00');
  assert.equal(page.notice.open, true);
  assert.equal(page.elements['closure-notice-dates'].textContent, '14.12.2026 – 06.01.2027');
  assert.equal(page.elements['closure-notice-reopens'].textContent, 'od 07.01.2027 od godz. 8:00');
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

test('every notice begins exactly four weeks before closure and expires at registration', () => {
  const windows = [
    ['2026-09-14T00:00:00+02:00', '2026-10-26T08:00:00+01:00', '12.10.2026 – 24.10.2026', '26.10.2026'],
    ['2026-11-16T00:00:00+01:00', '2027-01-07T08:00:00+01:00', '14.12.2026 – 06.01.2027', '07.01.2027'],
    ['2027-04-30T00:00:00+02:00', '2027-06-09T08:00:00+02:00', '28.05.2027 – 07.06.2027', '09.06.2027'],
  ];
  for (const [startsAt, expiresAt, dates, registrationDate] of windows) {
    const start = Date.parse(startsAt);
    const end = Date.parse(expiresAt);
    assert.equal(openPage(new Date(start - 1).toISOString()).notice.open, false);
    const page = openPage(startsAt);
    assert.equal(page.notice.open, true);
    assert.equal(page.elements['closure-notice-dates'].textContent, dates);
    assert.equal(page.elements['closure-notice-reopens'].textContent, `od ${registrationDate} od godz. 8:00`);
    assert.equal(openPage(new Date(end - 1).toISOString()).notice.open, true);
    assert.equal(openPage(expiresAt).notice.open, false);
    assert.equal(openPage(new Date(end + 1).toISOString()).notice.open, false);
  }
});

test('a page left open shows the next notice when its announcement window begins', () => {
  const page = openPage('2026-11-15T23:59:59+01:00');
  assert.equal(page.notice.open, false);
  assert.equal(page.timers[0].delay, 1000);
  page.setTime('2026-11-16T00:00:00+01:00');
  page.timers[0].callback();
  assert.equal(page.notice.open, true);
  assert.equal(page.elements['closure-notice-dates'].textContent, '14.12.2026 – 06.01.2027');
});

test('a returning tab switches from an earlier notice to the current vacation', () => {
  const page = openPage('2026-10-01T12:00:00+02:00');
  page.notice.close();
  page.setTime('2027-05-01T12:00:00+02:00');
  page.listeners.visibilitychange();
  assert.equal(page.notice.open, true);
  assert.equal(page.elements['closure-notice-dates'].textContent, '28.05.2027 – 07.06.2027');
});

test('there are no further timers after the last vacation expires', () => {
  const page = openPage('2027-06-09T08:00:00+02:00');
  assert.equal(page.notice.open, false);
  assert.equal(page.timers.length, 0);
});
