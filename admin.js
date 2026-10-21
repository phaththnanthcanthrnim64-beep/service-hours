// หลังบ้าน (ครู / ผู้ดูแล) แบบหน้าเดียว เปลี่ยนหน้าด้วย #hash
let ME;
const view = $('#view');
const isAdmin = () => ME.role === 'admin';
const levelOptions = (levels, sel, empty = '- ไม่ระบุชั้นปี -') => `<option value="">${empty}</option>` +
  levels.map(l => `<option value="${l.id}" ${String(l.id) === String(sel) ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
const typeOptions = (types, sel) => '<option value="">- ไม่ระบุ -</option>' +
  types.map(t => `<option value="${t.id}" ${String(t.id) === String(sel) ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
const head = (title, sub = '', actions = '') =>
  `<div class="page-head"><div><h2>${title}</h2>${sub ? `<p class="muted">${sub}</p>` : ''}</div><div class="btns">${actions}</div></div>`;

const PAGES = { dash, students, student, bulk, reports, redstar, depts, levels, types, staff, password };

(async () => {
  ME = await api('/api/me');
  if (ME.role === 'student') return location.replace('/');
  $('#meName').textContent = ME.name;
  $('#meRole').textContent = ROLE_TH[ME.role];
  if (!isAdmin()) $$('.admin-only').forEach(e => e.remove());
  window.addEventListener('hashchange', route);
  route();
})();

async function route() {
  const [name, arg] = (location.hash.slice(1) || 'dash').split('/');
  const page = PAGES[name] || dash;
  $$('.nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + (name === 'student' ? 'students' : name)));
  $('.sidebar').classList.remove('open');
  view.innerHTML = '<p class="muted">กำลังโหลด...</p>';
  try { await page(arg); } catch (e) { view.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
  view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter');
  countUp(view);
  window.scrollTo(0, 0);
}

// ---------- ภาพรวม ----------
async function dash() {
  const [s, rs] = await Promise.all([api('/api/stats'), api('/api/red-stars')]);
  const max = Math.max(1, ...s.monthly.map(m => Math.max(m.assigned, m.done)));
  const months = [];
  const d = new Date(); d.setDate(1);
  for (let i = 5; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const key = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
    months.push(s.monthly.find(m => m.month === key) || { month: key, assigned: 0, done: 0 });
  }
  view.innerHTML = head(`สวัสดี ${esc(ME.name)}`, 'ภาพรวมชั่วโมงบำเพ็ญประโยชน์ของนักศึกษาทั้งหมด',
    `<a class="btn primary" href="#students">จัดการนักศึกษา</a>`) + termBanner(rs) + `
    <div class="stats">
      <div class="stat"><div><div class="v">${s.students}</div><div class="k">นักศึกษาในระบบ</div></div></div>
      <div class="stat bad"><div><div class="v">${s.owing}</div><div class="k">ยังทำชั่วโมงไม่ครบ</div></div></div>
      <div class="stat ok"><div><div class="v">${s.completed}</div><div class="k">ทำครบแล้ว</div></div></div>
      <div class="stat warn"><div><div class="v">${fmtH(s.done)}<span class="small muted"> / ${fmtH(s.assigned)}</span></div><div class="k">ชั่วโมงที่ทำแล้ว / ที่สั่ง</div></div></div>
    </div>
    <div class="grid2" style="margin-bottom:18px">
      <div class="card">
        <div class="card-head"><h3>ชั่วโมงรายเดือน (6 เดือนล่าสุด)</h3>
          <div class="legend"><span><i style="background:#fbbf24"></i>สั่ง</span><span><i style="background:#22c55e"></i>ทำแล้ว</span></div></div>
        <div class="chart">${months.map(m => `<div class="col"><div class="bars">
          <div class="bar a" style="height:${m.assigned / max * 100}%" title="สั่ง ${fmtH(m.assigned)} ชม."></div>
          <div class="bar d" style="height:${m.done / max * 100}%" title="ทำแล้ว ${fmtH(m.done)} ชม."></div></div></div>`).join('')}</div>
        <div class="chart-x">${months.map(m => `<span>${thMonth(m.month)}</span>`).join('')}</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>ค้างชั่วโมงมากที่สุด</h3><a href="#reports" class="small">ดูรายงาน</a></div>
        <div class="table-wrap"><table><tbody>
        ${s.topOwing.map(r => `<tr class="click" onclick="location.hash='student/${r.id}'">
          <td><b>${esc(r.name)}</b><div class="small muted">${esc(r.username)} · ${esc(r.level || '-')} · ${esc(r.department || '-')}</div></td>
          <td style="width:30%">${progressBar(r)}</td><td class="num"><span class="badge warn">${fmtH(r.remaining)} ชม.</span></td></tr>`).join('')
          || '<tr><td class="empty">ไม่มีนักศึกษาค้างชั่วโมง </td></tr>'}
        </tbody></table></div>
      </div>
    </div>
    <div class="card"><h3 style="margin-bottom:8px">บันทึกล่าสุด</h3>
      <ul class="list">${s.recent.map(l => `<li>
        ${l.type === 'assign' ? '<span class="badge warn">สั่ง</span>' : '<span class="badge ok">ทำแล้ว</span>'}
        <div class="grow"><a href="#student/${l.student_id}"><b>${esc(l.name)}</b></a> ·
          ${l.type === 'assign' ? 'ถูกสั่ง' : 'ทำแล้ว'} <b>${fmtH(l.hours)}</b> ชม. · ${l.type === 'assign' ? 'เหตุผล: ' : ''}${esc(l.text)}
          <div class="small muted">${thDate(l.date)} · บันทึกโดย ${esc(l.recorder || '-')}</div></div></li>`).join('')
        || '<li class="muted">ยังไม่มีการบันทึก</li>'}</ul>
    </div>`;
}

// ---------- รายชื่อนักศึกษา ----------
async function students() {
  const [levels, depts] = await Promise.all([api('/api/levels'), api('/api/departments')]);
  view.innerHTML = head('นักศึกษา', 'ค้นหา เพิ่ม และจัดการชั่วโมงของนักศึกษา',
    `<button class="btn" id="importBtn">นำเข้าหลายคน</button><button class="btn primary" id="addBtn">+ เพิ่มนักศึกษา</button>`) + `
    <div class="card">
      <div class="toolbar">
        <input id="q" placeholder="ค้นหารหัสหรือชื่อ" value="${esc(sessionStorage.q || '')}">
        <select id="dept">${deptOptions(depts, sessionStorage.dept || '', true)}</select>
        <select id="lvl">${levelOptions(levels, sessionStorage.lvl, 'ทุกชั้นปี')}</select>
        <select id="st"><option value="">ทุกสถานะ</option><option value="owing">ค้างชั่วโมง</option><option value="done">ครบแล้ว</option><option value="none">ไม่มีชั่วโมง</option><option value="red">ติดดาวแดง</option></select>
        <span class="muted small" id="count"></span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>รหัส</th><th>ชื่อ-สกุล</th><th>ชั้นปี</th><th>แผนก</th><th class="num">สั่ง</th><th class="num">ทำแล้ว</th><th style="width:150px">ความคืบหน้า</th><th>สถานะ</th></tr></thead>
        <tbody id="rows"></tbody></table></div>
    </div>`;
  $('#st').value = sessionStorage.st || '';
  let timer;
  const load = async () => {
    sessionStorage.q = $('#q').value; sessionStorage.lvl = $('#lvl').value; sessionStorage.st = $('#st').value; sessionStorage.dept = $('#dept').value;
    let rows = await api(`/api/students?q=${encodeURIComponent($('#q').value.trim())}&level_id=${$('#lvl').value}&dept=${encodeURIComponent($('#dept').value)}`);
    const st = $('#st').value;
    if (st) rows = rows.filter(r => st === 'red' ? r.red_stars > 0 : st === 'none' ? !r.assigned : st === 'owing' ? remaining(r) > 0 : r.assigned && !remaining(r));
    $('#count').textContent = `พบ ${rows.length} คน`;
    $('#rows').innerHTML = rows.map(r => `<tr class="click" onclick="location.hash='student/${r.id}'">
      <td>${esc(r.username)}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.level || '-')}</td><td class="small">${esc(r.department || '-')}</td>
      <td class="num">${fmtH(r.assigned)}</td><td class="num">${fmtH(r.done)}</td><td>${progressBar(r)}</td><td>${statusBadge(r)}</td></tr>`).join('')
      || '<tr><td colspan="8" class="empty">ไม่พบนักศึกษา</td></tr>';
  };
  $('#q').oninput = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
  $('#lvl').onchange = $('#st').onchange = $('#dept').onchange = load;
  $('#addBtn').onclick = () => studentModal(null, load);
  $('#importBtn').onclick = () => importModal(load);
  await load();
}

// แผนกและชั้นปีของนักศึกษา
async function studentModal(s, done) {
  const [depts, levels] = await Promise.all([api('/api/departments'), api('/api/levels')]);
  const f = openModal({
    title: s ? 'แก้ไขข้อมูลนักศึกษา' : 'เพิ่มนักศึกษา',
    body: `<label>รหัสนักศึกษา (ใช้เป็นชื่อผู้ใช้)<input name="username" required value="${esc(s ? s.username : '')}"></label>
      <label>ชื่อ-สกุล<input name="name" required value="${esc(s ? s.name : '')}" placeholder="นาย/นางสาว ..."></label>
      <div class="form-row" style="margin-bottom:6px">
        <label class="grow">แผนก<select name="department" required>${deptOptions(depts, s && s.department || '').replace('- ไม่ระบุแผนก -', '- เลือกแผนก -')}</select></label>
        <label>ชั้นปี<select name="level_id" required>${levelOptions(levels, s && s.level_id, '- เลือกชั้นปี -')}</select></label></div>
      <div class="level-pick">${levels.map(l => `<button type="button" class="chip ${s && s.level_id === l.id ? 'on' : ''}" data-level="${l.id}">${esc(l.name)}</button>`).join('')}</div>
      <p class="small muted dept-hint" style="margin:0 0 12px"></p>
      ${s ? '' : '<label>รหัสผ่าน <span class="muted small">(เว้นว่าง = ใช้รหัสนักศึกษา)</span><input type="password" name="password"></label>'}`,
    onSubmit: async d => {
      if (s) await api('/api/students/' + s.id, { method: 'PUT', body: d });
      else { const r = await api('/api/students', { method: 'POST', body: d }); toast('เพิ่มนักศึกษาเรียบร้อย'); return location.hash = 'student/' + r.id; }
      toast('บันทึกเรียบร้อย'); done();
    }
  });
  const deptSel = $('[name=department]', f), lvlSel = $('[name=level_id]', f), hint = $('.dept-hint', f);
  const groupOf = name => (depts.find(g => g.items.includes(name)) || {}).group;
  const sync = () => {
    $$('.level-pick .chip', f).forEach(c => c.classList.toggle('on', c.dataset.level === lvlSel.value));
    const lv = levels.find(l => String(l.id) === lvlSel.value);
    hint.textContent = deptSel.value || lv ? [lv && 'ชั้น ' + lv.name, deptSel.value && 'แผนก' + deptSel.value, deptSel.value && 'ประเภทวิชา' + groupOf(deptSel.value)].filter(Boolean).join(' · ') : '';
  };
  // ปุ่มชั้นปีกดเลือกได้เร็ว ใช้คู่กับช่องเลือก
  $('.level-pick', f).onclick = e => { const c = e.target.closest('.chip'); if (c) { lvlSel.value = c.dataset.level; sync(); } };
  deptSel.onchange = lvlSel.onchange = sync;
  sync();
}

function importModal(done) {
  openModal({
    title: 'นำเข้านักศึกษาหลายคน',
    submitText: 'นำเข้า',
    body: `<p class="muted small" style="margin-top:0">วางข้อมูล 1 บรรทัดต่อ 1 คน: <b>รหัส, ชื่อ-สกุล, ชั้นปี, แผนก</b> (คัดลอกจาก Excel ได้เลย)
      ชั้นปีพิมพ์ได้หลายแบบ เช่น ปวช.1 / ปวช 1 · ชื่อแผนกต้องตรงกับในระบบ · รหัสผ่านเริ่มต้น = รหัสนักศึกษา</p>
      <textarea name="data" required placeholder="66001, นายสมชาย ใจดี, ปวช.1, ช่างยนต์&#10;66002, นางสาวสมหญิง รักเรียน, ปวส.2, การบัญชี"></textarea>`,
    onSubmit: async d => {
      const rows = d.data.split(/\r?\n/).map(l => l.split(/\t|,/).map(x => x.trim())).filter(c => c[0])
        .filter(c => !/^รหัส/.test(c[0])).map(([username, name, level, department]) => ({ username, name, level, department }));
      if (!rows.length) throw new Error('ไม่พบข้อมูล');
      const r = await api('/api/students/import', { method: 'POST', body: { rows } });
      toast(`นำเข้า ${r.added} คน` + (r.skipped.length ? ` · ข้าม/แจ้งเตือน ${r.skipped.length} รายการ` : ''));
      if (r.skipped.length) alert(r.skipped.map(x => `${x.username || '(ว่าง)'}: ${x.reason}`).join('\n'));
      done();
    }
  });
}

// ---------- รายละเอียดนักศึกษา ----------
async function student(id) {
  const [{ student: s, logs }, types, term] = await Promise.all([api('/api/students/' + id), api('/api/activity-types'), api('/api/term')]);
  const left = remaining(s);
  view.innerHTML = `<a class="crumb" href="#students">กลับไปหน้ารายชื่อนักศึกษา</a>` +
    head(`${esc(s.name)} ${redStarBadge(s)}`, `รหัส ${esc(s.username)} · ชั้น ${esc(s.level || '-')} · ${deptText(s)}${s.group ? ` (${esc(s.group)})` : ''}`,
      `<a class="btn primary" href="/print.html?id=${s.id}" target="_blank">พิมพ์แบบฟอร์ม</a>
       <button class="btn" id="editBtn">แก้ไข</button><button class="btn" id="pwBtn">รีเซ็ตรหัสผ่าน</button>
       ${isAdmin() ? '<button class="btn danger" id="delBtn">ลบ</button>' : ''}`) + `
    <div class="stats">
      <div class="stat"><div><div class="v">${fmtH(s.assigned)}</div><div class="k">ชั่วโมงที่สั่ง</div></div></div>
      <div class="stat ok"><div><div class="v">${fmtH(s.done)}</div><div class="k">ทำแล้ว</div></div></div>
      <div class="stat ${left > 0 ? 'bad' : 'ok'}"><div><div class="v">${fmtH(left)}</div><div class="k">คงเหลือ</div></div></div>
      <div class="stat"><div style="flex:1"><div class="v">${pct(s.done, s.assigned)}%</div>
        <div class="progress" style="margin-top:6px"><div style="width:${pct(s.done, s.assigned)}%"></div></div></div></div>
    </div>
    ${deadlineNote(term, left)}
    <div class="card"><h3 style="margin-bottom:12px">ลงชั่วโมง</h3>${logForm(types)}</div>
    <div class="card"><div class="card-head"><h3>ประวัติ</h3>
      <div class="seg"><input type="radio" name="f" id="fa" value="" checked><label for="fa">ทั้งหมด</label>
        <input type="radio" name="f" id="fb" value="assign"><label for="fb">คำสั่ง</label>
        <input type="radio" name="f" id="fc" value="done"><label for="fc">ทำแล้ว</label></div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>วันที่</th><th>ประเภท</th><th>เหตุผล / รายละเอียด</th><th>กิจกรรม</th><th class="num">ชม.</th><th>ผู้บันทึก</th><th></th></tr></thead>
        <tbody id="logRows"></tbody></table></div></div>`;

  const drawLogs = f => {
    $('#logRows').innerHTML = logs.filter(l => !f || l.type === f).map(l => `<tr>
      <td>${thDate(l.date)}</td>
      <td>${l.type === 'assign' ? '<span class="badge warn">สั่ง</span>' : '<span class="badge ok">ทำแล้ว</span>'}</td>
      <td>${reasonHtml(l)}</td><td class="small">${esc(l.activity || '-')}</td><td class="num"><b>${fmtH(l.hours)}</b></td>
      <td class="small muted">${esc(l.recorder || '-')}</td>
      <td class="actions">${isRedStar(l) ? (isAdmin() ? `<button class="btn sm danger" data-del="${l.id}" data-star="1">ยกเลิกดาวแดง</button>` : '')
        : `<button class="btn sm" data-edit="${l.id}">แก้ไข</button> <button class="btn sm danger" data-del="${l.id}">ลบ</button>`}</td></tr>`).join('')
      || '<tr><td colspan="7" class="empty">ยังไม่มีรายการ</td></tr>';
  };
  drawLogs('');
  $$('input[name=f]').forEach(r => r.onchange = () => drawLogs(r.value));
  bindLogForm($('#logForm'), d => api('/api/logs', { method: 'POST', body: { ...d, student_id: s.id } }).then(() => { toast('บันทึกเรียบร้อย'); route(); }));

  $('#logRows').onclick = async e => {
    const del = e.target.dataset.del, ed = e.target.dataset.edit;
    const star = e.target.dataset.star;
    if (del && await (star ? confirmAsk('ยกเลิกดาวแดง', 'ยกเลิกดาวแดงครั้งนี้? ชั่วโมงที่ถูกคูณสองจะถูกหักออก', 'ยกเลิกดาวแดง')
      : confirmAsk('ลบรายการ', 'ต้องการลบรายการนี้ใช่ไหม?', 'ลบ'))) {
      await api('/api/logs/' + del, { method: 'DELETE' }); toast('ลบเรียบร้อย'); route();
    }
    if (ed) {
      const l = logs.find(x => String(x.id) === ed);
      const f = openModal({ title: 'แก้ไขรายการ', body: logFields(types, l), onSubmit: async (d, form) => {
        await api('/api/logs/' + l.id, { method: 'PUT', body: collectLog(form) }); toast('บันทึกเรียบร้อย'); route();
      } });
      bindTypeHint(f);
    }
  };
  $('#editBtn').onclick = () => studentModal(s, route);
  $('#pwBtn').onclick = () => openModal({
    title: 'รีเซ็ตรหัสผ่าน: ' + s.name,
    body: `<label>รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)<input name="password" required minlength="6" value="${esc(s.username.length >= 6 ? s.username : '')}"></label>
      <p class="muted small">ค่าเริ่มต้นคือรหัสนักศึกษา แจ้งให้นักศึกษาเปลี่ยนเองหลังเข้าสู่ระบบ</p>`,
    onSubmit: async d => { await api(`/api/students/${s.id}/password`, { method: 'POST', body: d }); toast('รีเซ็ตรหัสผ่านเรียบร้อย'); }
  });
  if (isAdmin()) $('#delBtn').onclick = async () => {
    if (!await confirmAsk('ลบนักศึกษา', `ลบ <b>${esc(s.name)}</b> และประวัติชั่วโมงทั้งหมด? ย้อนกลับไม่ได้`, 'ลบถาวร')) return;
    await api('/api/students/' + s.id, { method: 'DELETE' }); toast('ลบเรียบร้อย'); location.hash = 'students';
  };
}

// ฟอร์มลงชั่วโมง ใช้ทั้งหน้าคนเดียว หน้าหลายคน และหน้าต่างแก้ไข
// เหตุผลที่ใช้บ่อย พร้อมชั่วโมงที่แนะนำ (ครูแก้จำนวนชั่วโมงเองได้)
const REASONS = [
  ['มาสาย', 2], ['ขาดเรียนโดยไม่แจ้ง', 5], ['แต่งกายผิดระเบียบ', 3], ['ทรงผมผิดระเบียบ', 3],
  ['ไม่เข้าแถวหน้าเสาธง', 2], ['ไม่เข้าร่วมกิจกรรม', 3], ['ใช้โทรศัพท์ในเวลาเรียน', 2],
  ['หนีเรียน', 5], ['ทะเลาะวิวาท', 10], ['สูบบุหรี่ / บุหรี่ไฟฟ้า', 10], ['ทำลายทรัพย์สิน', 10]
];
const REASON_SEP = ' — ';
// แยกข้อความที่บันทึกไว้กลับเป็น เหตุผลที่เลือก + รายละเอียดเพิ่มเติม
function splitReason(text = '') {
  const [head, ...rest] = text.split(REASON_SEP);
  const parts = head.split(',').map(x => x.trim()).filter(Boolean);
  const picked = parts.filter(x => REASONS.some(r => r[0] === x));
  const other = parts.filter(x => !picked.includes(x));
  return { picked, detail: [other.join(', '), rest.join(REASON_SEP)].filter(Boolean).join(REASON_SEP) };
}

function logFields(types, l = {}) {
  const type = l.type || 'done';
  const uid = l.id || '';
  const r = type === 'assign' ? splitReason(l.text) : { picked: [], detail: '' };
  return `<div class="form-row" style="margin-bottom:12px">
      <label style="flex:0 0 auto">ประเภท<div class="seg">
        <input type="radio" name="type" id="t1${uid}" value="assign" ${type === 'assign' ? 'checked' : ''}><label for="t1${uid}">สั่งให้ทำ</label>
        <input type="radio" name="type" id="t2${uid}" value="done" ${type === 'done' ? 'checked' : ''}><label for="t2${uid}">ทำแล้ว</label></div></label>
      <label>วันที่<input type="date" name="date" required value="${l.date ? l.date.slice(0, 10) : today()}" max="${today()}"></label>
      <label class="w-sm">ชั่วโมง<input type="number" name="hours" required min="0.5" max="1000" step="0.5" value="${l.hours || ''}" ${l.id ? 'data-touched="1"' : ''}></label>
      <label>ประเภทกิจกรรม<select name="activity_type_id">${typeOptions(types, l.activity_type_id)}</select></label>
    </div>
    <div class="pane-assign" ${type === 'assign' ? '' : 'hidden'}>
      <div class="field-title">เหตุผลที่ให้ชั่วโมง <span class="muted small">(เลือกได้หลายข้อ หรือพิมพ์เพิ่มเอง)</span></div>
      <div class="chips">${REASONS.map(([n, h]) => `<button type="button" class="chip ${r.picked.includes(n) ? 'on' : ''}" data-reason="${esc(n)}" data-hours="${h}">
        ${esc(n)}<small>${h} ชม.</small></button>`).join('')}</div>
      <label>รายละเอียดเพิ่มเติม / เหตุผลอื่น
        <input name="reason_detail" maxlength="200" value="${esc(r.detail)}" placeholder="เช่น มาสาย 6 ครั้งในเดือนตุลาคม"></label>
      <div class="reason-preview"></div>
    </div>
    <div class="pane-done" ${type === 'done' ? '' : 'hidden'}>
      <label>รายละเอียดกิจกรรมที่ทำ
        <input name="done_text" required maxlength="255" value="${type === 'done' ? esc(l.text || '') : ''}" placeholder="เช่น ทำความสะอาดโรงอาหาร"></label>
    </div>`;
}
const logForm = types => `<form id="logForm">${logFields(types)}<button class="btn primary">บันทึก</button></form>`;

// รวมข้อมูลฟอร์มเป็นข้อมูลที่ส่งให้ API (เหตุผลเก็บในคอลัมน์ text เดิม)
function collectLog(form) {
  const d = Object.fromEntries(new FormData(form));
  if (d.type === 'assign') {
    const picked = $$('.chip.on', form).map(c => c.dataset.reason);
    d.text = [picked.join(', '), (d.reason_detail || '').trim()].filter(Boolean).join(REASON_SEP);
    if (!d.text) throw new Error('กรุณาเลือกหรือพิมพ์เหตุผลที่ให้ชั่วโมง');
  } else d.text = d.done_text;
  delete d.reason_detail; delete d.done_text;
  return d;
}

function bindTypeHint(form) {
  const hours = $('input[name=hours]', form);
  const panes = () => {
    const a = $('input[name=type]:checked', form).value === 'assign';
    $('.pane-assign', form).hidden = !a;
    $('.pane-done', form).hidden = a;
    $('input[name=done_text]', form).disabled = a;
    preview();
  };
  const preview = () => {
    const picked = $$('.chip.on', form);
    const sum = picked.reduce((t, c) => t + Number(c.dataset.hours), 0);
    if (!hours.dataset.touched && $('input[name=type]:checked', form).value === 'assign') {
      hours.value = sum || '';
      if (sum) { hours.classList.remove('flash'); void hours.offsetWidth; hours.classList.add('flash'); }
    }
    let text = [picked.map(c => c.dataset.reason).join(', '), $('input[name=reason_detail]', form).value.trim()].filter(Boolean).join(REASON_SEP);
    $('.reason-preview', form).innerHTML = text
      ? `จะบันทึกเหตุผลว่า: <b>${esc(text)}</b>${sum ? ` <span class="muted">(ชั่วโมงแนะนำ ${fmtH(sum)} ชม.)</span>` : ''}`
      : '<span class="muted">ยังไม่ได้ระบุเหตุผล</span>';
  };
  hours.addEventListener('input', () => { hours.dataset.touched = '1'; });
  $$('input[name=type]', form).forEach(r => r.addEventListener('change', panes));
  $('.chips', form).addEventListener('click', e => {
    const c = e.target.closest('.chip');
    if (!c) return;
    c.classList.toggle('on');
    preview();
  });
  $('input[name=reason_detail]', form).addEventListener('input', preview);
  form.addEventListener('reset', () => setTimeout(() => {
    $$('.chip.on', form).forEach(c => c.classList.remove('on'));
    delete hours.dataset.touched;
    panes();
  }));
  panes();
}
function bindLogForm(form, submit) {
  bindTypeHint(form);
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = $('button:not([type])', form); btn.disabled = true;
    try { await submit(collectLog(form)); } catch (err) { toast(err.message, 'err'); }
    btn.disabled = false;
  };
}

// ---------- ลงชั่วโมงหลายคน ----------
async function bulk() {
  const [levels, types, depts] = await Promise.all([api('/api/levels'), api('/api/activity-types'), api('/api/departments')]);
  view.innerHTML = head('ลงชั่วโมงหลายคนพร้อมกัน', 'เช่น สั่งชั่วโมงทั้งกลุ่มที่ทำผิดร่วมกัน หรือบันทึกกิจกรรมที่ทำพร้อมกันหลายคน') + `
    <div class="grid2">
      <div class="card"><div class="card-head"><h3>1. เลือกนักศึกษา</h3><span class="badge blue" id="selCount">เลือก 0 คน</span></div>
        <div class="toolbar"><select id="dept">${deptOptions(depts, '', true)}</select>
          <select id="lvl">${levelOptions(levels, '', 'ทุกชั้นปี')}</select>
          <input id="q" placeholder="ค้นหา"><label style="margin:0;font-weight:400"><input type="checkbox" id="all"> เลือกทั้งหมด</label></div>
        <div class="check-list" id="list"></div></div>
      <div class="card"><h3 style="margin-bottom:12px">2. รายละเอียด</h3><form id="logForm">${logFields(types)}<button class="btn primary block">บันทึกให้นักศึกษาที่เลือก</button></form></div>
    </div>`;
  const picked = new Set();
  let rows = [];
  const count = () => { const b = $('#selCount'); b.textContent = `เลือก ${picked.size} คน`; b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); };
  const load = async () => {
    rows = await api(`/api/students?q=${encodeURIComponent($('#q').value.trim())}&level_id=${$('#lvl').value}&dept=${encodeURIComponent($('#dept').value)}`);
    $('#list').innerHTML = rows.map(r => `<label><input type="checkbox" value="${r.id}" ${picked.has(r.id) ? 'checked' : ''}>
      <span style="flex:1"><b>${esc(r.name)}</b> <span class="muted small">${esc(r.username)} · ${esc(r.level || '-')}${r.department ? ' · ' + esc(r.department) : ''}</span></span>${statusBadge(r)}</label>`).join('')
      || '<p class="empty">ไม่พบนักศึกษา</p>';
    $('#all').checked = rows.length > 0 && rows.every(r => picked.has(r.id));
  };
  $('#list').onchange = e => { const id = Number(e.target.value); e.target.checked ? picked.add(id) : picked.delete(id); count(); };
  $('#all').onchange = e => { rows.forEach(r => e.target.checked ? picked.add(r.id) : picked.delete(r.id)); $$('#list input').forEach(c => c.checked = e.target.checked); count(); };
  let timer;
  $('#q').oninput = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
  $('#lvl').onchange = $('#dept').onchange = load;
  bindLogForm($('#logForm'), async d => {
    if (!picked.size) throw new Error('ยังไม่ได้เลือกนักศึกษา');
    const r = await api('/api/logs/bulk', { method: 'POST', body: { ...d, student_ids: [...picked] } });
    toast(`บันทึกให้ ${r.added} คนเรียบร้อย`);
    picked.clear(); count(); $('#logForm').reset(); load();
  });
  await load();
}

// ---------- ภาคเรียน / ดาวแดง ----------
// แถบแจ้งเตือนในหน้าภาพรวม
function termBanner(rs) {
  const left = daysUntil(rs.term.end), n = rs.candidates.length;
  if (rs.ended && n) return `<a class="term-banner danger" href="#redstar"><div><b>สิ้น${esc(rs.term.name)}แล้ว</b> · มีนักศึกษา ${n} คนทำชั่วโมงไม่ครบ ต้องติดดาวแดง</div><span class="btn sm">ไปหน้าดาวแดง</span></a>`;
  if (rs.ended) return `<div class="term-banner"><div><b>สิ้น${esc(rs.term.name)}แล้ว</b> · ไม่มีนักศึกษาที่ต้องติดดาวแดงเพิ่ม${isAdmin() ? ' อย่าลืมตั้งภาคเรียนใหม่ในหน้าดาวแดง' : ''}</div></div>`;
  return `<a class="term-banner ${left <= 14 && n ? 'warn' : ''}" href="#redstar"><div><b>${esc(rs.term.name)}</b> สิ้นสุด ${thDate(rs.term.end)} · เหลืออีก <b>${left}</b> วัน
    ${n ? ` · <b>${n}</b> คนเสี่ยงติดดาวแดง` : ''}</div><span class="btn sm">ดูรายละเอียด</span></a>`;
}
// กล่องเตือนกำหนดส่งในหน้ารายละเอียดนักศึกษา
function deadlineNote(term, left) {
  if (!(left > 0)) return '';
  const d = daysUntil(term.end);
  return d >= 0
    ? `<div class="alert-box ${d <= 14 ? 'danger' : 'warn'}">ต้องทำอีก <b>${fmtH(left)}</b> ชม. ให้ครบภายใน <b>${thDate(term.end)}</b> (อีก ${d} วัน)
        ไม่เช่นนั้นจะติดดาวแดง และชั่วโมงที่ค้างจะคูณสองเป็น <b>${fmtH(left * 2)}</b> ชม.</div>`
    : `<div class="alert-box danger">เลยวันสิ้น${esc(term.name)}แล้ว ยังค้าง <b>${fmtH(left)}</b> ชม.</div>`;
}

async function redstar() {
  const [rs, terms] = await Promise.all([api('/api/red-stars'), api('/api/terms')]);
  const t = rs.term, left = daysUntil(t.end);
  view.innerHTML = head('ดาวแดง', 'นักศึกษาที่ทำชั่วโมงไม่ครบภายในภาคเรียน จะติดดาวแดงและชั่วโมงที่ค้างจะถูกคูณสอง',
    isAdmin() ? '<button class="btn" id="termBtn">แก้วันภาคเรียนปัจจุบัน</button>' : '') + `
    <div class="stats">
      <div class="stat"><div><div class="k">ภาคเรียนปัจจุบัน</div><div class="v" style="font-size:20px">${esc(t.name)}</div>
        <div class="small muted">${thDate(t.start)} – ${thDate(t.end)}</div>
        <div class="small" style="margin-top:4px">${t.mode === 'auto' ? '<span class="badge blue">อัตโนมัติตามปฏิทิน สอศ.</span>' : '<span class="badge warn">ปรับวันเอง</span>'}</div></div></div>
      <div class="stat ${rs.ended ? 'bad' : left <= 14 ? 'warn' : ''}"><div><div class="v">${rs.ended ? 'สิ้นสุดแล้ว' : left}</div><div class="k">${rs.ended ? 'ภาคเรียนนี้' : 'วันก่อนสิ้นภาคเรียน'}</div></div></div>
      <div class="stat warn"><div><div class="v">${rs.candidates.length}</div><div class="k">${rs.ended ? 'ต้องติดดาวแดง' : 'เสี่ยงติดดาวแดง'}</div></div></div>
      <div class="stat bad"><div><div class="v">${rs.starred.length}</div><div class="k">ติดดาวแดงแล้วในภาคเรียนนี้</div></div></div>
    </div>
    <div class="card rule"><b>กติกา:</b> ถ้าถึงวันสิ้นภาคเรียน (${thDate(t.end)}) นักศึกษายังทำชั่วโมงไม่ครบ จะติดดาวแดง และชั่วโมงที่ค้างอยู่จะคูณสอง
      เช่น ค้าง 5 ชม. จะกลายเป็น 10 ชม. · นับเฉพาะชั่วโมงที่ลงวันที่ภายในภาคเรียน · ให้ดาวแดงได้ครั้งเดียวต่อคนต่อภาคเรียน</div>
    <div class="card">
      <div class="card-head"><h3>${rs.ended ? 'นักศึกษาที่ต้องติดดาวแดง' : 'นักศึกษาที่เสี่ยงติดดาวแดง (ถ้าสิ้นภาคเรียนวันนี้)'}</h3>
        ${rs.ended && isAdmin() && rs.candidates.length ? '<button class="btn danger-fill" id="applyBtn">ให้ดาวแดงคนที่เลือก</button>' : ''}</div>
      <div class="table-wrap"><table>
        <thead><tr>${rs.ended && isAdmin() ? '<th><input type="checkbox" id="all" checked></th>' : ''}<th>รหัส</th><th>ชื่อ-สกุล</th><th>ชั้นปี</th><th>แผนก</th>
          <th class="num">ค้างอยู่</th><th class="num">หลังคูณสอง</th></tr></thead>
        <tbody id="cand">${rs.candidates.map(c => `<tr>
          ${rs.ended && isAdmin() ? `<td><input type="checkbox" class="pick" value="${c.id}" checked></td>` : ''}
          <td>${esc(c.username)}</td><td><a href="#student/${c.id}"><b>${esc(c.name)}</b></a></td><td>${esc(c.level || '-')}</td><td class="small">${esc(c.department || '-')}</td>
          <td class="num"><span class="badge warn">${fmtH(c.remaining)} ชม.</span></td><td class="num"><span class="badge redstar">${fmtH(c.remaining * 2)} ชม.</span></td></tr>`).join('')
          || `<tr><td colspan="7" class="empty">${rs.ended ? 'ไม่มีนักศึกษาที่ต้องติดดาวแดง' : 'ยังไม่มีนักศึกษาที่เสี่ยงติดดาวแดง'}</td></tr>`}</tbody></table></div>
      ${!rs.ended ? `<p class="muted small" style="margin:12px 0 0">ให้ดาวแดงได้หลังวันที่ ${thDate(t.end)}</p>` : ''}
    </div>
    <div class="card"><h3 style="margin-bottom:12px">ติดดาวแดงแล้วใน${esc(t.name)}</h3><div class="table-wrap"><table>
      <thead><tr><th>รหัส</th><th>ชื่อ-สกุล</th><th>รายละเอียด</th><th class="num">ชม. ที่เพิ่ม</th></tr></thead>
      <tbody>${rs.starred.map(l => `<tr class="click" onclick="location.hash='student/${l.student_id}'"><td>${esc(l.username)}</td><td><b>${esc(l.name)}</b></td>
        <td>${reasonHtml({ ...l, type: 'assign' })}</td><td class="num">+${fmtH(l.hours)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">ยังไม่มี</td></tr>'}</tbody>
    </table></div></div>
    <div class="card"><h3 style="margin-bottom:4px">ภาคเรียนทั้งหมด</h3>
      <p class="muted small" style="margin:0 0 12px">ระบบสร้างภาคเรียนปัจจุบันและภาคเรียนถัดไปตามปฏิทิน สอศ. ให้อัตโนมัติ ภาคเรียนปัจจุบัน = ภาคเรียนล่าสุดที่ถึงวันเริ่มแล้ว
        (ถ้าวิทยาลัยเปิดภาคเรียนถัดไปเร็วขึ้น ให้แก้วันเริ่มของภาคเรียนนั้น)</p>
      <div class="table-wrap"><table>
      <thead><tr><th>ภาคเรียน</th><th>วันเริ่ม</th><th>วันสิ้นสุด</th><th>ที่มา</th><th class="num">ติดดาวแดง</th><th></th></tr></thead>
      <tbody id="termRows">${terms.map(x => `<tr><td><b>${esc(x.name)}</b> ${x.current ? '<span class="badge blue">ปัจจุบัน</span>' : ''}</td>
        <td>${thDate(x.start)}</td><td>${thDate(x.end)}</td>
        <td>${x.mode === 'auto' ? '<span class="small muted">ปฏิทิน สอศ.</span>' : '<span class="badge warn">ปรับวันเอง</span>'}</td>
        <td class="num">${x.red_stars ? `<span class="badge redstar">${x.red_stars} คน</span>` : 0}</td>
        <td class="actions">${isAdmin() ? `<button class="btn sm" data-term="${x.id}">แก้วัน</button>` : ''}</td></tr>`).join('')}</tbody>
    </table></div></div>`;

  if (isAdmin()) {
    $('#termBtn').onclick = () => termModal(terms.find(x => x.current) || t);
    $('#termRows').onclick = e => { const x = terms.find(y => String(y.id) === e.target.dataset.term); if (x) termModal(x); };
  }
  const all = $('#all');
  if (all) all.onchange = () => $$('.pick').forEach(c => c.checked = all.checked);
  const apply = $('#applyBtn');
  if (apply) apply.onclick = async () => {
    const ids = $$('.pick:checked').map(c => Number(c.value));
    if (!ids.length) return toast('ยังไม่ได้เลือกนักศึกษา', 'err');
    if (!await confirmAsk('ให้ดาวแดง', `ให้ดาวแดง <b>${ids.length}</b> คน ชั่วโมงที่ค้างของแต่ละคนจะถูกคูณสอง (ยกเลิกทีละคนได้ในหน้ารายละเอียดนักศึกษา)`, 'ให้ดาวแดง')) return;
    const r = await api('/api/red-stars/apply', { method: 'POST', body: { student_ids: ids } });
    toast(`ให้ดาวแดง ${r.added} คนเรียบร้อย`); route();
  };
}

function termModal(t) {
  const f = openModal({
    title: 'แก้วัน' + t.name,
    body: `<div class="form-row" style="margin-bottom:12px"><label>วันเริ่ม<input type="date" name="start" required value="${t.start}"></label>
        <label>วันสิ้นสุด (กำหนดส่งชั่วโมง)<input type="date" name="end" required value="${t.end}"></label></div>
      <p class="muted small">ปฏิทิน สอศ.: ภาคเรียนที่ 1 = 16 พ.ค. – 30 ก.ย. · ภาคเรียนที่ 2 = 1 พ.ย. – 31 มี.ค.
        ถ้าวิทยาลัยเลื่อนวัน แก้วันที่ได้ · นักศึกษาที่ค้างชั่วโมงหลังวันสิ้นสุดจะต้องติดดาวแดง</p>
      ${t.mode === 'manual' ? '<button type="button" class="btn sm" id="resetBtn">คืนค่าตามปฏิทิน สอศ.</button>' : ''}`,
    onSubmit: async d => { await api('/api/terms/' + t.id, { method: 'PUT', body: d }); toast('บันทึกภาคเรียนเรียบร้อย'); route(); }
  });
  const reset = $('#resetBtn', f);
  if (reset) reset.onclick = async () => {
    await api('/api/terms/' + t.id, { method: 'PUT', body: { reset: true } });
    f.parentElement.remove(); toast('คืนค่าตามปฏิทิน สอศ. แล้ว'); route();
  };
}

// ---------- แผนกวิชา (ผู้ดูแล) ----------
async function depts() {
  const tree = await api('/api/departments');
  const fieldOpts = sel => tree.map(g => `<option value="${g.id}" ${g.id === sel ? 'selected' : ''}>${esc(g.group)}</option>`).join('');
  view.innerHTML = head('แผนกวิชา', 'ประเภทวิชาและแผนกวิชา นักศึกษาแต่ละคนสังกัดแผนก',
    '<button class="btn" id="addField">+ เพิ่มประเภทวิชา</button>') + `
    <div class="card"><form class="form-row" id="addDept">
      <label class="grow">ชื่อแผนกใหม่<input name="name" required maxlength="100"></label>
      <label class="grow">ประเภทวิชา<select name="field_id">${fieldOpts()}</select></label>
      <button class="btn primary">+ เพิ่มแผนก</button></form></div>
    <div id="deptCards">${tree.map(g => `<div class="card"><div class="card-head"><h3>${esc(g.group)} <span class="muted small">${g.departments.length} แผนก</span></h3>
        <div class="btns"><button class="btn sm" data-fedit="${g.id}">แก้ชื่อ</button> <button class="btn sm danger" data-fdel="${g.id}">ลบ</button></div></div>
      <div class="table-wrap"><table><thead><tr><th>แผนก</th><th class="num">นักศึกษา</th><th></th></tr></thead>
      <tbody>${g.departments.map(d => `<tr><td><b>${esc(d.name)}</b></td><td class="num">${d.students}</td>
        <td class="actions"><button class="btn sm" data-dedit="${d.id}">แก้ไข</button> <button class="btn sm danger" data-ddel="${d.id}">ลบ</button></td></tr>`).join('')
        || '<tr><td colspan="3" class="empty">ยังไม่มีแผนก</td></tr>'}</tbody></table></div></div>`).join('')}</div>`;
  const allDepts = tree.flatMap(g => g.departments.map(d => ({ ...d, field_id: g.id })));
  $('#addDept').onsubmit = async e => {
    e.preventDefault();
    try { await api('/api/departments', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('เพิ่มแผนกเรียบร้อย'); route(); }
    catch (err) { toast(err.message, 'err'); }
  };
  $('#addField').onclick = () => openModal({ title: 'เพิ่มประเภทวิชา', body: '<label>ชื่อประเภทวิชา<input name="name" required maxlength="100"></label>',
    onSubmit: async d => { await api('/api/fields', { method: 'POST', body: d }); toast('เพิ่มประเภทวิชาเรียบร้อย'); route(); } });
  $('#deptCards').onclick = async e => {
    const { fedit, fdel, dedit, ddel } = e.target.dataset;
    const g = tree.find(x => String(x.id) === (fedit || fdel)), d = allDepts.find(x => String(x.id) === (dedit || ddel));
    if (fedit) openModal({ title: 'แก้ชื่อประเภทวิชา', body: `<label>ชื่อประเภทวิชา<input name="name" required value="${esc(g.group)}"></label>`,
      onSubmit: async x => { await api('/api/fields/' + g.id, { method: 'PUT', body: x }); toast('บันทึกเรียบร้อย'); route(); } });
    if (fdel && await confirmAsk('ลบประเภทวิชา', `ลบ "<b>${esc(g.group)}</b>"? (ต้องย้ายหรือลบแผนกในประเภทวิชานี้ก่อน)`, 'ลบ')) {
      try { await api('/api/fields/' + g.id, { method: 'DELETE' }); toast('ลบเรียบร้อย'); route(); } catch (err) { toast(err.message, 'err'); }
    }
    if (dedit) openModal({ title: 'แก้ไขแผนก',
      body: `<label>ชื่อแผนก<input name="name" required value="${esc(d.name)}"></label><label>ประเภทวิชา<select name="field_id">${fieldOpts(d.field_id)}</select></label>`,
      onSubmit: async x => { await api('/api/departments/' + d.id, { method: 'PUT', body: x }); toast('บันทึกเรียบร้อย'); route(); } });
    if (ddel && await confirmAsk('ลบแผนก', `ลบแผนก "<b>${esc(d.name)}</b>"? นักศึกษา ${d.students} คนจะกลายเป็น "ไม่ระบุแผนก"`, 'ลบ')) {
      await api('/api/departments/' + d.id, { method: 'DELETE' }); toast('ลบเรียบร้อย'); route();
    }
  };
}

// ---------- รายงาน ----------
async function reports() {
  const [levels, depts] = await Promise.all([api('/api/levels'), api('/api/departments')]);
  view.innerHTML = `<div class="no-print">${head('รายงาน', 'สรุปชั่วโมงรายแผนก รายชั้นปี และรายบุคคล',
    `<button class="btn" onclick="window.print()">พิมพ์รายงาน</button><a class="btn primary" id="csv">ส่งออก CSV (Excel)</a>`)}
    <div class="toolbar"><select id="dept">${deptOptions(depts, '', true)}</select>
      <select id="lvl">${levelOptions(levels, '', 'ทุกชั้นปี')}</select>
      <label style="margin:0;font-weight:400"><input type="checkbox" id="owing"> แสดงเฉพาะผู้ที่ค้างชั่วโมง</label></div></div>
    <div id="rep"></div>`;
  const load = async () => {
    const qs = `level_id=${$('#lvl').value}&dept=${encodeURIComponent($('#dept').value)}`;
    $('#csv').href = '/api/export.csv?' + qs;
    const r = await api('/api/reports?' + qs);
    let lastGroup = null;
    const deptRows = r.byDept.map(x => {
      const g = x.group !== lastGroup ? `<tr class="group-row"><td colspan="8">${esc(x.group || 'ไม่ระบุประเภทวิชา')}</td></tr>` : '';
      lastGroup = x.group;
      return g + `<tr><td><b>${esc(x.department)}</b></td><td class="num">${x.students}</td><td class="num">${fmtH(x.assigned)}</td>
        <td class="num">${fmtH(x.done)}</td><td class="num">${fmtH(x.remaining)}</td><td class="num">${x.completed}</td>
        <td class="num">${x.pending ? `<span class="badge warn">${x.pending}</span>` : 0}</td>
        <td class="num">${x.red_stars ? `<span class="badge redstar">${x.red_stars}</span>` : 0}</td></tr>`;
    }).join('');
    const list = $('#owing').checked ? r.students.filter(s => s.remaining > 0) : r.students;
    const sum = k => r.byLevel.reduce((t, x) => t + x[k], 0);
    $('#rep').innerHTML = `
      <div class="card"><h3 style="margin-bottom:12px">สรุปรายแผนก <span class="muted small">ณ วันที่ ${thDate(today())}</span></h3><div class="table-wrap"><table>
        <thead><tr><th>แผนก</th><th class="num">นักศึกษา</th><th class="num">ชม. ที่สั่ง</th><th class="num">ทำแล้ว</th><th class="num">คงเหลือ</th><th class="num">ครบ/ไม่มีชม.</th><th class="num">ค้าง</th><th class="num">ติดดาวแดง</th></tr></thead>
        <tbody>${deptRows || '<tr><td colspan="8" class="empty">ไม่มีข้อมูล</td></tr>'}</tbody></table></div></div>
      <div class="card"><h3 style="margin-bottom:12px">สรุปรายชั้นปี <span class="muted small">ณ วันที่ ${thDate(today())}</span></h3><div class="table-wrap"><table>
        <thead><tr><th>ชั้นปี</th><th class="num">นักศึกษา</th><th class="num">ชม. ที่สั่ง</th><th class="num">ทำแล้ว</th><th class="num">คงเหลือ</th><th class="num">ครบ/ไม่มีชม.</th><th class="num">ค้าง</th><th class="num">ติดดาวแดง</th></tr></thead>
        <tbody>${r.byLevel.map(x => `<tr><td><b>${esc(x.level)}</b></td><td class="num">${x.students}</td><td class="num">${fmtH(x.assigned)}</td>
          <td class="num">${fmtH(x.done)}</td><td class="num">${fmtH(x.remaining)}</td><td class="num">${x.completed}</td>
          <td class="num">${x.pending ? `<span class="badge warn">${x.pending}</span>` : 0}</td>
          <td class="num">${x.red_stars ? `<span class="badge redstar">${x.red_stars}</span>` : 0}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">ไม่มีข้อมูล</td></tr>'}</tbody>
        ${r.byLevel.length > 1 ? `<tfoot><tr><td>รวม</td><td class="num">${sum('students')}</td><td class="num">${fmtH(sum('assigned'))}</td><td class="num">${fmtH(sum('done'))}</td>
          <td class="num">${fmtH(sum('remaining'))}</td><td class="num">${sum('completed')}</td><td class="num">${sum('pending')}</td><td class="num">${sum('red_stars')}</td></tr></tfoot>` : ''}
      </table></div></div>
      <div class="card"><h3 style="margin-bottom:12px">รายบุคคล (${list.length} คน)</h3><div class="table-wrap"><table>
        <thead><tr><th>ที่</th><th>รหัส</th><th>ชื่อ-สกุล</th><th>ชั้นปี</th><th>แผนก</th><th class="num">สั่ง</th><th class="num">ทำแล้ว</th><th class="num">คงเหลือ</th><th>สถานะ</th></tr></thead>
        <tbody>${list.map((s, i) => `<tr class="click" onclick="location.hash='student/${s.id}'"><td>${i + 1}</td><td>${esc(s.username)}</td><td>${esc(s.name)}</td>
          <td>${esc(s.level || '-')}</td><td class="small">${esc(s.department || '-')}</td><td class="num">${fmtH(s.assigned)}</td><td class="num">${fmtH(s.done)}</td><td class="num"><b>${fmtH(s.remaining)}</b></td>
          <td>${statusBadge(s)}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">ไม่มีข้อมูล</td></tr>'}</tbody></table></div></div>`;
  };
  $('#lvl').onchange = $('#owing').onchange = $('#dept').onchange = load;
  await load();
}

// ---------- ชั้นปี / ประเภทกิจกรรม (ผู้ดูแล) ----------
function simpleList({ title, sub, url, label, cols, row }) {
  return async function page() {
    const items = await api(url);
    view.innerHTML = head(title, sub) + `
      <div class="card"><form class="form-row" id="addForm" style="margin-bottom:16px">
        <label class="grow">${label}ใหม่<input name="name" required maxlength="100"></label><button class="btn primary">+ เพิ่ม</button></form>
        <div class="table-wrap"><table><thead><tr><th>${label}</th>${cols.map(c => `<th class="num">${c}</th>`).join('')}<th></th></tr></thead>
        <tbody>${items.map(it => `<tr><td><b>${esc(it.name)}</b></td>${row(it).map(v => `<td class="num">${v}</td>`).join('')}
          <td class="actions"><button class="btn sm" data-edit="${it.id}">แก้ชื่อ</button> <button class="btn sm danger" data-del="${it.id}">ลบ</button></td></tr>`).join('')
          || `<tr><td colspan="${cols.length + 2}" class="empty">ยังไม่มีข้อมูล</td></tr>`}</tbody></table></div></div>`;
    $('#addForm').onsubmit = async e => {
      e.preventDefault();
      try { await api(url, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('เพิ่มเรียบร้อย'); route(); }
      catch (err) { toast(err.message, 'err'); }
    };
    view.querySelector('tbody').onclick = async e => {
      const it = items.find(x => String(x.id) === (e.target.dataset.edit || e.target.dataset.del));
      if (!it) return;
      if (e.target.dataset.edit) openModal({ title: 'แก้ชื่อ' + label, body: `<label>${label}<input name="name" required value="${esc(it.name)}"></label>`,
        onSubmit: async d => { await api(`${url}/${it.id}`, { method: 'PUT', body: d }); toast('บันทึกเรียบร้อย'); route(); } });
      else if (await confirmAsk('ยืนยันการลบ', `ลบ "<b>${esc(it.name)}</b>"? ข้อมูลที่ใช้${label}นี้จะกลายเป็น "ไม่ระบุ"`, 'ลบ')) {
        await api(`${url}/${it.id}`, { method: 'DELETE' }); toast('ลบเรียบร้อย'); route();
      }
    };
  };
}
function levels() {
  return simpleList({ title: 'ชั้นปี', sub: 'ระดับชั้นของนักศึกษา เช่น ปวช.1–3, ปวส.1–2 (เพิ่มได้ เช่น ทล.บ. ปี 1)', url: '/api/levels', label: 'ชื่อชั้นปี',
    cols: ['นักศึกษา'], row: l => [l.students] })();
}
function types() {
  return simpleList({ title: 'ประเภทกิจกรรม', sub: 'ประเภทงานบำเพ็ญประโยชน์ที่ใช้ตอนลงชั่วโมง', url: '/api/activity-types', label: 'ประเภทกิจกรรม',
    cols: ['ใช้แล้ว (ครั้ง)', 'ชม. ที่ทำ'], row: t => [t.uses, fmtH(t.hours)] })();
}

// ---------- ผู้ใช้งานระบบ (ผู้ดูแล) ----------
async function staff() {
  const list = await api('/api/staff');
  view.innerHTML = head('ผู้ใช้งานระบบ', 'บัญชีครูและผู้ดูแลระบบ', '<button class="btn primary" id="addBtn">+ เพิ่มผู้ใช้</button>') + `
    <div class="card"><div class="table-wrap"><table><thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อ</th><th>สิทธิ์</th><th></th></tr></thead>
    <tbody>${list.map(u => `<tr><td>${esc(u.username)}</td><td><b>${esc(u.name)}</b>${u.id === ME.id ? ' <span class="badge blue">คุณ</span>' : ''}</td>
      <td><span class="badge ${u.role === 'admin' ? 'bad' : 'blue'}">${ROLE_TH[u.role]}</span></td>
      <td class="actions"><button class="btn sm" data-edit="${u.id}">แก้ไข</button> <button class="btn sm" data-pw="${u.id}">รีเซ็ตรหัสผ่าน</button>
      ${u.id === ME.id ? '' : `<button class="btn sm danger" data-del="${u.id}">ลบ</button>`}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card small muted"><b>สิทธิ์การใช้งาน:</b> ครู ดูนักศึกษาทุกคน ลงชั่วโมง เพิ่มนักศึกษา และดูรายงานได้ ·
      ผู้ดูแลระบบ ทำได้ทุกอย่าง รวมถึงลบนักศึกษา จัดการแผนกวิชา ชั้นปี ประเภทกิจกรรม และผู้ใช้งาน</div>`;
  const roleSel = r => `<label>สิทธิ์<select name="role"><option value="teacher" ${r === 'teacher' ? 'selected' : ''}>ครู</option>
    <option value="admin" ${r === 'admin' ? 'selected' : ''}>ผู้ดูแลระบบ</option></select></label>`;
  $('#addBtn').onclick = () => openModal({
    title: 'เพิ่มผู้ใช้งาน',
    body: `<label>ชื่อผู้ใช้<input name="username" required></label><label>ชื่อ-สกุล<input name="name" required></label>${roleSel('teacher')}
      <label>รหัสผ่าน (อย่างน้อย 6 ตัวอักษร)<input type="password" name="password" required minlength="6"></label>`,
    onSubmit: async d => { await api('/api/staff', { method: 'POST', body: d }); toast('เพิ่มผู้ใช้เรียบร้อย'); route(); }
  });
  view.querySelector('tbody').onclick = async e => {
    const { edit, pw, del } = e.target.dataset;
    const u = list.find(x => String(x.id) === (edit || pw || del));
    if (!u) return;
    if (edit) openModal({ title: 'แก้ไขผู้ใช้: ' + u.username, body: `<label>ชื่อ-สกุล<input name="name" required value="${esc(u.name)}"></label>${roleSel(u.role)}`,
      onSubmit: async d => { await api('/api/staff/' + u.id, { method: 'PUT', body: d }); toast('บันทึกเรียบร้อย'); route(); } });
    if (pw) openModal({ title: 'รีเซ็ตรหัสผ่าน: ' + u.username, body: '<label>รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)<input type="password" name="password" required minlength="6"></label>',
      onSubmit: async d => { await api(`/api/staff/${u.id}/password`, { method: 'POST', body: d }); toast('รีเซ็ตรหัสผ่านเรียบร้อย'); } });
    if (del && await confirmAsk('ลบผู้ใช้', `ลบบัญชี <b>${esc(u.name)}</b>?`, 'ลบ')) {
      await api('/api/staff/' + u.id, { method: 'DELETE' }); toast('ลบเรียบร้อย'); route();
    }
  };
}

async function password() {
  view.innerHTML = head('เปลี่ยนรหัสผ่าน', `บัญชี ${esc(ME.username)}`) + '<div id="pw"></div>';
  changePasswordForm($('#pw'));
}
