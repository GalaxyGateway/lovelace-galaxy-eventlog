// Galaxy Gateway — Event Log Card for Home Assistant
// Uses HA History API to fetch past states — no REST sensor needed.
// Place in /config/www/lovelace-galaxy-eventlog.js
// Add to resources: /local/lovelace-galaxy-eventlog.js (type: module)

const DEFAULT_SIA_COLORS = [
  { code: 'BA', color: '#ef4444', label: 'Burglary Alarm' },
  { code: 'FA', color: '#f97316', label: 'Fire Alarm' },
  { code: 'PA', color: '#ef4444', label: 'Panic Alarm' },
  { code: 'HA', color: '#ef4444', label: 'Hold-Up Alarm' },
  { code: 'TA', color: '#f59e0b', label: 'Tamper' },
  { code: 'CA', color: '#22c55e', label: 'Cancel' },
  { code: 'CL', color: '#22c55e', label: 'Closing' },
  { code: 'OP', color: '#3b82f6', label: 'Opening' },
  { code: 'RR', color: '#22c55e', label: 'System Restore' },
  { code: 'OA', color: '#3b82f6', label: 'Disarmed' },
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
    this._config  = {};
    this._hass    = null;
    this._events  = [];
    this._loading = true;
    this._error   = null;
    this._lastFetch = 0;
  }

  setConfig(config) {
    // Never throw — HA drops to raw YAML editor if setConfig throws.
    // Render a "no entity" placeholder instead.
    this._config = {
      entity:       config.entity || '',
      title:        config.title        || 'Event Log',
      hours:        config.hours        || 24,
      max_events:   config.max_events   || 20,
      filter_codes: config.filter_codes || [],
      sia_colors:   config.sia_colors   || [...DEFAULT_SIA_COLORS],
    };
    this._events  = [];
    this._loading = true;
    this._error   = null;
    this._lastFetch = 0;
    this._render();
  }

  set hass(hass) {
    const prev = this._hass;
    this._hass = hass;
    // Fetch history on first load or when entity state changes (new event arrived)
    const prevState = prev?.states[this._config.entity]?.state;
    const currState = hass?.states[this._config.entity]?.state;
    const stale = Date.now() - this._lastFetch > 10000;
    if (!prev || prevState !== currState || stale) {
      this._fetchHistory();
    }
  }

  async _fetchHistory() {
    if (!this._hass || !this._config.entity) {
      this._loading = false;
      this._render();
      return;
    }
    this._lastFetch = Date.now();
    const end   = new Date();
    const start = new Date(end.getTime() - this._config.hours * 3600 * 1000);
    // Use same approach as Royto logbook card — fetch history with attributes.
    // callApi path must NOT include leading /api/.
    // significant_changes_only=false ensures every state change is returned.
    const path = `history/period/${start.toISOString()}` +
      `?filter_entity_id=${this._config.entity}` +
      `&end_time=${end.toISOString()}` +
      `&significant_changes_only=false`;
    try {
      const res = await this._hass.callApi('GET', path);
      this._events  = this._parseHistory(res);
      this._loading = false;
      this._error   = null;
    } catch(e) {
      this._error   = `History API error: ${e.message || e}`;
      this._loading = false;
    }
    this._render();
  }

  _parseHistory(res) {
    // res is an array of entity arrays: [[state1, state2, ...]]
    // Each state has: { state, attributes, last_changed, last_updated }
    // Attributes contain the event fields pushed by the firmware.
    if (!Array.isArray(res) || res.length === 0) return [];
    const states = res[0];
    if (!Array.isArray(states)) return [];

    let events = [];
    for (const s of states) {
      const attr = s.attributes || {};

      // Code lives in attributes.code (from autodiscovery MQTT sensor)
      const code = (attr.code || attr.Code || '').toUpperCase().trim();

      // Skip states without a valid 2-letter SIA code
      if (!code || code.length < 2 || code.length > 4) continue;
      if (['UNAVAILABLE','UNKNOWN','NONE',''].includes(code)) continue;

      events.push({
        ts:   s.last_changed || s.last_updated || '',
        acc:  attr.acc      || attr.account   || '',
        date: attr.date     || '',
        time: attr.time     || '',
        code: code,
        user: attr.user     || attr.userid    || '',
        area: attr.area     || '',
        addr: attr.addr     || attr.address   || attr.device || attr.on || attr.nr || '',
        text: attr.text     || attr.Text      || '',
      });
    }

    // Most recent first
    events.reverse();

    // Filter by SIA code
    const fc = this._config.filter_codes;
    if (fc && fc.length > 0) events = events.filter(e => fc.includes(e.code));

    return events.slice(0, this._config.max_events);
  }

  _colorForCode(code) {
    const match = (this._config.sia_colors || []).find(c => c.code === code);
    return match ? match.color : null;
  }

  _isAlarm(code) {
    return ['BA','FA','PA','HA','JA','TA','DF','DK'].includes(code);
  }

  _isGood(code) {
    return ['CA','CL','CG','RR','RF','OA'].includes(code);
  }

  _fmtTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
    } catch(e) { return iso; }
  }

  _render() {
    const events = this._events;
    const cfg    = this._config;

    this.shadowRoot.innerHTML = `
<style>
  :host { display: block; }
  .card {
    background: var(--card-background-color, #fff);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: var(--ha-card-box-shadow, 0 2px 8px rgba(0,0,0,.08));
    border: 1px solid var(--divider-color, #e0e0e0);
  }
  .card-header {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--divider-color, #e0e0e0);
  }
  .header-icon {
    width: 28px; height: 28px;
    background: rgba(59,130,246,.12);
    border-radius: 7px;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .header-icon svg { width: 15px; height: 15px; }
  .header-title { flex: 1; font-size: 14px; font-weight: 600; color: var(--primary-text-color); }
  .header-meta  { font-size: 11px; color: var(--secondary-text-color);
                  background: var(--secondary-background-color, #f5f5f5);
                  padding: 2px 8px; border-radius: 20px; white-space: nowrap; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  thead th {
    padding: 7px 12px; text-align: left;
    font-size: 10px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase;
    color: var(--secondary-text-color);
    border-bottom: 1px solid var(--divider-color, #e0e0e0);
    background: var(--secondary-background-color, #f5f5f5);
    white-space: nowrap;
  }
  tbody tr { border-bottom: 1px solid var(--divider-color, #e0e0e0); }
  tbody tr:last-child { border-bottom: none; }
  tbody tr:hover { background: var(--secondary-background-color, #f5f5f5); }
  tbody td { padding: 8px 12px; color: var(--secondary-text-color); vertical-align: middle; }
  td.code-cell { font-family: var(--code-font-family, monospace); font-weight: 600; font-size: 11px; white-space: nowrap; }
  td.txt-cell  { color: var(--primary-text-color); }
  td.acc-cell  { color: var(--primary-text-color); font-family: monospace; }
  td.time-cell { white-space: nowrap; }
  .dot {
    display: inline-block; width: 7px; height: 7px;
    border-radius: 50%; margin-right: 5px; vertical-align: middle; flex-shrink: 0;
  }
  .row-alarm { background: rgba(239,68,68,.06) !important; border-left: 3px solid #ef4444; }
  .row-alarm td { color: var(--primary-text-color); }
  .row-good  { background: rgba(34,197,94,.06)  !important; border-left: 3px solid #22c55e; }
  .row-good td { color: var(--primary-text-color); }
  .status { padding: 24px 16px; text-align: center; color: var(--secondary-text-color); font-size: 13px; }
  .status.error { color: var(--error-color, #ef4444); }
  .spinner {
    display: inline-block; width: 18px; height: 18px;
    border: 2px solid var(--divider-color); border-top-color: #3b82f6;
    border-radius: 50%; animation: spin .8s linear infinite; margin-right: 8px;
    vertical-align: middle;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
<div class="card">
  <div class="card-header">
    <div class="header-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 2Q5 2 5 3L5 21Q5 22 6 22L18 22Q19 22 19 21L19 7L14 2Z" stroke-linejoin="round"/>
        <polyline points="14 2 14 7 19 7" stroke-linejoin="round"/>
        <line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="16" y2="15"/>
      </svg>
    </div>
    <span class="header-title">${cfg.title}</span>
    <span class="header-meta">
      ${this._loading ? '' : `${events.length} events · last ${cfg.hours}h`}
    </span>
  </div>

  ${!cfg.entity    ? `<div class="status">Select an entity in the card editor</div>` :
    this._loading ? `<div class="status"><span class="spinner"></span>Loading history…</div>` :
    this._error   ? `<div class="status error">${this._error}</div>` :
    events.length === 0 ? `<div class="status">No events in the last ${cfg.hours} hours</div>` :
    `<div class="table-wrap"><table>
      <thead><tr>
        <th>Time</th><th>Account</th><th>Code</th>
        <th>User</th><th>Area</th><th>Addr</th><th>Event</th>
      </tr></thead>
      <tbody>
        ${events.map(ev => {
          const color    = this._colorForCode(ev.code);
          const alarm    = this._isAlarm(ev.code);
          const good     = this._isGood(ev.code);
          const rowClass = alarm ? 'row-alarm' : good ? 'row-good' : '';
          const dotStyle = color
            ? `background:${color}`
            : alarm ? 'background:#ef4444'
            : good  ? 'background:#22c55e'
            : 'display:none';
          const timeStr  = ev.time || this._fmtTime(ev.ts);
          return `<tr class="${rowClass}">
            <td class="time-cell">${timeStr}</td>
            <td class="acc-cell">${ev.acc}</td>
            <td class="code-cell"><span class="dot" style="${dotStyle}"></span>${ev.code}</td>
            <td>${ev.user}</td>
            <td>${ev.area}</td>
            <td>${ev.addr}</td>
            <td class="txt-cell">${ev.text}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`}
</div>`;
  }

  static getConfigElement() { return document.createElement('lovelace-galaxy-eventlog-editor'); }
  static getStubConfig()    { return { entity: '', title: 'Event Log', hours: 24, max_events: 20, filter_codes: [], sia_colors: [...DEFAULT_SIA_COLORS] }; }
  getCardSize()             { return 4; }
}

// ── Editor ────────────────────────────────────────────────────────────────────
class GalaxyEventLogCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass   = null;
  }

  setConfig(config) {
    this._config = {
      entity:       config.entity       || '',
      title:        config.title        || 'Event Log',
      hours:        config.hours        || 24,
      max_events:   config.max_events   || 20,
      filter_codes: config.filter_codes || [],
      sia_colors:   config.sia_colors   || [...DEFAULT_SIA_COLORS],
    };
    this._render();
  }

  set hass(hass) { this._hass = hass; }

  _fire() {
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: { ...this._config } }, bubbles: true, composed: true
    }));
  }

  _addColorRule() {
    this._config.sia_colors = [...(this._config.sia_colors||[]), { code:'BA', color:'#ef4444', label:'' }];
    this._fire(); this._render();
  }

  _removeColorRule(idx) {
    const sc = [...(this._config.sia_colors||[])];
    sc.splice(idx, 1);
    this._config.sia_colors = sc;
    this._fire(); this._render();
  }

  _updateColorRule(idx, field, value) {
    const sc = [...(this._config.sia_colors||[])];
    sc[idx] = { ...sc[idx], [field]: value };
    this._config.sia_colors = sc;
    this._fire();
  }

  _toggleFilter(code) {
    let fc = [...(this._config.filter_codes||[])];
    fc = fc.includes(code) ? fc.filter(c => c !== code) : [...fc, code];
    this._config.filter_codes = fc;
    this._fire(); this._render();
  }

  _render() {
    const cfg = this._config;
    const fc  = cfg.filter_codes || [];
    const sc  = cfg.sia_colors   || [];

    let entityOpts = '<option value="">— select entity —</option>';
    if (this._hass) {
      Object.keys(this._hass.states)
        .filter(k => k.includes('event_'))
        .sort()
        .forEach(k => {
          entityOpts += `<option value="${k}"${k===cfg.entity?' selected':''}>${k}</option>`;
        });
      // Keep currently selected entity in the list even if it doesn't match the filter
      if (cfg.entity && !cfg.entity.includes('event_')) {
        entityOpts += `<option value="${cfg.entity}" selected>${cfg.entity}</option>`;
      }
    }

    this.shadowRoot.innerHTML = `
<style>
  :host { display: block; font-size: 14px; }
  .row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
  .row-h { display: flex; gap: 12px; margin-bottom: 14px; }
  .row-h .row { flex: 1; margin-bottom: 0; }
  label { font-size: 11px; font-weight: 600; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: .05em; }
  input[type=text], input[type=number], select {
    width: 100%; height: 36px; padding: 0 10px;
    background: var(--secondary-background-color, #f5f5f5);
    border: 1px solid var(--divider-color, #e0e0e0); border-radius: 8px;
    color: var(--primary-text-color); font-family: inherit; font-size: 13px;
    box-sizing: border-box;
  }
  input[type=color] {
    width: 40px; height: 32px; padding: 2px 4px;
    border: 1px solid var(--divider-color); border-radius: 6px;
    background: var(--secondary-background-color); cursor: pointer; flex-shrink: 0;
  }
  .sect {
    font-size: 11px; font-weight: 600; color: var(--secondary-text-color);
    text-transform: uppercase; letter-spacing: .05em;
    margin: 18px 0 8px; padding-bottom: 5px;
    border-bottom: 1px solid var(--divider-color, #e0e0e0);
  }
  .note { font-size: 11px; color: var(--secondary-text-color); margin-bottom: 8px; }
  .filter-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(50px, 1fr)); gap: 4px;
  }
  .filter-btn {
    padding: 4px 4px; border-radius: 6px;
    border: 1px solid var(--divider-color);
    background: var(--secondary-background-color);
    color: var(--secondary-text-color);
    font-size: 11px; font-weight: 600; font-family: monospace;
    cursor: pointer; text-align: center;
  }
  .filter-btn.on { background: rgba(59,130,246,.15); border-color: #3b82f6; color: #3b82f6; }
  .color-rules { display: flex; flex-direction: column; gap: 8px; }
  .cr { display: flex; align-items: center; gap: 6px; }
  .cr select { flex: 1; }
  .cr input[type=text] { flex: 1.5; }
  .del { width: 28px; height: 28px; border: none; border-radius: 6px;
         background: rgba(239,68,68,.1); color: #ef4444; cursor: pointer;
         font-size: 18px; line-height: 1; flex-shrink: 0; }
  .add { margin-top: 6px; height: 32px; width: 100%;
         border: 1px dashed var(--divider-color); border-radius: 8px;
         background: transparent; color: var(--secondary-text-color); font-size: 12px; cursor: pointer; }
  .add:hover { background: var(--secondary-background-color); }
</style>

<div class="row">
  <label>Entity</label>
  <select id="ent">${entityOpts}</select>
</div>
<div class="row">
  <label>Title</label>
  <input type="text" id="ttl" value="${cfg.title}">
</div>
<div class="row-h">
  <div class="row">
    <label>History (hours)</label>
    <input type="number" id="hrs" min="1" max="168" value="${cfg.hours}">
  </div>
  <div class="row">
    <label>Max events</label>
    <input type="number" id="max" min="1" max="100" value="${cfg.max_events}">
  </div>
</div>

<div class="sect">Filter by SIA code</div>
<div class="note">Active = show only these codes. None active = show all.</div>
<div class="filter-grid">
  ${SIA_CODES.map(c => `<button class="filter-btn${fc.includes(c)?' on':''}" data-code="${c}">${c}</button>`).join('')}
</div>

<div class="sect">Code colour rules</div>
<div class="color-rules" id="cr">
  ${sc.map((r,i) => `
  <div class="cr">
    <select class="rc" data-i="${i}">
      ${SIA_CODES.map(c=>`<option${c===r.code?' selected':''}>${c}</option>`).join('')}
    </select>
    <input type="text" class="rl" data-i="${i}" placeholder="Label" value="${r.label||''}">
    <input type="color" class="rk" data-i="${i}" value="${r.color||'#3b82f6'}">
    <button class="del" data-i="${i}">×</button>
  </div>`).join('')}
</div>
<button class="add" id="add">+ Add colour rule</button>
`;

    this.shadowRoot.getElementById('ent').addEventListener('change', e => { this._config.entity = e.target.value; this._fire(); });
    this.shadowRoot.getElementById('ttl').addEventListener('change', e => { this._config.title  = e.target.value; this._fire(); });
    this.shadowRoot.getElementById('hrs').addEventListener('change', e => { this._config.hours  = +e.target.value || 24; this._fire(); });
    this.shadowRoot.getElementById('max').addEventListener('change', e => { this._config.max_events = +e.target.value || 20; this._fire(); });
    this.shadowRoot.querySelectorAll('.filter-btn').forEach(b => b.addEventListener('click', () => this._toggleFilter(b.dataset.code)));
    this.shadowRoot.querySelectorAll('.rc').forEach(el => el.addEventListener('change', e => this._updateColorRule(+e.target.dataset.i, 'code',  e.target.value)));
    this.shadowRoot.querySelectorAll('.rl').forEach(el => el.addEventListener('change', e => this._updateColorRule(+e.target.dataset.i, 'label', e.target.value)));
    this.shadowRoot.querySelectorAll('.rk').forEach(el => el.addEventListener('input',  e => this._updateColorRule(+e.target.dataset.i, 'color', e.target.value)));
    this.shadowRoot.querySelectorAll('.del').forEach(b => b.addEventListener('click', () => this._removeColorRule(+b.dataset.i)));
    this.shadowRoot.getElementById('add').addEventListener('click', () => this._addColorRule());
  }
}

customElements.define('lovelace-galaxy-eventlog', GalaxyEventLogCard);
customElements.define('lovelace-galaxy-eventlog-editor', GalaxyEventLogCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'lovelace-galaxy-eventlog',
  name: 'Galaxy Event Log',
  description: 'Alarm event history from Galaxy Gateway via HA History API',
  preview: false,
});
