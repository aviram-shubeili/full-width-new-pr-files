const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');

const extension = path.resolve(__dirname, '../extension');
const url = 'https://github.com/example/project/pull/42/files?diff=split';

// GitHub's observed four-column split-table structure, including semantic
// hunk ranges. Deliberately include additions-only edits to existing files.
function diff(id, type = 'added', extra = '') {
  const unified = type === 'unified';
  const added = type === 'added';
  const deleted = type === 'deleted';
  const hunk = added || unified ? '@@ -0,0 +1,2 @@' : deleted ? '@@ -1,2 +0,0 @@' : '@@ -10,0 +11,2 @@';
  const left = deleted ? 'blob-code-deletion' : 'blob-code-empty';
  return `<section class="file" id="${id}"><h3>${id}.js</h3>
    <table class="diff-table ${unified ? 'file-diff-unified' : 'file-diff-split'}">
    <thead class="sr-only"><tr><th>Original number</th><th>Original code</th><th>New number</th><th>New code</th></tr></thead>
    <colgroup><col width="40"><col><col width="40"><col></colgroup>
    <tbody><tr><td class="blob-num blob-num-hunk">...</td><td class="blob-code blob-code-hunk" colspan="3">${hunk}</td></tr>
    ${[1, 2].map(n => `<tr><td class="blob-num ${deleted ? 'blob-num-deletion' : 'blob-num-empty empty-cell'}">${deleted ? n : ''}</td>
      <td class="blob-code ${left} ${deleted ? '' : 'empty-cell'}" data-split-side="left">${deleted ? 'old code' : ''}</td>
      <td class="blob-num ${deleted ? 'blob-num-empty' : 'blob-num-addition js-blob-rnum'}" id="${id}R${n}">${deleted ? '' : n}</td>
      <td class="blob-code ${deleted ? 'blob-code-empty' : 'blob-code-addition'}" data-split-side="right"><span class="blob-code-inner"><button class="comment-button" aria-label="Add comment">+</button>const line${n} = 'some readable new code';</span></td></tr>`).join('')}
    ${extra}</tbody></table></section>`;
}

const note = `<tr class="inline-comments"><td class="empty-cell" colspan="2"></td><td class="line-comments" colspan="2"><button id="reply">Reply to review</button><table id="nested"><tbody><tr><td>Nested comment layout</td></tr></tbody></table></td></tr>`;
function modernDiff(id, hunk = '@@ -0,0 +1,2 @@', columns = 4) {
  return `<section class="file" id="${id}"><h3>${id}.js</h3><table data-diff-anchor="${id}" role="grid" class="width-full tableLayoutFixed__test">
    <thead class="sr-only"><tr><th>Original number</th><th>Original code</th><th>New number</th><th>New code</th></tr></thead>
    <colgroup>${columns === 4 ? '<col width="40"><col>' : ''}<col width="40"><col></colgroup><tbody>
    <tr class="diff-line-row"><td class="diff-hunk-cell" colspan="${columns}">${hunk}</td></tr>
    ${[1, 2].map(n => `<tr class="diff-line-row">${columns === 4 ? '<td class="empty-diff-line left-side"></td><td class="empty-diff-line border-right left-side"></td>' : ''}
    <td class="diff-line-number"><code>${n}</code></td><td class="diff-text-cell right-side-diff-cell" data-line-anchor="${id}R${n}">
    <code class="diff-text syntax-highlighted-line addition"><span class="diff-text-marker">+</span><div class="diff-text-inner">const line${n} = 'new code';</div></code>
    <div data-inline-markers="true"><button aria-label="Comment on new line">Comment</button><code class="deletion">Suggestion deletion inside a review</code></div></td></tr>`).join('')}
    </tbody></table></section>`;
}
const fixture = `<!doctype html><html><head><style>
body { margin:32px; font:14px system-ui; } .file { border:1px solid #d0d7de; margin-bottom:24px; border-radius:6px; overflow:hidden; }
h3 { margin:0; padding:16px; background:#f6f8fa; } .diff-table { width:100%; table-layout:fixed; border-collapse:collapse; }
td { padding:5px 10px; vertical-align:top; } .blob-code { width:50%; } .blob-code-inner { white-space:pre-wrap; overflow-wrap:anywhere; font:13px monospace; }
.blob-code-addition { background:#dafbe1; } .blob-num-addition { background:#aceebb; } .blob-code-empty,.blob-num-empty { background:#f6f8fa; }
.blob-code-hunk,.blob-num-hunk { background:#ddf4ff; } .blob-num { text-align:right; } .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); }
.comment-button { margin-right:12px; } #nested { width:100%; } .line-comments { background:#fff8c5; }
table[data-diff-anchor] { width:100%; table-layout:fixed; border-collapse:collapse; } .right-side-diff-cell { width:50%; background:#dafbe1; }
</style></head><body>${diff('new-file', 'added', note)}${diff('existing-file', 'modified')}${diff('deleted-file', 'deleted')}${diff('unified-file', 'unified')}${modernDiff('modern-new')}${modernDiff('modern-existing', '@@ -10,0 +11,2 @@')}${modernDiff('modern-unified', '@@ -0,0 +1,2 @@', 2)}</body></html>`;

async function widths(page, id) {
  return page.locator(`#${id} > table`).evaluate(table => {
    const right = table.querySelector('[data-split-side="right"]');
    return {
      table: table.getBoundingClientRect().width,
      right: right.getBoundingClientRect().width,
      left: table.querySelector('[data-split-side="left"]').getBoundingClientRect().width,
      expanded: table.classList.contains('fwpr-added-file')
    };
  });
}

test('unpacked extension changes rendered GitHub diff widths safely', async t => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'fwpr-test-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://github.com/example/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
    await page.goto(url);
    await page.waitForSelector('#new-file .fwpr-added-file');

    await t.test('new file occupies full width; ordinary diffs keep two panes', async () => {
      const added = await widths(page, 'new-file');
      assert.equal(added.left, 0);
      assert.ok(added.right > added.table * 0.9, JSON.stringify(added));
      for (const id of ['existing-file', 'deleted-file', 'unified-file']) {
        const result = await widths(page, id);
        assert.equal(result.expanded, false, id);
        assert.ok(result.right < result.table * 0.6, id);
      }
    });

    await t.test('comments, line anchors and highlighting survive', async () => {
      const result = await page.locator('#new-file .line-comments').evaluate(cell => ({
        width: cell.getBoundingClientRect().width,
        table: cell.closest('table').getBoundingClientRect().width,
        span: cell.colSpan
      }));
      assert.ok(result.width > result.table * 0.95, JSON.stringify(result));
      assert.equal(result.span, 2);
      assert.equal(await page.locator('#nested .fwpr-empty-left').count(), 0);
      await page.locator('#reply').click();
      await page.locator('#new-file .comment-button').first().click();
      assert.equal(await page.locator('#new-fileR1').textContent(), '1');
      assert.equal(await page.locator('#new-file .blob-code-addition').count(), 2);
    });

    await t.test('React tables expand only new files and preserve inline review controls', async () => {
      const result = await page.locator('#modern-new > table').evaluate(table => ({
        width: table.getBoundingClientRect().width,
        right: table.querySelector('.right-side-diff-cell').getBoundingClientRect().width,
        left: table.querySelector('.empty-diff-line').getBoundingClientRect().width,
        hunkSpan: table.querySelector('.diff-hunk-cell').colSpan
      }));
      assert.equal(result.left, 0);
      assert.ok(result.right > result.width * 0.9, JSON.stringify(result));
      assert.equal(result.hunkSpan, 2);
      assert.equal(await page.locator('#modern-existing .fwpr-added-file, #modern-unified .fwpr-added-file').count(), 0);
      await page.locator('#modern-new button').first().click();
      assert.equal(await page.locator('#modern-new [data-line-anchor="modern-newR1"]').count(), 1);
      await page.locator('#modern-new .diff-hunk-cell').evaluate(cell => { cell.textContent = '@@ -1,2 +1,2 @@'; });
      await page.waitForFunction(() => !document.querySelector('#modern-new > table').classList.contains('fwpr-added-file'));
      assert.equal(await page.locator('#modern-new .diff-hunk-cell').getAttribute('colspan'), '4');
      await page.locator('#modern-new .diff-hunk-cell').evaluate(cell => { cell.textContent = '@@ -0,0 +1,2 @@'; });
      await page.waitForSelector('#modern-new .fwpr-added-file');
    });

    await t.test('late-loaded file and late-loaded review rows expand', async () => {
      await page.evaluate(html => document.body.insertAdjacentHTML('beforeend', html), diff('late-file'));
      await page.waitForSelector('#late-file .fwpr-added-file');
      assert.equal((await widths(page, 'late-file')).left, 0);
      await page.locator('#late-file tbody').evaluate((body, html) => body.insertAdjacentHTML('beforeend', html), note.replaceAll('id=', 'data-test-id='));
      await page.waitForFunction(() => document.querySelector('#late-file .inline-comments .empty-cell').classList.contains('fwpr-empty-left'));
    });

    await t.test('responsive layout and dark theme retain width', async () => {
      await page.setViewportSize({ width: 800, height: 1000 });
      await page.emulateMedia({ colorScheme: 'dark' });
      const result = await widths(page, 'new-file');
      assert.ok(result.right > result.table * 0.9, JSON.stringify(result));
      await page.setViewportSize({ width: 1440, height: 1000 });
    });

    await t.test('view changes restore original spans and reapply cleanly', async () => {
      await page.locator('#new-file > table').evaluate(table => table.classList.replace('file-diff-split', 'file-diff-unified'));
      await page.waitForFunction(() => !document.querySelector('#new-file > table').classList.contains('fwpr-added-file'));
      assert.equal(await page.locator('#new-file .blob-code-hunk').getAttribute('colspan'), '3');
      await page.locator('#new-file > table').evaluate(table => table.classList.replace('file-diff-unified', 'file-diff-split'));
      await page.waitForSelector('#new-file .fwpr-added-file');
      assert.equal((await widths(page, 'new-file')).left, 0);
    });

    await t.test('in-page navigation cleans up and returns to PR automatically', async () => {
      await page.evaluate(() => { history.pushState({}, '', '/example/project/issues'); document.dispatchEvent(new Event('turbo:load')); });
      await page.waitForFunction(() => document.querySelectorAll('.fwpr-added-file').length === 0);
      assert.equal(await page.locator('#new-file .blob-code-hunk').getAttribute('colspan'), '3');
      await page.evaluate(() => { history.pushState({}, '', '/example/project/pull/42/files'); document.dispatchEvent(new Event('turbo:load')); });
      await page.waitForSelector('#new-file .fwpr-added-file');
    });

    await t.test('no repeated self-triggered mutations while page is idle', async () => {
      const count = await page.evaluate(async () => {
        let changes = 0;
        const observer = new MutationObserver(records => { changes += records.length; });
        observer.observe(document.querySelector('#new-file > table'), { attributes: true, childList: true, subtree: true });
        await new Promise(resolve => setTimeout(resolve, 250));
        observer.disconnect();
        return changes;
      });
      assert.equal(count, 0);
      assert.deepEqual(errors, []);
    });

    if (process.env.LIVE_PR) {
      await t.test('live GitHub PR with added and modified files', async () => {
        await page.goto('https://github.com/refined-github/refined-github/pull/10181/files?diff=split');
        await page.waitForSelector('table.fwpr-added-file', { timeout: 30000 });
        const results = await page.locator('table.diff-table').evaluateAll(tables => tables.map(table => ({
          expanded: table.classList.contains('fwpr-added-file'),
          width: table.getBoundingClientRect().width,
          right: table.querySelector('[data-split-side="right"]')?.getBoundingClientRect().width,
          left: table.querySelector('[data-split-side="left"]')?.getBoundingClientRect().width
        })));
        assert.equal(results.filter(result => result.expanded).length, 1);
        const added = results.find(result => result.expanded);
        assert.equal(added.left, 0);
        assert.ok(added.right > added.width * 0.9, JSON.stringify(added));
        assert.ok(results.filter(result => !result.expanded).every(result => result.right < result.width * 0.6));
        await fs.mkdir(path.resolve(__dirname, '../test-results'), { recursive: true });
        await page.locator('table.fwpr-added-file').screenshot({ path: path.resolve(__dirname, '../test-results/live-github.png') });
        console.log('Live widths:', JSON.stringify(results));
      });

      await t.test('live React markup from the corresponding commit on a simulated PR route', async () => {
        await page.goto('https://github.com/refined-github/refined-github/commit/6c88bc3e4d29453d564c0466096ac97341b47529?diff=split');
        await page.waitForSelector('table[data-diff-anchor] .right-side-diff-cell');
        assert.equal(await page.locator('table.fwpr-added-file').count(), 0);
        await page.evaluate(() => {
          history.pushState({}, '', '/refined-github/refined-github/pull/10181/files?diff=split');
          document.dispatchEvent(new Event('turbo:load'));
        });
        await page.waitForSelector('table.fwpr-added-file');
        const result = await page.locator('table.fwpr-added-file').evaluate(table => ({
          width: table.getBoundingClientRect().width,
          right: table.querySelector('.right-side-diff-cell').getBoundingClientRect().width,
          left: table.querySelector('.empty-diff-line').getBoundingClientRect().width,
          hunkSpan: table.querySelector('.diff-hunk-cell').colSpan
        }));
        assert.equal(await page.locator('table.fwpr-added-file').count(), 1);
        assert.equal(result.left, 0);
        assert.ok(result.right > result.width * 0.9, JSON.stringify(result));
        assert.equal(result.hunkSpan, 2);
        await page.locator('table.fwpr-added-file').screenshot({ path: path.resolve(__dirname, '../test-results/live-react.png') });
        console.log('Live React widths:', JSON.stringify(result));
      });
    }
  } finally {
    await context.close();
    // This is an exact mkdtemp directory created above, never a user profile.
    await fs.rm(profile, { recursive: true, force: true });
  }
});
