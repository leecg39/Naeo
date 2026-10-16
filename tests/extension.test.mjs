import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildDraftTransfer, createPkce, EXTENSION_ID, IMAGE_ANCHOR, markerForImage, normalizeServiceBase, parseDraftBlocks, parseMcpToolData, permissionOrigin } from '../extension/shared.js';

test('extension service URL accepts HTTPS and loopback HTTP only', () => {
  assert.equal(normalizeServiceBase('https://www.naeo.kr/'), 'https://www.naeo.kr');
  assert.equal(normalizeServiceBase('http://localhost:62568'), 'http://localhost:62568');
  assert.equal(permissionOrigin('http://127.0.0.1:3000'), 'http://127.0.0.1/*');
  assert.throws(() => normalizeServiceBase('http://example.com'), /HTTPS/);
  assert.throws(() => normalizeServiceBase('https://www.naeo.kr/path'), /루트 주소/);
  assert.throws(() => normalizeServiceBase('https://user:pass@www.naeo.kr'), /루트 주소/);
  assert.match(EXTENSION_ID, /^[a-p]{32}$/);
});

test('manifest public key keeps the documented extension ID stable', () => {
  const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const hex = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
  const id = hex.replace(/[0-9a-f]/g, (digit) => 'abcdefghijklmnop'[Number.parseInt(digit, 16)]);
  assert.equal(id, EXTENSION_ID);
});

test('extension PKCE produces a valid S256 verifier and challenge', async () => {
  const { verifier, challenge } = await createPkce(webcrypto);
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
  const expected = createHash('sha256').update(verifier).digest('base64url');
  assert.equal(challenge, expected);
});

test('draft transfer preserves structure, isolates images and escapes unsafe markup', () => {
  const body = `# 첫 소제목\n\n본문 **강조**와 [링크](https://example.com).\n\n![대표 사진](https://www.naeo.kr/api/images/token)\n\n> 인용문\n\n| 항목 | 값 |\n| --- | --- |\n| A | 1 |\n\n<script>alert(1)</script>`;
  const blocks = parseDraftBlocks(body);
  assert.deepEqual(blocks.map((block) => block.kind), ['heading', 'paragraph', 'image', 'quote', 'table', 'paragraph']);
  assert.equal(markerForImage(0, '대표 사진'), '〔NAEO 사진 1: 대표 사진〕');
  const transfer = buildDraftTransfer({ title: '테스트 글', body });
  assert.deepEqual(transfer.rows.map((row) => row.kind), ['title', 'body', 'heading', 'image']);
  assert.match(transfer.plain, new RegExp(IMAGE_ANCHOR));
  assert.doesNotMatch(transfer.plain, /NAEO 사진/);
  assert.match(transfer.html, /<table>/);
  assert.match(transfer.html, /<blockquote>/);
  assert.match(transfer.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(transfer.html, /<script>/);
  const unsafe = buildDraftTransfer({ title: 'x', body: '[위험](javascript:alert(1))' });
  assert.doesNotMatch(unsafe.html, /href=/);
});

test('only a leading image is treated as the representative and copied before the body', () => {
  const leading = buildDraftTransfer({ title: '대표', body: '![대표](https://example.com/cover.jpg)\n\n# 소제목\n\n본문' });
  assert.deepEqual(leading.rows.map((row) => row.kind), ['title', 'image', 'body', 'heading']);
  assert.equal(leading.rows[1].label, '대표 사진');
  assert.doesNotMatch(leading.plain, /NAEO 사진/);
  const later = buildDraftTransfer({ title: '본문 사진', body: '본문\n\n![중간](https://example.com/inside.jpg)' });
  assert.deepEqual(later.rows.map((row) => row.kind), ['title', 'body', 'image']);
  assert.equal(later.rows[2].label, '사진');
  assert.match(later.plain, new RegExp(IMAGE_ANCHOR));
  assert.equal(later.rows[2].imageAnchorIndex, 0);
});

test('MCP tool responses prefer structured content and surface errors', () => {
  assert.deepEqual(parseMcpToolData({ result: { isError: false, structuredContent: { drafts: [] } } }), { drafts: [] });
  assert.deepEqual(parseMcpToolData({ result: { isError: false, content: [{ type: 'text', text: '{"id":"d1"}' }] } }), { id: 'd1' });
  assert.throws(() => parseMcpToolData({ result: { isError: true, content: [{ type: 'text', text: '권한 없음' }] } }), /권한 없음/);
  assert.throws(() => parseMcpToolData({ error: { message: 'RPC 실패' } }), /RPC 실패/);
});
