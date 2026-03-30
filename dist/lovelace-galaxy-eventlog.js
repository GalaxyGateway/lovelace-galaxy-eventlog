// Galaxy Gateway — Event Log Card for Home Assistant
// Place in /config/www/lovelace-galaxy-eventlog.js
// Add to resources: /local/lovelace-galaxy-eventlog.js (type: module)

const DEFAULT_SIA_COLORS = [
  { code: 'BA', color: '#ef4444', label: 'Burglary Alarm' },
  { code: 'FA', color: '#f97316', label: 'Fire Alarm' },
  { code: 'PA', color: '#ef4444', label: 'Panic Alarm' },
  { code: 'TA', color: '#f59e0b', label: 'Tamper' },
  { code: 'CA', color: '#22c55e', label: 'Cancel' },
  { code: 'CL', color: '#22c55e', label: 'Closing' },
  { code: 'OP', color: '#3b82f6', label: 'Opening' },
  { code: 'RR', color: '#22c55e', label: 'System Restore' },
];

const SIA_CODES = [
  'BA','BI','BQ','BV','CA','CE','CG','CI','CJ','CL','CP','CQ','CS','CZ',
  'DA','DB','DF','DK','DO','DT','DU','DX','EE','ET','FA','FH','FI','FJ',
  'FK','FL','FQ','FR','FS','FT','FV','FX','GA','GB','GS','HA','HB','HH',
  'HS','HV','IA','IP','IT','JA','JH','JR','JS','JT','KA','KB','KH','KS',
  'KV','LB','LD','LR','LS','LT','LU','LX','MA','MB','MH','MI','MK','MS',
  'MT','MX','NA','NF','NL','NR','NZ','OA','OB','OE','OH','OI','OJ','OK',
  'OL','OM','ON','OP','OR','OS','OT','OV','OX','PA','PH','QA','QR','QS',
  'QT','QX','RA','RB','RC','RF','RJ','RM','RN','RP','RR','RS','RT','RU',
  'SA','SB','SC','TA','TB','TC','TE','TK','TR','TS','TU','TX','UA','UB',
  'US','UT','UX','UY','UZ','VI','VR','XL','XQ','YA','YB','YC','YD','YF',
  'YG','YH','YI','YJ','YK','YL','YM','YN','YO','YP','YQ','YR','YS','YT',
  'YX','ZA','ZB','ZH','ZI','ZS'
];

class GalaxyEventLogCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config        = {};
    this._hass          = null;
    this._events        = [];
    this._fetching      = false;
    this._error         = null;
    this._unsubscribe   = null;   // websocket subscription teardown
    this._subscribedFor = null;   // entity we are currently subscribed to
  }

  setConfig(config) {
    if (!config.entity) throw new Error('entity is required');
    this._config = {
      entity:       config.entity,
      title:        config.title        || 'Event Log',
      max_events:   config.max_events   || 50,
      history_days: config.history_days || 7,
      filter_codes: config.filter_codes || [],
      sia_colors:   config.sia_colors   || DEFAULT_SIA_COLORS,
    };
    // If entity changed, tear down old subscription
    if (this._subscribedFor && this._subscribedFor !== config.entity) {
      this._teardown();
    }
    this._events = [];
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    // Subscribe once per entity — this drives both initial load and live updates
    if (this._config.entity && this._subscribedFor !== this._config.entity) {
      this._subscribe();
    }
  }

  disconnectedCallback() {
    this._teardown();
  }

  _teardown() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe   = null;
      this._subscribedFor = null;
    }
  }

  // ── Subscribe to state_changed for this entity via WS ────────────────────
  // When a new event fires we prepend it immediately without re-fetching
  // the full history — so updates are instant.
  async _subscribe() {
    if (!this._hass || !this._config.entity) return;

    const entity = this._config.entity;
    this._subscribedFor = entity;

    // Initial history load
    this._fetchHistory();

    try {
      // subscribe_trigger gives us new_state the moment it changes
      this._unsubscribe = await this._hass.connection.subscribeMessage(
        (msg) => {
          const newState = msg?.variables?.trigger?.to_state;
          if (!newState) return;
          const attr = newState.attributes || {};
          const code = (attr.code || '').toUpperCase();
          if (!code) return;

          const evtDate = attr.evt_date || attr.date || '';
          const evtTime = attr.evt_time || attr.time
            || (newState.last_changed || '').substring(11, 19);

          const event = {
            date:    evtDate,
            time:    evtTime,
            code,
            account: attr.account || '',
            userid:  attr.userid  || '',
            text:    attr.text    || '',
            area:    attr.area    || '',
            address: attr.address || '',
          };

          // Prepend — deduplicate on date+time+code in case history already has it
          const key = `${evtDate}|${evtTime}|${code}`;
          const alreadyPresent = this._events.some(
            e => `${e.date}|${e.time}|${e.code}` === key
          );
          if (!alreadyPresent) {
            this._events = [event, ...this._events];
            this._render();
          }
        },
        {
          type:    'subscribe_trigger',
          trigger: { platform: 'state', entity_id: entity },
        }
      );
    } catch(e) {
      console.error('GalaxyEventLog: subscribe failed', e);
      // Non-fatal — history was already fetched, live updates just won't work
    }
  }

  // ── Full history load (runs once on subscribe) ────────────────────────────
  async _fetchHistory() {
    if (this._fetching || !this._hass || !this._config.entity) return;
    this._fetching = true;
    this._error    = null;
    this._render();

    try {
      const days  = this._config.history_days || 7;
      const end   = new Date();
      const start = new Date(end - days * 86400 * 1000);

      let states = null;

      // Primary: history WS (HA 2023.3+)
      try {
        const msg = await this._hass.callWS({
          type:                     'history/history_during_period',
          start_time:               start.toISOString(),
          end_time:                 end.toISOString(),
          entity_ids:               [this._config.entity],
          include_start_time_state: true,
          significant_changes_only: false,
          no_attributes:            false,
        });
        const key = Object.keys(msg || {})[0];
        states = key ? msg[key] : null;
      } catch(wsErr) {
        console.warn('GalaxyEventLog: history WS failed, falling back to REST', wsErr);
      }

      // Fallback: REST API
      if (!states) {
        const path = `history/period/${start.toISOString()}?filter_entity_id=${this._config.entity}&minimal_response=false&no_attributes=false&significant_changes_only=false`;
        const raw  = await this._hass.callApi('GET', path);
        const arr  = raw?.[0] || [];
        states = arr.map(s => ({ s: s.state, a: s.attributes || {}, lu: s.last_changed }));
      }

      this._events = this._parseStates(states || []);

    } catch(e) {
      console.error('GalaxyEventLog: history fetch failed', e);
      this._error = e.message || 'Failed to load history';
    } finally {
      this._fetching = false;
      this._render();
    }
  }

  // ── Parse raw state snapshots into event rows ─────────────────────────────
  _parseStates(states) {
    const seen   = new Set();
    const events = [];
    for (let i = states.length - 1; i >= 0; i--) {
      const entry = states[i];
      const attr  = entry.a || entry.attributes || {};
      const code  = (attr.code || '').toUpperCase();
      if (!code) continue;
      const evtDate = attr.evt_date || attr.date || '';
      const evtTime = attr.evt_time || attr.time
        || (entry.lu || entry.last_changed || '').substring(11, 19);
      const key = `${evtDate}|${evtTime}|${code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ date: evtDate, time: evtTime, code,
        account: attr.account || '', userid: attr.userid || '',
        text: attr.text || '', area: attr.area || '', address: attr.address || '' });
    }
    return events;
  }

  _getEvents() {
    let events = this._events || [];
    const fc = this._config.filter_codes;
    if (fc && fc.length > 0) events = events.filter(e => fc.includes(e.code));
    return events.slice(0, this._config.max_events);
  }

  _colorForCode(code) {
    const match = (this._config.sia_colors || []).find(c => c.code === code);
    return match ? match.color : null;
  }
  _isAlarm(code) { return ['BA','FA','PA','HA','JA','TA','DF','DK'].includes(code); }
  _isGood(code)  { return ['CA','CL','CG','RR','RF'].includes(code); }

  _render() {
    const events   = this._getEvents();
    const cfg      = this._config;
    const entity   = this._hass?.states[cfg.entity];
    const notFound = this._hass && cfg.entity && !entity;

    this.shadowRoot.innerHTML = `
<style>
  :host { display: block; }
  .card {
    background: var(--card-background-color, #fff);
    border-radius: 12px; overflow: hidden;
    box-shadow: var(--ha-card-box-shadow, 0 2px 8px rgba(0,0,0,.08));
    border: 1px solid var(--divider-color, #e0e0e0);
  }
  .card-header {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 16px; border-bottom: 1px solid var(--divider-color, #e0e0e0);
  }
  .header-icon {
    width: 28px; height: 28px; background: rgba(59,130,246,.12); border-radius: 7px;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .header-icon svg { width: 15px; height: 15px; }
  .header-title { flex: 1; font-size: 14px; font-weight: 600; color: var(--primary-text-color); }
  .header-count {
    font-size: 11px; color: var(--secondary-text-color);
    background: var(--secondary-background-color, #f5f5f5); padding: 2px 8px; border-radius: 20px;
  }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  thead th {
    padding: 7px 12px; text-align: left; font-size: 10px; font-weight: 600;
    letter-spacing: .05em; text-transform: uppercase; color: var(--secondary-text-color);
    border-bottom: 1px solid var(--divider-color, #e0e0e0);
    background: var(--secondary-background-color, #f5f5f5); white-space: nowrap;
  }
  tbody tr { border-bottom: 1px solid var(--divider-color, #e0e0e0); transition: background .08s; }
  tbody tr:last-child { border-bottom: none; }
  tbody tr:hover { background: var(--secondary-background-color, #f5f5f5); }
  tbody td { padding: 8px 12px; color: var(--secondary-text-color); vertical-align: middle; }
  td.code-cell { font-family: var(--code-font-family, monospace); font-weight: 600; font-size: 11px; white-space: nowrap; }
  td.txt-cell  { color: var(--primary-text-color); max-width: 200px; }
  td.acc-cell  { color: var(--primary-text-color); font-family: monospace; }
  .color-dot {
    display: inline-block; width: 7px; height: 7px;
    border-radius: 50%; margin-right: 5px; vertical-align: middle; flex-shrink: 0;
  }
  .row-alarm { background: rgba(239,68,68,.06); border-left: 3px solid #ef4444 !important; }
  .row-alarm td { color: var(--primary-text-color); }
  .row-good  { background: rgba(34,197,94,.06);  border-left: 3px solid #22c55e !important; }
  .row-good td { color: var(--primary-text-color); }
  .status { padding: 20px 16px; text-align: center; color: var(--secondary-text-color); font-size: 13px; }
  .status.error { color: var(--error-color, #ef4444); }
  .warn {
    padding: 10px 16px; font-size: 12px; color: var(--warning-color, #f59e0b);
    background: rgba(245,158,11,.08); border-bottom: 1px solid var(--divider-color);
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .spinner {
    display: inline-block; width: 16px; height: 16px;
    border: 2px solid var(--divider-color); border-top-color: #3b82f6;
    border-radius: 50%; animation: spin .8s linear infinite; vertical-align: middle; margin-right: 8px;
  }
</style>
<div class="card">
  <div class="card-header">
    <div class="header-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 2Q5 2 5 3L5 21Q5 22 6 22L18 22Q19 22 19 21L19 7L14 2Z"/>
        <polyline points="14 2 14 7 19 7"/>
        <line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="16" y2="15"/>
      </svg>
    </div>
    <span class="header-title">${cfg.title || 'Event Log'}</span>
    <span class="header-count">${this._fetching ? '…' : events.length + ' entr' + (events.length === 1 ? 'y' : 'ies')}</span>
  </div>
  ${notFound ? `<div class="warn">Entity <strong>${cfg.entity}</strong> not found</div>` : ''}
  ${this._error    ? `<div class="status error">&#9888; ${this._error}</div>`
  : this._fetching ? `<div class="status"><span class="spinner"></span>Loading history&#8230;</div>`
  : events.length === 0 ? `<div class="status">No events</div>`
  : `<div class="table-wrap"><table>
      <thead><tr>
        <th>Date</th><th>Time</th><th>Code</th>
        <th>Account</th><th>User</th><th>Area</th><th>Addr</th><th>Event</th>
      </tr></thead>
      <tbody>${events.map(ev => {
        const color    = this._colorForCode(ev.code);
        const alarm    = this._isAlarm(ev.code);
        const good     = this._isGood(ev.code);
        const rowClass = alarm ? 'row-alarm' : good ? 'row-good' : '';
        const dotStyle = color ? `background:${color}` : alarm ? 'background:#ef4444' : good ? 'background:#22c55e' : 'display:none';
        return `<tr class="${rowClass}">
          <td>${ev.date}</td><td>${ev.time}</td>
          <td class="code-cell"><span class="color-dot" style="${dotStyle}"></span>${ev.code}</td>
          <td class="acc-cell">${ev.account}</td>
          <td>${ev.userid}</td><td>${ev.area}</td><td>${ev.address}</td>
          <td class="txt-cell">${ev.text}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`}
</div>`;
  }

  static getConfigElement() { return document.createElement('lovelace-galaxy-eventlog-editor'); }
  static getStubConfig()    { return { entity: '', title: 'Event Log', max_events: 50, history_days: 7, filter_codes: [], sia_colors: DEFAULT_SIA_COLORS }; }
  getCardSize()             { return 4; }
}

// ── Editor element ────────────────────────────────────────────────────────────
class GalaxyEventLogCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass   = null;
  }

  setConfig(config) {
    this._config = {
      entity:       config.entity        || '',
      title:        config.title         || 'Event Log',
      max_events:   config.max_events    || 50,
      history_days: config.history_days  || 7,
      filter_codes: config.filter_codes  || [],
      sia_colors:   config.sia_colors    || [...DEFAULT_SIA_COLORS],
    };
    this._render();
  }

  set hass(hass) { this._hass = hass; }

  _fire(config) {
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
  }

  _addColorRule() {
    const sc = [...(this._config.sia_colors || [])];
    sc.push({ code: 'BA', color: '#ef4444', label: '' });
    this._config.sia_colors = sc;
    this._fire({ ...this._config });
    this._render();
  }

  _removeColorRule(idx) {
    const sc = [...(this._config.sia_colors || [])];
    sc.splice(idx, 1);
    this._config.sia_colors = sc;
    this._fire({ ...this._config });
    this._render();
  }

  _updateColorRule(idx, field, value) {
    const sc = [...(this._config.sia_colors || [])];
    sc[idx] = { ...sc[idx], [field]: value };
    this._config.sia_colors = sc;
    this._fire({ ...this._config });
  }

  _toggleFilter(code) {
    let fc = [...(this._config.filter_codes || [])];
    fc = fc.includes(code) ? fc.filter(c => c !== code) : [...fc, code];
    this._config.filter_codes = fc;
    this._fire({ ...this._config });
    this._render();
  }

  _render() {
    const cfg = this._config;
    const fc  = cfg.filter_codes || [];
    const sc  = cfg.sia_colors   || [];

    let entityOpts = '<option value="">-- select entity --</option>';
    if (this._hass) {
      Object.keys(this._hass.states)
        .filter(k => k.startsWith('sensor.') || k.startsWith('input_text.'))
        .sort()
        .forEach(k => {
          entityOpts += `<option value="${k}" ${k === cfg.entity ? 'selected' : ''}>${k}</option>`;
        });
    }

    this.shadowRoot.innerHTML = `
<style>
  :host { display: block; font-size: 14px; }
  .row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
  label { font-size: 11px; font-weight: 600; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: .05em; }
  input[type=text], input[type=number], select {
    width: 100%; height: 36px; padding: 0 10px;
    background: var(--secondary-background-color, #f5f5f5);
    border: 1px solid var(--divider-color, #e0e0e0); border-radius: 8px;
    color: var(--primary-text-color); font-family: inherit; font-size: 13px; box-sizing: border-box;
  }
  input[type=color] {
    width: 40px; height: 32px; padding: 2px 4px;
    border: 1px solid var(--divider-color); border-radius: 6px;
    background: var(--secondary-background-color); cursor: pointer; flex-shrink: 0;
  }
  .sect {
    font-size: 11px; font-weight: 600; color: var(--secondary-text-color);
    text-transform: uppercase; letter-spacing: .05em;
    margin: 18px 0 8px; padding-bottom: 5px; border-bottom: 1px solid var(--divider-color, #e0e0e0);
  }
  .filter-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(52px, 1fr)); gap: 4px; }
  .filter-btn {
    padding: 4px 6px; border-radius: 6px; border: 1px solid var(--divider-color);
    background: var(--secondary-background-color); color: var(--secondary-text-color);
    font-size: 11px; font-weight: 600; font-family: monospace; cursor: pointer; text-align: center;
  }
  .filter-btn.active { background: rgba(59,130,246,.15); border-color: #3b82f6; color: #3b82f6; }
  .color-rules { display: flex; flex-direction: column; gap: 8px; }
  .color-rule { display: flex; align-items: center; gap: 6px; }
  .color-rule select { flex: 1; }
  .color-rule input[type=text] { flex: 1.5; }
  .del-btn {
    width: 28px; height: 28px; border: none; border-radius: 6px;
    background: rgba(239,68,68,.1); color: #ef4444;
    cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .add-btn {
    margin-top: 6px; height: 32px; width: 100%;
    border: 1px dashed var(--divider-color); border-radius: 8px; background: transparent;
    color: var(--secondary-text-color); font-size: 12px; cursor: pointer;
  }
  .filter-note { font-size: 11px; color: var(--secondary-text-color); margin-bottom: 6px; }
</style>

<div class="row"><label>Entity</label><select id="entity">${entityOpts}</select></div>
<div class="row"><label>Title</label><input type="text" id="title" value="${cfg.title}"></div>
<div class="row"><label>Max Events</label><input type="number" id="max_events" min="1" max="200" value="${cfg.max_events}"></div>
<div class="row"><label>History (days)</label><input type="number" id="history_days" min="1" max="30" value="${cfg.history_days}"></div>

<div class="sect">Filter by SIA code</div>
<div class="filter-note">Select codes to show — leave all unselected to show all</div>
<div class="filter-grid">
  ${SIA_CODES.map(code => `<button class="filter-btn${fc.includes(code) ? ' active' : ''}" data-code="${code}">${code}</button>`).join('')}
</div>

<div class="sect">Code colour rules</div>
<div class="color-rules">
  ${sc.map((rule, idx) => `
    <div class="color-rule">
      <select class="cr-code" data-idx="${idx}">
        ${SIA_CODES.map(c => `<option value="${c}" ${c === rule.code ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
      <input type="text" class="cr-label" data-idx="${idx}" placeholder="Label" value="${rule.label || ''}">
      <input type="color" class="cr-color" data-idx="${idx}" value="${rule.color || '#3b82f6'}">
      <button class="del-btn" data-delidx="${idx}">&#215;</button>
    </div>`).join('')}
</div>
<button class="add-btn" id="add-rule">+ Add colour rule</button>`;

    this.shadowRoot.getElementById('entity').addEventListener('change', e => { this._config.entity = e.target.value; this._fire({ ...this._config }); });
    this.shadowRoot.getElementById('title').addEventListener('change', e => { this._config.title = e.target.value; this._fire({ ...this._config }); });
    this.shadowRoot.getElementById('max_events').addEventListener('change', e => { this._config.max_events = parseInt(e.target.value) || 50; this._fire({ ...this._config }); });
    this.shadowRoot.getElementById('history_days').addEventListener('change', e => { this._config.history_days = parseInt(e.target.value) || 7; this._fire({ ...this._config }); });
    this.shadowRoot.querySelectorAll('.filter-btn').forEach(btn => btn.addEventListener('click', () => this._toggleFilter(btn.dataset.code)));
    this.shadowRoot.querySelectorAll('.cr-code').forEach(el => el.addEventListener('change', e => this._updateColorRule(+e.target.dataset.idx, 'code', e.target.value)));
    this.shadowRoot.querySelectorAll('.cr-label').forEach(el => el.addEventListener('change', e => this._updateColorRule(+e.target.dataset.idx, 'label', e.target.value)));
    this.shadowRoot.querySelectorAll('.cr-color').forEach(el => el.addEventListener('input', e => this._updateColorRule(+e.target.dataset.idx, 'color', e.target.value)));
    this.shadowRoot.querySelectorAll('.del-btn').forEach(btn => btn.addEventListener('click', () => this._removeColorRule(+btn.dataset.delidx)));
    this.shadowRoot.getElementById('add-rule').addEventListener('click', () => this._addColorRule());
  }
}

customElements.define('lovelace-galaxy-eventlog', GalaxyEventLogCard);
customElements.define('lovelace-galaxy-eventlog-editor', GalaxyEventLogCardEditor);

console.info(
  "%c  lovelace-galaxy-eventlog  \n%c Version 0.3.0 ",
  "color: orange; font-weight: bold; background: black",
  "color: white; font-weight: bold; background: dimgray"
);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'lovelace-galaxy-eventlog',
  name: 'Galaxy Event Log',
  description: 'Displays alarm events from a Galaxy Gateway sensor in a filterable grid',
  preview: true,
  documentationURL: "https://github.com/GalaxyGateway/lovelace-galaxy-eventlog",
});
