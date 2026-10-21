// ฟังก์ชันกลางที่ทุกหน้าใช้ร่วมกัน
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

async function api(url, { method = 'GET', body, noRedirect } = {}) {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await r.json(); } catch (e) { /* ไม่มี body */ }
  if (r.status === 401 && !noRedirect) { location.href = '/'; throw new Error('กรุณาเข้าสู่ระบบ'); }
  if (!r.ok) throw new Error((data && data.error) || 'เกิดข้อผิดพลาด');
  return data;
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtH = n => (Number(n) || 0).toLocaleString('th-TH', { maximumFractionDigits: 1 });
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function thDate(d) {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  return `${day} ${TH_MONTHS[m - 1]} ${y + 543}`;
}
const thMonth = ym => { const [y, m] = ym.split('-').map(Number); return `${TH_MONTHS[m - 1]} ${String(y + 543).slice(2)}`; };
function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
const pct = (done, assigned) => assigned > 0 ? Math.min(100, Math.round(done / assigned * 100)) : 100;
const remaining = s => Math.max((s.assigned || 0) - (s.done || 0), 0);
const ROLE_TH = { admin: 'ผู้ดูแลระบบ', teacher: 'ครู', student: 'นักศึกษา' };

function statusBadge(s) {
  if (!s.assigned) return '<span class="badge">ไม่มีชั่วโมง</span>';
  const left = remaining(s);
  return (left > 0 ? `<span class="badge warn">ค้าง ${fmtH(left)} ชม.</span>` : '<span class="badge ok">ครบแล้ว</span>') + (s.red_stars ? ' ' + redStarBadge(s) : '');
}
const progressBar = s => `<div class="prog-row"><div class="progress" style="flex:1"><div style="width:${pct(s.done, s.assigned)}%"></div></div><span>${pct(s.done, s.assigned)}%</span></div>`;

function toast(msg, type = 'ok') {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'err' ? ' err' : '');
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// เปิดหน้าต่างฟอร์ม: onSubmit(ข้อมูลฟอร์ม) คืน Promise, ถ้า error จะแสดงในหน้าต่างและไม่ปิด
function openModal({ title, body, submitText = 'บันทึก', onSubmit, danger }) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<form class="modal"><h3>${esc(title)}</h3><div class="alert" hidden></div>${body}
    <div class="btns"><button type="button" class="btn" data-close>ยกเลิก</button>
    <button class="btn ${danger ? 'danger' : 'primary'}">${esc(submitText)}</button></div></form>`;
  const close = () => bg.remove();
  bg.addEventListener('click', e => { if (e.target === bg || e.target.hasAttribute('data-close')) close(); });
  const form = $('form', bg);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('button:not([type])', form);
    btn.disabled = true;
    try {
      await onSubmit(Object.fromEntries(new FormData(form)), form);
      close();
    } catch (err) {
      const a = $('.alert', form); a.hidden = false; a.textContent = err.message;
      btn.disabled = false;
    }
  });
  document.body.appendChild(bg);
  const first = $('input:not([type=hidden]), select, textarea', form);
  if (first) first.focus();
  return form;
}

const confirmAsk = (title, msg, submitText = 'ยืนยัน') =>
  new Promise(resolve => {
    let ok = false;
    const f = openModal({ title, body: `<p>${msg}</p>`, submitText, danger: true, onSubmit: async () => { ok = true; } });
    new MutationObserver((_, obs) => { if (!document.body.contains(f)) { obs.disconnect(); resolve(ok); } })
      .observe(document.body, { childList: true });
  });

async function logout() {
  await api('/api/logout', { method: 'POST', noRedirect: true }).catch(() => {});
  location.href = '/';
}

function changePasswordForm(el) {
  el.innerHTML = `<form class="card" style="max-width:480px">
    <label>รหัสผ่านเดิม<input type="password" name="oldPassword" required></label>
    <label>รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)<input type="password" name="newPassword" required minlength="6"></label>
    <label>ยืนยันรหัสผ่านใหม่<input type="password" name="confirm" required minlength="6"></label>
    <button class="btn primary">เปลี่ยนรหัสผ่าน</button></form>`;
  $('form', el).addEventListener('submit', async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    if (d.newPassword !== d.confirm) return toast('ยืนยันรหัสผ่านไม่ตรงกัน', 'err');
    try {
      await api('/api/me/password', { method: 'POST', body: d });
      e.target.reset();
      toast('เปลี่ยนรหัสผ่านเรียบร้อย');
    } catch (err) { toast(err.message, 'err'); }
  });
}

// เหตุผลของคำสั่งให้ทำชั่วโมง แสดงเป็นป้าย + รายละเอียดเพิ่มเติม
// ตัวเลือกแผนก แบ่งกลุ่มตามประเภทวิชา (filter = มีตัวเลือก "ทั้งประเภทวิชา" และ "ยังไม่ระบุแผนก" สำหรับกรอง)
function deptOptions(depts, sel = '', filter = false) {
  const opt = (v, t) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(t)}</option>`;
  return (filter ? opt('', 'ทุกแผนก') : opt('', '- ไม่ระบุแผนก -')) +
    depts.map(g => `<optgroup label="${esc(g.group)}">${filter ? opt('group:' + g.group, 'ทั้งประเภทวิชา' + g.group) : ''}${g.items.map(d => opt(d, d)).join('')}</optgroup>`).join('') +
    (filter ? opt('none', 'ยังไม่ระบุแผนก') : '');
}
const matchDept = (x, f) => !f || (f === 'none' ? !x.department : f.startsWith('group:') ? x.group === f.slice(6) : x.department === f);
const deptText = x => x.department ? `แผนก${esc(x.department)}` : 'ยังไม่ระบุแผนก';

const RED_STAR = 'ดาวแดง';
const isRedStar = l => l.type === 'assign' && (l.term_id != null || String(l.text || '').startsWith(RED_STAR));
const redStarBadge = s => s.red_stars ? `<span class="badge redstar">ดาวแดง${s.red_stars > 1 ? ' ×' + s.red_stars : ''}</span>` : '';
// จำนวนวันจากวันนี้ถึงวันที่ (บวก = ยังไม่ถึง)
const daysUntil = d => Math.round((new Date(d + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000);

function reasonHtml(l) {
  if (l.type !== 'assign') return esc(l.text);
  if (isRedStar(l)) {
    const [head, ...rest] = String(l.text).split(' — ');
    return `<span class="badge redstar">${esc(head)}</span>${rest.length ? `<div class="small muted">${esc(rest.join(' — '))}</div>` : ''}`;
  }
  const [head, ...rest] = String(l.text || '').split(' — ');
  const tags = head.split(',').map(x => x.trim()).filter(Boolean).map(x => `<span class="tag">${esc(x)}</span>`).join(' ');
  return tags + (rest.length ? `<div class="small muted">${esc(rest.join(' — '))}</div>` : '');
}

// ---------- ลูกเล่นตอนคลิก / เลือก ----------
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

// คลื่นวงกลมตรงจุดที่คลิก
document.addEventListener('pointerdown', e => {
  const el = e.target.closest('.btn, .chip, .seg label, .nav a, tr.click, .check-list label, .stat.link');
  if (!el || REDUCED) return;
  const r = el.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2;
  const w = document.createElement('span');
  w.className = 'ripple';
  w.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  (el.tagName === 'TR' ? el.cells[0] : el).appendChild(w);
  setTimeout(() => w.remove(), 600);
});

// ตัวเลขในการ์ดสถิติวิ่งขึ้นจาก 0
function countUp(root = document) {
  if (REDUCED) return;
  $$('.stat .v', root).forEach(v => {
    const node = [...v.childNodes].find(n => n.nodeType === 3 && /^\s*[\d,.]+\s*%?\s*$/.test(n.textContent));
    if (!node) return;
    const target = Number(node.textContent.replace(/[^\d.]/g, ''));
    const suffix = node.textContent.replace(/[\d.,\s]/g, '');
    if (!target) return;
    const t0 = performance.now(), dur = 700;
    const step = t => {
      const k = Math.min(1, (t - t0) / dur), ease = 1 - Math.pow(1 - k, 3);
      node.textContent = (Number.isInteger(target) ? Math.round(target * ease) : fmtH(target * ease)) + suffix;
      if (k < 1) requestAnimationFrame(step); else node.textContent = fmtH(target) + suffix;
    };
    requestAnimationFrame(step);
  });
}

// สั่นเบา ๆ เมื่อข้อมูลผิด
function shake(el) {
  el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
}
