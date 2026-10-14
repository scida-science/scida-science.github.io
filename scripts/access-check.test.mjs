import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../public/access-check.html', import.meta.url), 'utf8');
const api = 'https://scida-api.scida-website.workers.dev';
const token = 'T'.repeat(43); // Synthetic tab session; never sent to a real service.
const pages = [];
afterEach(() => { for (const page of pages.splice(0)) page.window.close(); });

function page({ role = 'Reader', session = true, execute = true, status = 403, failFirst = false, timeout = false } = {}) {
  const calls = [];
  const sessionValue = JSON.stringify({ token, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  const dom = new JSDOM(html, {
    url: 'https://scida-science.github.io/access-check.html',
    runScripts: execute ? 'dangerously' : 'outside-only',
    beforeParse(window) {
      window.AbortController = AbortController;
      if (timeout) {
        const originalTimeout = window.setTimeout.bind(window);
        window.setTimeout = (callback, delay, ...args) => originalTimeout(callback, delay === 30_000 ? 0 : delay, ...args);
      }
      if (session) window.sessionStorage.setItem('scida.session.v1', sessionValue);
      window.fetch = async (url, init) => {
        calls.push({ url, init });
        if (timeout) return new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('PRIVATE_ABORT_DETAILS')), { once: true });
        });
        if (failFirst && calls.length === 1) throw new Error('PRIVATE_NETWORK_DETAILS');
        if (url === api + '/v1/portal') return Response.json({
          user: { role, approvedTopics: role === 'Reviewer' ? ['bandit-theory'] : [] },
          state: { discoveries: [{ id: 'AST-001', version: 'v0.1', field: 'Astronomy', topic: 'time-domain-astronomy' }] },
        });
        return new Response('PRIVATE_RESPONSE_DETAILS', { status });
      };
    },
  });
  pages.push(dom);
  return {
    window: dom.window,
    document: dom.window.document,
    calls,
    sessionValue,
    async settle() {
      for (let attempt = 0; attempt < 200 && dom.window.document.getElementById('run').disabled; attempt++)
        await new Promise(resolve => setTimeout(resolve, 2));
      expect(dom.window.document.getElementById('run').disabled).toBe(false);
    },
  };
}

describe('temporary live access verification page', () => {
  it.each(['Reader', 'Reviewer'])('automatically checks the %s account without printing credentials or modifying its session', async role => {
    const current = page({ role });
    await current.settle();
    expect(current.calls).toHaveLength(4);
    expect(current.document.getElementById('account').textContent).toBe('Current account: ' + role);
    expect(current.document.getElementById('message').textContent).toContain('All three checks passed');
    expect(current.document.querySelectorAll('.pass')).toHaveLength(3);
    expect(current.document.getElementById('script-help').hidden).toBe(true);
    expect(current.window.sessionStorage.getItem('scida.session.v1')).toBe(current.sessionValue);
    for (const { url, init } of current.calls) {
      expect(url.startsWith(api + '/v1/')).toBe(true);
      expect(init.headers.Authorization).toBe('Bearer ' + token);
      expect(init.credentials).toBe('omit');
      expect(init.redirect).toBe('error');
    }
    expect(current.calls[1].url).toBe(api + '/v1/access/99999999999999999999');
    expect(JSON.parse(current.calls[1].init.body)).toEqual({ role: 'Reader', approvedTopics: [], assignedTopics: [] });
    expect(JSON.parse(current.calls[2].init.body)).toEqual({ discovery: { id: 'AI-001' } });
    expect(JSON.parse(current.calls[3].init.body).input.parentId).toBe('SCIDA-NONEXISTENT-PERMISSION-CHECK');
    expect(current.document.body.textContent).not.toContain(token);
    expect(current.document.body.textContent).not.toContain('PRIVATE_RESPONSE_DETAILS');
  });

  it('explains missing same-tab sign-in without making requests', async () => {
    const current = page({ session: false });
    await current.settle();
    expect(current.calls).toHaveLength(0);
    expect(current.document.getElementById('message').textContent).toContain('same tab');
    expect(current.document.getElementById('results').hidden).toBe(true);
    const order = current.document.getElementById('message').compareDocumentPosition(current.document.getElementById('run'));
    expect(order & current.window.Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it.each(['Admin', 'Approver'])('shows the %s role and prevents permission probes', async role => {
    const current = page({ role });
    await current.settle();
    expect(current.calls).toHaveLength(1);
    expect(current.document.getElementById('account').textContent).toBe('Current account: ' + role);
    expect(current.document.getElementById('message').textContent).toContain('second account');
    expect(current.document.getElementById('results').hidden).toBe(true);
  });

  it('shows unexpected HTTP statuses as failures', async () => {
    const current = page({ status: 400 });
    await current.settle();
    expect(current.document.querySelectorAll('#results .fail')).toHaveLength(3);
    expect(current.document.getElementById('access-result').textContent).toBe('Unexpected · HTTP 400');
    expect(current.document.getElementById('message').textContent).toContain('unexpected result');
  });

  it('allows retry after a network error and prevents concurrent runs', async () => {
    const current = page({ failFirst: true });
    await current.settle();
    expect(current.document.getElementById('message').textContent).toContain('could not complete');
    expect(current.document.body.textContent).not.toContain('PRIVATE_NETWORK_DETAILS');
    const button = current.document.getElementById('run');
    button.click();
    button.dispatchEvent(new current.window.Event('click'));
    await current.settle();
    expect(current.calls).toHaveLength(5);
    expect(current.document.getElementById('message').textContent).toContain('All three checks passed');
  });

  it('uses AbortController to finish timed-out checks safely', async () => {
    const current = page({ timeout: true });
    await current.settle();
    expect(current.calls).toHaveLength(1);
    expect(current.calls[0].init.signal.aborted).toBe(true);
    expect(current.document.getElementById('message').textContent).toContain('could not complete');
    expect(current.document.body.textContent).not.toContain('PRIVATE_ABORT_DETAILS');
  });

  it('has an honest disabled button and instructions when scripts cannot execute', () => {
    const current = page({ execute: false });
    expect(current.calls).toHaveLength(0);
    expect(current.document.getElementById('run').disabled).toBe(true);
    expect(current.document.getElementById('script-help').hidden).toBe(false);
    expect(current.document.getElementById('script-help').textContent).toContain('web browser');
    expect(current.document.querySelector('noscript').textContent).toContain('JavaScript is turned off');
  });
});
