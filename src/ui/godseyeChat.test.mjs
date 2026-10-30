import assert from 'node:assert/strict';
import test from 'node:test';

import { CHAT_ENDPOINT, GodsEyeChat } from './godseyeChat.js';
import { railFixture } from './railTestFixture.mjs';

const ANSWER = {
  ok: true,
  reply: 'Emas naik tipis.',
  lane: 'local',
  model: 'qwen2.5vl:3b',
  redactions: [],
  skills: [
    {
      id: 'vision-scene',
      title: 'Vision scene detection',
      localOnly: true,
      remoteSafe: false,
    },
    {
      id: 'gold-impact',
      title: 'Gold impact on XAUUSD',
      localOnly: false,
      remoteSafe: true,
    },
  ],
};

/** The planted library the console shows before any task is typed. */
const LIBRARY = [
  {
    id: 'vision-scene',
    title: 'Vision scene detection',
    localOnly: true,
    remoteSafe: false,
  },
  {
    id: 'gold-impact',
    title: 'Gold impact on XAUUSD',
    localOnly: false,
    remoteSafe: true,
  },
  {
    id: 'frontend-ui',
    title: 'Frontend and UI build',
    localOnly: false,
    remoteSafe: true,
  },
];

/** Panel siap pakai di atas fixture DOM repo. */
function fixture({ answer = ANSWER, fail = null, withService = true } = {}) {
  const f = railFixture();
  const element = () => f.document.createElement('div');
  const elements = {
    _godseyeChatToggle: f.document.createElement('button'),
    _godseyeChatPanel: f.document.createElement('div'),
    _godseyeChatInput: f.document.createElement('input'),
    _godseyeChatSend: f.document.createElement('button'),
    _godseyeChatLane: f.document.createElement('select'),
    _godseyeChatStatus: element(),
    _godseyeChatMessages: element(),
    _godseyeChatSkills: element(),
  };
  const requests = [];
  const services = withService
    ? {
        godseye: {
          async raw(endpoint, options) {
            requests.push({ endpoint, options });
            if (fail)
              return { ok: false, status: fail.status, data: fail.data };
            return { ok: true, status: 200, data: answer };
          },
          async skills() {
            return { ok: true, status: 200, data: { modules: LIBRARY } };
          },
        },
      }
    : {};
  return {
    ...f,
    elements,
    requests,
    chat: new GodsEyeChat({
      elements,
      services,
      document: f.document,
    }),
  };
}

/** Tunggu satu putaran microtask supaya handler async selesai. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('the panel starts collapsed and the toggle opens and closes it', () => {
  const f = fixture();
  f.chat.connect();
  assert.equal(
    f.elements._godseyeChatPanel.classList.contains('collapsed'),
    true,
  );
  f.elements._godseyeChatToggle.dispatchEvent(new Event('click'));
  assert.equal(
    f.elements._godseyeChatPanel.classList.contains('collapsed'),
    false,
  );
  assert.equal(
    f.elements._godseyeChatPanel.getAttribute('aria-expanded'),
    'true',
  );
  f.elements._godseyeChatToggle.dispatchEvent(new Event('click'));
  assert.equal(
    f.elements._godseyeChatPanel.classList.contains('collapsed'),
    true,
  );
  assert.equal(
    f.elements._godseyeChatPanel.getAttribute('aria-expanded'),
    'false',
  );
});

test('the panel says so when there is nothing yet', () => {
  const f = fixture();
  f.chat.connect();
  assert.equal(f.elements._godseyeChatMessages.children.length, 1);
  assert.equal(
    f.elements._godseyeChatMessages.children[0].textContent,
    'NO MESSAGES YET',
  );
  assert.equal(f.elements._godseyeChatSkills.children.length, 1);
  assert.equal(
    f.elements._godseyeChatSkills.children[0].textContent,
    'NO SKILLS YET',
  );
  assert.equal(f.elements._godseyeChatStatus.textContent, 'IDLE');
});

test('sending a task posts to the chat endpoint and shows the answer', async () => {
  const f = fixture();
  f.chat.connect();
  f.elements._godseyeChatInput.value = 'impact emas sekarang';
  f.elements._godseyeChatSend.dispatchEvent(new Event('click'));
  await settle();

  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].endpoint, CHAT_ENDPOINT);
  const sent = JSON.parse(f.requests[0].options.body);
  assert.equal(sent.message, 'impact emas sekarang');
  assert.equal(sent.lane, 'local');

  const messages = f.elements._godseyeChatMessages.children;
  assert.equal(messages.length, 2);
  assert.equal(messages[0].children[0].textContent, 'YOU');
  assert.equal(messages[0].children[1].textContent, 'impact emas sekarang');
  assert.equal(messages[1].children[0].textContent, 'ASSISTANT');
  assert.equal(messages[1].children[1].textContent, 'Emas naik tipis.');
  assert.equal(f.elements._godseyeChatStatus.textContent, 'IDLE');
  assert.equal(f.elements._godseyeChatInput.value, '');
});

test('the status shows the waiting state while the lane works', async () => {
  const f = fixture();
  f.chat.connect();
  f.elements._godseyeChatInput.value = 'tanya Something';
  f.elements._godseyeChatSend.dispatchEvent(new Event('click'));
  assert.equal(
    f.elements._godseyeChatStatus.textContent,
    'WAITING FOR THE LANE',
  );
  await settle();
  assert.equal(f.elements._godseyeChatStatus.textContent, 'IDLE');
});

test('a failed lane reports the reason in the status line', async () => {
  const f = fixture({
    fail: { status: 502, data: { detail: 'lane is down' } },
  });
  f.chat.connect();
  f.elements._godseyeChatInput.value = 'tanya Something';
  f.elements._godseyeChatSend.dispatchEvent(new Event('click'));
  await settle();
  assert.match(f.elements._godseyeChatStatus.textContent, /ERROR/);
  assert.match(f.elements._godseyeChatStatus.textContent, /lane is down/);
});

test('the active skills are listed with a local-only badge', async () => {
  const f = fixture();
  f.chat.connect();
  await settle();
  f.elements._godseyeChatInput.value = 'tanya Something';
  f.elements._godseyeChatSend.dispatchEvent(new Event('click'));
  await settle();
  const skills = f.elements._godseyeChatSkills.children;
  // The planted library is on screen, and the modules the task used are marked.
  assert.equal(skills.length, 3);
  assert.equal(skills[0].children[0].textContent, 'Vision scene detection');
  assert.equal(skills[0].children[1].textContent, 'LOCAL ONLY');
  assert.equal(skills[0].classList.contains('is-active'), true);
  assert.equal(skills[1].children.length, 2);
  assert.equal(skills[1].children[0].textContent, 'Gold impact on XAUUSD');
  assert.equal(skills[1].classList.contains('is-active'), true);
  assert.equal(skills[2].children.length, 1);
  assert.equal(skills[2].children[0].textContent, 'Frontend and UI build');
  assert.equal(skills[2].classList.contains('is-active'), false);
});

test('the planted library is visible before any task is typed', async () => {
  const f = fixture();
  f.chat.connect();
  await settle();
  const skills = f.elements._godseyeChatSkills.children;
  assert.equal(skills.length, 3);
  assert.equal(skills[0].children[0].textContent, 'Vision scene detection');
  assert.equal(skills[0].classList.contains('is-active'), false);
});

test('an empty task is not sent to the server', async () => {
  const f = fixture();
  f.chat.connect();
  f.elements._godseyeChatInput.value = '   ';
  f.elements._godseyeChatSend.dispatchEvent(new Event('click'));
  await settle();
  assert.equal(f.requests.length, 0);
  assert.match(f.elements._godseyeChatStatus.textContent, /TYPE A TASK FIRST/);
  assert.equal(f.elements._godseyeChatMessages.children.length, 1);
});

test('the chosen lane travels with the task', async () => {
  const f = fixture();
  f.chat.connect();
  f.elements._godseyeChatLane.value = 'kilo';
  f.elements._godseyeChatInput.value = 'ringkaskan emas';
  f.elements._godseyeChatSend.dispatchEvent(new Event('click'));
  await settle();
  assert.equal(JSON.parse(f.requests[0].options.body).lane, 'kilo');
});

test('the enter key sends the task', async () => {
  const f = fixture();
  f.chat.connect();
  f.elements._godseyeChatInput.value = 'ringkaskan emas';
  const event = new Event('keydown');
  event.key = 'Enter';
  f.elements._godseyeChatInput.dispatchEvent(event);
  await settle();
  assert.equal(f.requests.length, 1);
  assert.equal(
    JSON.parse(f.requests[0].options.body).message,
    'ringkaskan emas',
  );
});

test('without an app service the panel falls back to fetch', async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (endpoint, options) => {
    calls.push({ endpoint, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return ANSWER;
      },
    };
  };
  try {
    const f = fixture({ withService: false });
    f.chat.connect();
    f.elements._godseyeChatInput.value = 'tanya Something';
    f.elements._godseyeChatSend.dispatchEvent(new Event('click'));
    await settle();
    // Two calls: the planted library first, then the task itself.
    assert.equal(calls.length, 2);
    const chatCall = calls.find((call) => call.endpoint === CHAT_ENDPOINT);
    assert.ok(chatCall, 'the task goes out over fetch');
    assert.equal(JSON.parse(chatCall.options.body).message, 'tanya Something');
  } finally {
    globalThis.fetch = previous;
  }
});

test('destroying the panel stops it from answering', async () => {
  const f = fixture();
  f.chat.connect();
  f.chat.destroy();
  f.elements._godseyeChatInput.value = 'tanya Something';
  f.elements._godseyeChatSend.dispatchEvent(new Event('click'));
  await settle();
  assert.equal(f.requests.length, 0);
  assert.equal(f.elements._godseyeChatMessages.children.length, 1);
});
