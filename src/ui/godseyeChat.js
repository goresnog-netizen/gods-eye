import { t } from '../i18n/index.js';

/**
 * Panel chat God's Eye.
 *
 * Panel ini tidak punya data sendiri: ia mengetik task ke server
 * (POST /api/godseye/chat), lalu menampilkan status, riwayat pesan, dan
 * daftar skill yang aktif. Server yang memutuskan lane, redaksi privasi,
 * dan isi jawaban.
 */

/** Endpoint chat; Lead mendaftarkannya di src/services/requests.js. */
export const CHAT_ENDPOINT = '/api/godseye/chat';
/** Endpoint daftar modul keahlian yang ditanam. */
export const SKILLS_ENDPOINT = '/api/godseye/skills';

/**
 * Id elemen panel, dipakai kalau pemanggil tidak memberi peta elemen.
 *
 * @type {Readonly<Record<string, string>>}
 */
const ELEMENT_IDS = Object.freeze({
  _godseyeChatToggle: 'godseye-chat-toggle',
  _godseyeChatPanel: 'godseye-chat-panel',
  _godseyeChatInput: 'godseye-chat-input',
  _godseyeChatSend: 'godseye-chat-send',
  _godseyeChatLane: 'godseye-chat-lane',
  _godseyeChatStatus: 'godseye-chat-status',
  _godseyeChatMessages: 'godseye-chat-messages',
  _godseyeChatSkills: 'godseye-chat-skills',
});

/**
 * Judul skill yang bisa diterjemahkan.
 *
 * Judul asli datang dari server; kunci di sini supaya panel bisa
 * menampilkan versi es/ru kalau katalognya sudah diisi.
 *
 * @param {object} skill
 * @returns {string}
 */
export function skillTitle(skill) {
  switch (String(skill?.id || '')) {
    case 'vision-scene':
      return t('Vision scene detection');
    case 'gold-impact':
      return t('Gold impact on XAUUSD');
    case 'place-card':
      return t('Place card and street photo');
    case 'osint-target':
      return t('OSINT and target research');
    case 'web-search':
      return t('Web search through local SearXNG');
    case 'frontend-ui':
      return t('Frontend and UI build');
    case 'local-memory':
      return t('Local memory and audit');
    default:
      return String(skill?.title || '');
  }
}

/**
 * Panel chat: toggle, input, kirim, status, riwayat, dan daftar skill.
 */
export class GodsEyeChat {
  /**
   * @param {object} options
   * @param {object} [options.elements] peta elemen panel
   * @param {object} [options.services] layanan aplikasi
   * @param {Document} [options.document]
   */
  constructor({ elements, services, document: doc } = {}) {
    this.elements = elements || {};
    this.services = services || {};
    this.document = doc || globalThis.document;
    this._resolved = {};
    this._disposed = false;
    this._open = false;
    this._state = 'idle';
    this._messages = [];
    this._skills = [];
    /** Semua modul yang ditanam, dilihat sejak panel dibuka. */
    this._library = [];
    /** Id modul yang dipakai tugas terakhir. */
    this._matched = new Set();
    this._request = null;
  }

  /** Pasang listener dan tampilkan keadaan awal. */
  connect() {
    this._resolved = this._resolveElements();
    const { _godseyeChatToggle, _godseyeChatSend, _godseyeChatInput } =
      this._resolved;
    _godseyeChatToggle?.addEventListener('click', () => this._toggle());
    _godseyeChatSend?.addEventListener('click', () => this._send());
    _godseyeChatInput?.addEventListener('keydown', (event) => {
      if (event?.key !== 'Enter') return;
      event.preventDefault?.();
      this._send();
    });
    this._setOpen(false);
    this._setStatus('idle');
    this._renderMessages();
    this._renderSkills();
    this._loadSkills();
    return this;
  }

  /** Lepas listener dan batalkan permintaan yang berjalan. */
  destroy() {
    this._disposed = true;
    this._request?.abort?.();
    this._request = null;
  }

  /**
   * Ambil elemen dari peta pemanggil, atau dari id di DOM.
   *
   * @returns {Record<string, object|null>}
   */
  _resolveElements() {
    const resolved = {};
    for (const [key, id] of Object.entries(ELEMENT_IDS)) {
      const given = this.elements[key];
      const found = given || this.document?.getElementById?.(id) || null;
      resolved[key] = found;
    }
    return resolved;
  }

  /** Buka atau tutup panel. */
  _toggle() {
    this._setOpen(!this._open);
  }

  /**
   * Buka/tutup panel dan perbarui label tombolnya.
   *
   * @param {boolean} open
   */
  _setOpen(open) {
    const { _godseyeChatPanel, _godseyeChatToggle } = this._resolved;
    if (_godseyeChatPanel) {
      _godseyeChatPanel.classList.toggle('collapsed', !open);
      _godseyeChatPanel.setAttribute('aria-expanded', String(open));
    }
    if (_godseyeChatToggle) {
      const label = open ? t('Close the chat panel') : t('Open the chat panel');
      _godseyeChatToggle.setAttribute('aria-label', label);
      _godseyeChatToggle.setAttribute('title', label);
    }
    this._open = open;
  }

  /**
   * Lane yang dipilih; tanpa pilihan berarti lane privat lokal.
   *
   * @returns {string}
   */
  _lane() {
    const value = String(this._resolved._godseyeChatLane?.value || '').trim();
    return value || 'local';
  }

  /**
   * Status baris: idle, menunggu, atau error.
   *
   * @param {string} state
   * @param {string} [detail]
   */
  _setStatus(state, detail) {
    this._state = state;
    const element = this._resolved._godseyeChatStatus;
    if (!element) return;
    const label =
      state === 'waiting'
        ? t('WAITING FOR THE LANE')
        : state === 'error'
          ? t('ERROR')
          : t('IDLE');
    element.textContent = detail ? `${label} · ${detail}` : label;
  }

  /**
   * Tambahkan satu pesan ke riwayat.
   *
   * @param {string} role
   * @param {string} text
   */
  _pushMessage(role, text) {
    this._messages.push({ role, text });
    this._renderMessages();
  }

  /** Render daftar pesan. */
  _renderMessages() {
    const list = this._resolved._godseyeChatMessages;
    if (!list) return;
    if (!this._messages.length) {
      const empty = this.document.createElement('li');
      empty.className = 'godseye-chat-empty';
      empty.textContent = t('NO MESSAGES YET');
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(
      ...this._messages.map((message) => this._messageNode(message)),
    );
  }

  /**
   * Satu baris pesan.
   *
   * @param {{role:string, text:string}} message
   * @returns {object}
   */
  _messageNode(message) {
    const node = this.document.createElement('li');
    node.className = `godseye-chat-message is-${message.role}`;
    const who = this.document.createElement('span');
    who.className = 'godseye-chat-who';
    who.textContent = message.role === 'user' ? t('YOU') : t('ASSISTANT');
    const body = this.document.createElement('span');
    body.className = 'godseye-chat-text';
    body.textContent = message.text;
    node.append(who, body);
    return node;
  }

  /** Render daftar modul keahlian: seluruh yang ditanam, yang aktif ditandai. */
  _renderSkills() {
    const list = this._resolved._godseyeChatSkills;
    if (!list) return;
    const modules = this._library.length ? this._library : this._skills;
    if (!modules.length) {
      const empty = this.document.createElement('li');
      empty.className = 'godseye-chat-empty';
      empty.textContent = t('NO SKILLS YET');
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...modules.map((skill) => this._skillNode(skill)));
  }

  /**
   * Satu baris skill.
   *
   * @param {object} skill
   * @returns {object}
   */
  _skillNode(skill) {
    const node = this.document.createElement('li');
    node.className = 'godseye-chat-skill';
    const title = this.document.createElement('span');
    title.className = 'godseye-chat-skill-title';
    title.textContent = skillTitle(skill);
    node.append(title);
    if (skill?.localOnly) {
      const badge = this.document.createElement('span');
      badge.className = 'godseye-chat-skill-badge';
      badge.textContent = t('LOCAL ONLY');
      node.append(badge);
    }
    if (this._matched.has(String(skill?.id || ''))) {
      node.classList.add('is-active');
      const badge = this.document.createElement('span');
      badge.className = 'godseye-chat-skill-badge is-active';
      badge.textContent = t('ACTIVE');
      node.append(badge);
    }
    return node;
  }

  /** Kirim pesan user ke server. */
  async _send() {
    if (this._disposed) return;
    const input = this._resolved._godseyeChatInput;
    const message = String(input?.value || '').trim();
    if (!message) {
      this._setStatus('idle', t('TYPE A TASK FIRST'));
      return;
    }
    if (input) input.value = '';
    this._pushMessage('user', message);
    this._setStatus('waiting');
    this._request?.abort?.();
    const controller = new AbortController();
    this._request = controller;
    try {
      const response = await this._post(
        { message, lane: this._lane() },
        controller.signal,
      );
      if (this._disposed) return;
      if (!response.ok) {
        throw new Error(response.data?.detail || `HTTP ${response.status}`);
      }
      const data = response.data || {};
      this._pushMessage('assistant', String(data.reply || ''));
      this._skills = Array.isArray(data.skills) ? data.skills : [];
      this._matched = new Set(
        this._skills.map((skill) => String(skill?.id || '')),
      );
      this._renderSkills();
      this._setStatus('idle');
    } catch (error) {
      if (this._disposed) return;
      this._setStatus('error', error?.message || t('ERROR'));
    }
  }

  /**
   * Panggil endpoint chat lewat layanan aplikasi, atau fetch langsung.
   *
   * @param {object} payload
   * @param {AbortSignal} [signal]
   * @returns {Promise<{ok:boolean, status:number, data:object|null}>}
   */
  async _post(payload, signal) {
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    };
    const service = this.services?.godseye;
    if (service?.raw) return service.raw(CHAT_ENDPOINT, options);
    const response = await fetch(CHAT_ENDPOINT, {
      ...options,
      redirect: 'error',
      headers: { Accept: 'application/json', ...options.headers },
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      /* Status tetap otoritatif untuk error non-JSON. */
    }
    return { ok: response.ok, status: response.status, data };
  }

  /**
   * Muat daftar modul keahlian yang ditanam.
   *
   * Pustaka ini terlihat sebelum ada tugas: operator melihat kemampuan yang
   * tersedia tanpa harus menebak.
   *
   * @returns {Promise<void>}
   */
  async _loadSkills() {
    if (this._disposed) return;
    try {
      const service = this.services?.godseye;
      // The app service answers with the body itself, a plain fetch with the
      // whole envelope; both shapes are accepted here.
      const raw = service?.skills
        ? await service.skills()
        : await fetch(SKILLS_ENDPOINT, {
            redirect: 'error',
            headers: { Accept: 'application/json' },
          }).then((result) => result.json().catch(() => null));
      if (this._disposed) return;
      const modules = Array.isArray(raw?.modules)
        ? raw.modules
        : Array.isArray(raw?.data?.modules)
          ? raw.data.modules
          : null;
      if (!modules) return;
      this._library = modules;
      this._renderSkills();
    } catch {
      /* Pustaka hilang bukan alasan panel harus gagal. */
    }
  }
}
