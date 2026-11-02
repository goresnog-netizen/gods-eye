import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  IMAGE_PLACEHOLDER,
  createAuditWriter,
  relativeZone,
  sanitizeForOutbound,
} from './privacy.js';
import {
  SKILL_MODULES,
  loadSkillLibrary,
  matchSkills,
  renderSkillContext,
} from './skill-library.js';
import {
  FALLBACK_FREE_MODELS,
  KILO_CHAT_URL,
  ZEN_CHAT_URL,
  chatComplete,
  clearModelCache,
  listLanes,
  localChatUrl,
  parseModelIds,
  readOpenAiAnswer,
} from './llm-lanes.js';
import { handleChat, normalizeLane, sceneDescriptor } from './chat.js';

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Folder sementara untuk berkas yang ditulis modul. */
function scratch(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gev-chat-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Transport palsu: mencatat panggilan, tidak pernah menyentuh jaringan. */
function fakeTransport(responder) {
  const calls = [];
  return {
    calls,
    async request(url, options = {}) {
      calls.push({ url, ...options });
      return responder(url, options, calls.length - 1);
    },
  };
}

/** Objek res palsu yang menangkap status dan body. */
function fakeRes() {
  const captured = { status: 0, body: '', headers: {} };
  return {
    captured,
    set statusCode(value) {
      captured.status = value;
    },
    get statusCode() {
      return captured.status;
    },
    setHeader(key, value) {
      captured.headers[key] = value;
    },
    end(body) {
      captured.body = body;
    },
    json() {
      return JSON.parse(captured.body);
    },
  };
}

/** Request palsu: stream yang carries body JSON. */
function fakeRequest(body, method = 'POST') {
  const request = new PassThrough();
  request.method = method;
  request.end(typeof body === 'string' ? body : JSON.stringify(body));
  return request;
}

test('the privacy guard strips the image and replaces the boxes with synthetic data', () => {
  const records = [];
  const payload = {
    image: PNG_DATA_URL,
    description: 'A man in a red jacket standing next to a car',
    lat: 40.41678,
    lon: -3.70351,
    detections: {
      people: [
        {
          id: 'real-person-id',
          bbox: [0.11, 0.22, 0.33, 0.44],
          activity: 'standing',
          holding: ['phone'],
          confidence: 0.91,
        },
      ],
      vehicles: [
        { id: 'real-car-id', bbox: [0.62, 0.12, 0.2, 0.2], type: 'car' },
      ],
    },
  };
  const { payload: clean, redactions } = sanitizeForOutbound(payload, {
    lane: 'kilo',
    purpose: 'chat',
    writer: (record) => records.push(record),
  });
  const serialized = JSON.stringify(clean);

  // Tidak ada byte gambar yang lolos.
  assert.doesNotMatch(serialized, /iVBORw0KGgo/);
  assert.doesNotMatch(serialized, /base64,/);
  assert.equal(clean.image, IMAGE_PLACEHOLDER);

  // Tidak ada koordinat absolut yang lolos.
  assert.doesNotMatch(serialized, /40\.41678/);
  assert.doesNotMatch(serialized, /-3\.70351/);
  assert.doesNotMatch(serialized, /0\.11/);
  assert.equal(clean.lat, null);
  assert.equal(clean.lon, null);

  // Yang tersisa: jumlah orang, label aktivitas, zona relatif, id sintetis.
  assert.equal(clean.detections.people.length, 1);
  assert.equal(clean.detections.people[0].id, 'person-1');
  assert.equal(clean.detections.people[0].activity, 'standing');
  assert.equal(clean.detections.people[0].zone, 'left');
  assert.equal(clean.detections.vehicles[0].id, 'vehicle-1');
  assert.equal(clean.detections.vehicles[0].zone, 'right');
  assert.match(clean.description, /^Scene summary:/);
  assert.doesNotMatch(clean.description, /red jacket/);

  // Redaksi tercatat.
  const byCategory = Object.fromEntries(
    redactions.map((entry) => [entry.category, entry.count]),
  );
  assert.equal(byCategory.image, 1);
  assert.equal(byCategory.vision_description, 1);
  assert.ok(byCategory.precise_location >= 2);
  assert.equal(records.length, 1);
  assert.equal(records[0].lane, 'kilo');
  assert.equal(records[0].purpose, 'chat');
  assert.deepEqual(records[0].redactions, redactions);

  // Payload input tidak boleh berubah.
  assert.equal(payload.image, PNG_DATA_URL);
  assert.equal(payload.detections.people[0].id, 'real-person-id');
  assert.deepEqual(payload.detections.people[0].bbox, [0.11, 0.22, 0.33, 0.44]);
  assert.equal(payload.lat, 40.41678);
});

test('the local lane keeps the image bytes but still drops the geometry', () => {
  const { payload: clean, redactions } = sanitizeForOutbound(
    {
      image: PNG_DATA_URL,
      detections: { people: [{ bbox: [0.11, 0.2, 0.2, 0.3] }] },
    },
    { lane: 'local', writer: null },
  );
  assert.equal(clean.image, PNG_DATA_URL);
  assert.equal(clean.detections.people[0].zone, 'left');
  assert.doesNotMatch(JSON.stringify(clean), /0\.11/);
  const byCategory = Object.fromEntries(
    redactions.map((entry) => [entry.category, entry.count]),
  );
  assert.equal(byCategory.image, 1);
  assert.ok(byCategory.precise_location >= 1);
});

test('the audit writer appends one JSON line per redaction', (t) => {
  const dir = scratch(t);
  const file = path.join(dir, 'privacy-audit.jsonl');
  const writer = createAuditWriter(file);
  writer({ at: 1, lane: 'kilo', purpose: 'chat', redactions: [] });
  writer({ at: 2, lane: 'local', purpose: 'chat', redactions: [] });
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).lane, 'kilo');
  assert.equal(JSON.parse(lines[1]).lane, 'local');
});

test('the relative zone follows the box centre', () => {
  assert.equal(relativeZone({ bbox: [0.0, 0.0, 0.2, 0.2] }), 'left');
  assert.equal(relativeZone({ bbox: [0.4, 0.0, 0.2, 0.2] }), 'center');
  assert.equal(relativeZone({ bbox: [0.8, 0.0, 0.2, 0.2] }), 'right');
  assert.equal(relativeZone({ bbox: [12, 40, 20, 20] }), 'center');
  assert.equal(relativeZone({}), 'center');
});

test('the skill library plants the real modules of this project', () => {
  const ids = SKILL_MODULES.map((module) => module.id);
  assert.deepEqual(ids, [
    'vision-scene',
    'gold-impact',
    'place-card',
    'osint-target',
    'web-search',
    'frontend-ui',
    'local-memory',
  ]);
  for (const module of SKILL_MODULES) {
    assert.equal(typeof module.title, 'string');
    assert.ok(module.title.length > 0);
    assert.equal(typeof module.localOnly, 'boolean');
    assert.equal(typeof module.remoteSafe, 'boolean');
    assert.ok(module.modules.length > 0);
  }
  const localOnly = SKILL_MODULES.filter((module) => module.localOnly).map(
    (m) => m.id,
  );
  assert.deepEqual(localOnly, [
    'vision-scene',
    'osint-target',
    'web-search',
    'local-memory',
  ]);
  const context = renderSkillContext();
  assert.match(context, /PLANTED SKILL MODULES:/);
  assert.match(context, /gold-impact \| Gold impact on XAUUSD/);
});

test('the skill library is written once and read back from disk', async (t) => {
  const dir = scratch(t);
  const file = path.join(dir, 'skill-library.json');
  const first = await loadSkillLibrary({ filePath: file });
  assert.equal(first.modules.length, 7);
  const written = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(written.version, first.version);
  assert.equal(written.modules.length, 7);

  // Berkas yang sudah ada jadi sumber kebenaran: pustaka tidak ditulis ulang.
  writeFileSync(file, JSON.stringify({ ...written, marker: 'kept' }));
  const second = await loadSkillLibrary({ filePath: file });
  assert.equal(second.marker, 'kept');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).marker, 'kept');
});

test('a task is matched to the skill modules it needs', async (t) => {
  const dir = scratch(t);
  const library = await loadSkillLibrary({
    filePath: path.join(dir, 'skill-library.json'),
  });
  assert.deepEqual(
    matchSkills('apa impact emas XAUUSD hari ini?', library).map((m) => m.id),
    ['gold-impact'],
  );
  assert.deepEqual(
    matchSkills('deteksi orang dan aktivitas di kamera ini', library).map(
      (m) => m.id,
    ),
    ['vision-scene'],
  );
  assert.deepEqual(matchSkills('halo, apa kabar?', library), []);
});

test('the lane list names the three lanes', () => {
  assert.deepEqual(
    listLanes().map((lane) => lane.id),
    ['local', 'kilo', 'zen'],
  );
  assert.equal(listLanes().find((lane) => lane.id === 'local').local, true);
  assert.equal(listLanes().find((lane) => lane.id === 'kilo').auth, 'keyless');
});

test('the local lane posts to the native Ollama chat endpoint', async () => {
  const transport = fakeTransport(async () => ({
    status: 200,
    body:
      '{"message":{"content":"Hello"}}\n' +
      '{"message":{"content":" there"},"done":true,"prompt_eval_count":12,"eval_count":5}\n',
  }));
  const answer = await chatComplete({
    lane: 'local',
    messages: [{ role: 'user', content: 'hi' }],
    transport,
    environment: {},
  });
  assert.equal(transport.calls.length, 1);
  assert.equal(transport.calls[0].url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(transport.calls[0].body.model, 'qwen2.5vl:3b');
  assert.equal(answer.ok, true);
  assert.equal(answer.text, 'Hello there');
  assert.equal(answer.usage.total_tokens, 17);
  assert.equal(
    localChatUrl({ GEV_VISION_BASE_URL: 'http://box:11434/v1' }),
    'http://box:11434/api/chat',
  );
});

test('the local lane carries the image bytes to the model', async () => {
  const transport = fakeTransport(async () => ({
    status: 200,
    body: '{"message":{"content":"ok"}}',
  }));
  await chatComplete({
    lane: 'local',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'apa ini' },
          { type: 'image_url', image_url: { url: PNG_DATA_URL } },
        ],
      },
    ],
    transport,
    environment: {},
  });
  const sent = transport.calls[0].body.messages[0];
  assert.equal(sent.content, 'apa ini');
  assert.equal(sent.images.length, 1);
  assert.match(sent.images[0], /^iVBORw0KGgo/);
});

test('the kilo lane is keyless and the zen lane uses the public placeholder', async () => {
  const transport = fakeTransport(async () => ({
    status: 200,
    body: '{"choices":[{"message":{"content":"halo"}}],"usage":{"prompt_tokens":3}}',
  }));
  const kilo = await chatComplete({
    lane: 'kilo',
    model: 'kilo-auto/free',
    messages: [{ role: 'user', content: 'hi' }],
    transport,
  });
  assert.equal(transport.calls[0].url, KILO_CHAT_URL);
  assert.equal(transport.calls[0].headers.Authorization, undefined);
  assert.equal(kilo.ok, true);
  assert.equal(kilo.text, 'halo');

  const zen = await chatComplete({
    lane: 'zen',
    model: 'big-pickle',
    messages: [{ role: 'user', content: 'hi' }],
    transport,
  });
  assert.equal(transport.calls[1].url, ZEN_CHAT_URL);
  assert.equal(transport.calls[1].headers.Authorization, 'Bearer public');
  assert.equal(zen.ok, true);
});

test('model discovery reads the free models and falls back when it fails', async () => {
  clearModelCache();
  const transport = fakeTransport(async (url) => {
    if (url.includes('/models')) {
      return {
        status: 200,
        body: JSON.stringify({
          data: [
            { id: 'paid/model-1' },
            { id: 'kilo-auto/free' },
            { id: 'vendor/model:free' },
          ],
        }),
      };
    }
    return { status: 200, body: '{"choices":[{"message":{"content":"x"}}]}' };
  });
  const answer = await chatComplete({
    lane: 'kilo',
    messages: [{ role: 'user', content: 'hi' }],
    transport,
  });
  assert.equal(answer.model, 'kilo-auto/free');
  assert.equal(transport.calls.length, 2);

  clearModelCache();
  const failing = fakeTransport(async () => ({ status: 503, body: 'down' }));
  const fallback = await chatComplete({
    lane: 'zen',
    messages: [{ role: 'user', content: 'hi' }],
    transport: failing,
  });
  assert.equal(fallback.ok, false);
  assert.equal(fallback.model, FALLBACK_FREE_MODELS.zen[0]);
  clearModelCache();
});

test('the model catalog parser keeps only the free lane', () => {
  const ids = parseModelIds(
    JSON.stringify({
      data: [
        { id: 'paid/one' },
        { id: 'big-pickle' },
        { id: 'x:free' },
        { id: 'y-free' },
      ],
    }),
    'zen',
  );
  assert.deepEqual(ids, ['big-pickle', 'x:free', 'y-free']);
  assert.deepEqual(parseModelIds('not json', 'kilo'), []);
});

test('the OpenAI answer reader understands JSON, NDJSON and SSE', () => {
  assert.equal(
    readOpenAiAnswer('{"choices":[{"message":{"content":"one"}}]}').text,
    'one',
  );
  assert.equal(
    readOpenAiAnswer(
      '{"choices":[{"delta":{"content":"a"}}]}\n{"choices":[{"delta":{"content":"b"}}]}',
    ).text,
    'ab',
  );
  assert.equal(
    readOpenAiAnswer(
      'data: {"choices":[{"delta":{"content":"s"}}]}\n\ndata: [DONE]',
    ).text,
    's',
  );
  assert.equal(readOpenAiAnswer('').text, '');
});

test('the chat handler answers a normal task and writes the history', async (t) => {
  const dir = scratch(t);
  const transport = fakeTransport(async () => ({
    status: 200,
    body: '{"message":{"content":"Emas naik"},"done":true}',
  }));
  const res = fakeRes();
  await handleChat(
    fakeRequest({ message: 'impact emas XAUUSD sekarang' }),
    res,
    {
      transport,
      environment: {},
      writer: null,
      historyPath: path.join(dir, 'chat-history.jsonl'),
      libraryPath: path.join(dir, 'skill-library.json'),
    },
  );
  const body = res.json();
  assert.equal(res.captured.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.reply, 'Emas naik');
  assert.equal(body.lane, 'local');
  assert.equal(body.model, 'qwen2.5vl:3b');
  assert.equal(body.skills.length, 7);
  assert.deepEqual(body.required, ['gold-impact']);
  const sent = transport.calls[0].body.messages;
  assert.match(sent[0].content, /PLANTED SKILL MODULES:/);
  assert.match(sent[0].content, /PRIVACY RULES:/);
  assert.equal(sent[1].content, 'impact emas XAUUSD sekarang');
  const history = readFileSync(path.join(dir, 'chat-history.jsonl'), 'utf8')
    .trim()
    .split('\n');
  assert.equal(history.length, 2);
  assert.equal(JSON.parse(history[0]).role, 'user');
  assert.equal(JSON.parse(history[1]).role, 'assistant');
});

test('a local-only task on a remote lane is refused in clear words', async (t) => {
  const dir = scratch(t);
  const transport = fakeTransport(async () => ({
    status: 200,
    body: '{"choices":[{"message":{"content":"should not happen"}}]}',
  }));
  const res = fakeRes();
  await handleChat(
    fakeRequest({ message: 'deteksi orang di kamera ini', lane: 'kilo' }),
    res,
    {
      transport,
      environment: {},
      writer: null,
      historyPath: path.join(dir, 'chat-history.jsonl'),
      libraryPath: path.join(dir, 'skill-library.json'),
    },
  );
  const body = res.json();
  assert.equal(res.captured.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.error, 'local_only_skill');
  assert.deepEqual(body.blocked, ['vision-scene']);
  assert.match(body.reply, /local-only skill vision-scene/);
  assert.equal(transport.calls.length, 0);
});

test('a remote lane never receives the image bytes', async (t) => {
  const dir = scratch(t);
  const transport = fakeTransport(async (url) => {
    if (url.includes('/models')) {
      return {
        status: 200,
        body: JSON.stringify({ data: [{ id: 'big-pickle' }] }),
      };
    }
    return { status: 200, body: '{"choices":[{"message":{"content":"ok"}}]}' };
  });
  const res = fakeRes();
  await handleChat(
    fakeRequest({
      message: 'ringkaskan adegan ini',
      lane: 'zen',
      scene: {
        image: PNG_DATA_URL,
        detections: {
          people: [
            { id: 'p1', bbox: [0.11, 0.2, 0.2, 0.3], activity: 'walking' },
          ],
        },
      },
    }),
    res,
    {
      transport,
      environment: {},
      writer: null,
      historyPath: path.join(dir, 'chat-history.jsonl'),
      libraryPath: path.join(dir, 'skill-library.json'),
    },
  );
  const body = res.json();
  assert.equal(body.ok, true);
  const chatCall = transport.calls.find((call) => call.url === ZEN_CHAT_URL);
  assert.ok(chatCall, 'the chat request reached the zen lane');
  const sent = JSON.stringify(chatCall.body.messages);
  assert.doesNotMatch(sent, /iVBORw0KGgo/);
  assert.doesNotMatch(sent, /0\.11/);
  assert.match(sent, /SYNTHETIC SCENE DESCRIPTOR/);
  assert.match(sent, /zone\\":\\"left/);
  const byCategory = Object.fromEntries(
    body.redactions.map((entry) => [entry.category, entry.count]),
  );
  assert.equal(byCategory.image, 1);
  assert.ok(byCategory.precise_location >= 1);
});

test('the handler rejects a missing message and a wrong method', async (t) => {
  const dir = scratch(t);
  const options = {
    transport: fakeTransport(async () => ({ status: 200, body: '{}' })),
    environment: {},
    writer: null,
    historyPath: path.join(dir, 'chat-history.jsonl'),
    libraryPath: path.join(dir, 'skill-library.json'),
  };
  const empty = fakeRes();
  await handleChat(fakeRequest({ message: '   ' }), empty, options);
  assert.equal(empty.captured.status, 400);
  assert.equal(empty.json().error, 'message_required');

  const wrongMethod = fakeRes();
  await handleChat(fakeRequest({}, 'GET'), wrongMethod, options);
  assert.equal(wrongMethod.captured.status, 405);
  assert.equal(wrongMethod.json().error, 'method_not_allowed');
});

test('the scene descriptor keeps only counts, labels and zones', () => {
  const descriptor = sceneDescriptor({
    detections: {
      people: [
        { id: 'person-1', activity: 'standing', zone: 'left' },
        { id: 'person-2', activity: 'sitting', zone: 'right' },
      ],
      vehicles: [],
    },
  });
  assert.equal(descriptor.personCount, 2);
  assert.equal(descriptor.vehicleCount, 0);
  assert.equal(descriptor.people[0].zone, 'left');
  assert.equal(sceneDescriptor(null), null);
});

test('an unknown lane falls back to the private local lane', () => {
  assert.equal(normalizeLane('kilo'), 'kilo');
  assert.equal(normalizeLane(' ZEN '), 'zen');
  assert.equal(normalizeLane('remote'), 'local');
  assert.equal(normalizeLane(undefined), 'local');
});

test('the chat lane prefers GEV_CHAT_MODEL over the vision model', async () => {
  const { localModel } = await import('./llm-lanes.js');
  assert.equal(
    localModel({
      GEV_CHAT_MODEL: 'gemma4-e4b',
      GEV_VISION_MODEL: 'qwen2.5vl:3b',
    }),
    'gemma4-e4b',
    'text chat must not be answered by the vision model',
  );
  assert.equal(
    localModel({ GEV_VISION_MODEL: 'qwen2.5vl:3b' }),
    'qwen2.5vl:3b',
    'an old install with only the vision variable still works',
  );
  assert.equal(localModel({}), 'qwen2.5vl:3b');
});
