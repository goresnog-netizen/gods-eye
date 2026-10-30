import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';

import { postJson, readStreamedAnswer } from './vision-request.js';

function echoServer(handler) {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

test('postJson sends the payload and reads the answer', async (t) => {
  const { server, base } = await echoServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ echoed: body.prompt, model: body.model }));
    });
  });
  t.after(() => server.close());
  const { status, body } = await postJson(`${base}/api/chat`, {
    model: 'local',
    prompt: 'hello',
  });
  assert.equal(status, 200);
  assert.equal(JSON.parse(body).echoed, 'hello');
});

test('postJson reports a gateway that never answers', async (t) => {
  const { server, base } = await echoServer(() => {
    /* never answers */
  });
  t.after(() => server.close());
  await assert.rejects(
    postJson(`${base}/api/chat`, { model: 'local' }, { timeoutMs: 60 }),
    /timed out/,
  );
});

test('readStreamedAnswer keeps the cumulative message and the joined deltas', () => {
  const body = [
    JSON.stringify({ message: { role: 'assistant', content: '' }, done: false }),
    JSON.stringify({ message: { role: 'assistant', content: 'first' }, done: false }),
    JSON.stringify({
      message: { role: 'assistant', content: 'first and more' },
      done: true,
      usage: { total_tokens: 42 },
    }),
  ].join('\n');
  const answer = readStreamedAnswer(body);
  assert.equal(answer.cumulative, 'first and more');
  assert.equal(answer.done, true);
  assert.deepEqual(answer.usage, { total_tokens: 42 });
});

test('readStreamedAnswer joins the deltas of a build that streams pieces', () => {
  const body = [
    JSON.stringify({ message: { content: '{"image' }, done: false }),
    JSON.stringify({ message: { content: '_size":[800,' }, done: false }),
    JSON.stringify({ message: { content: '600],"people":[]}' }, done: true }),
  ].join('\n');
  const answer = readStreamedAnswer(body);
  assert.equal(answer.deltas, '{"image_size":[800,600],"people":[]}');
  assert.equal(answer.cumulative, '600],"people":[]}');
});

test('readStreamedAnswer survives a broken line', () => {
  const body = `not json\n${JSON.stringify({
    message: { content: 'kept' },
    done: true,
  })}`;
  const answer = readStreamedAnswer(body);
  assert.equal(answer.cumulative, 'kept');
  assert.equal(answer.deltas, 'kept');
  assert.equal(answer.done, true);
});
