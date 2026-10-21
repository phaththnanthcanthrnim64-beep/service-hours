
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const SCHOOL_NAME = process.env.SCHOOL_NAME || 'วิทยาลัยเทคนิคชัยนาท';

// ---------- ภาคเรียน ----------
const SETTINGS_FILE = path.join(__dirname, 'settings.json'); // ไฟล์จากเวอร์ชันเก่า ย้ายเข้าฐานข้อมูลครั้งแรกที่เปิด
const RED_STAR = 'ดาวแดง'; // ข้อความนำหน้าในคอลัมน์ logs.text ของรายการดาวแดง (ใช้ประกอบการแสดงผล)
const localToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
// ปฏิทินการศึกษาตามสำนักงานคณะกรรมการการอาชีวศึกษา (สอศ.)
// ภาคเรียนที่ 1 = 16 พ.ค. - 30 ก.ย., ภาคเรียนที่ 2 = 1 พ.ย. - 31 มี.ค. ปีถัดไป
const OVEC_TERMS = { 1: { start: '05-16', end: '09-30' }, 2: { start: '11-01', end: '03-31' } };
function ovecTerm(no, beYear) {
  const y = beYear - 543, t = OVEC_TERMS[no];
  return { name: `ภาคเรียนที่ ${no}/${beYear}`, start: `${y}-${t.start}`, end: `${no === 2 ? y + 1 : y}-${t.end}` };
}
const ovecByName = name => { const m = /([12])\/(\d{4})/.exec(name || ''); return m ? ovecTerm(Number(m[1]), Number(m[2])) : null; };
// ภาคเรียนตามปฏิทิน สอศ. ของวันที่ปัจจุบัน ช่วงปิดภาคเรียนยังนับเป็นภาคเรียนที่เพิ่งจบ เพื่อให้ดาวแดงได้
function autoTerm(today = localToday()) {
  const y = Number(today.slice(0, 4)), md = today.slice(5);
  if (md >= '05-16' && md < '11-01') return ovecTerm(1, y + 543);
  return ovecTerm(2, (md >= '11-01' ? y : y - 1) + 543);
}
function nextOvecTerm(term) {
  const m = /([12])\/(\d{4})/.exec(term.name);
  if (!m) return autoTerm();
  return m[1] === '1' ? ovecTerm(2, Number(m[2])) : ovecTerm(1, Number(m[2]) + 1);
}
const TERM_COLS = 'id, name, start_date AS start, end_date AS end';
// mode: auto = วันตรงกับปฏิทิน สอศ., manual = ผู้ดูแลปรับวันเอง
const withMode = t => { const o = ovecByName(t.name); return { ...t, mode: o && o.start === t.start && o.end === t.end ? 'auto' : 'manual' }; };
// เพิ่มภาคเรียนถ้ายังไม่มี (เช็กก่อน เพื่อไม่ให้ id กระโดดแบบ INSERT IGNORE)
async function ensureTerm(t) {
  if (!(await q('SELECT 1 FROM terms WHERE name=?', [t.name])).length)
    await q('INSERT IGNORE INTO terms(name, start_date, end_date) VALUES(?,?,?)', [t.name, t.start, t.end]);
}
// ภาคเรียนปัจจุบัน = ภาคเรียนล่าสุดที่เริ่มแล้ว (สร้างภาคเรียนปัจจุบันและถัดไปตาม สอศ. ให้อัตโนมัติ)
async function getTerm() {
  const auto = autoTerm();
  await ensureTerm(auto);
  await ensureTerm(nextOvecTerm(auto));
  const t = (await q(`SELECT ${TERM_COLS} FROM terms WHERE start_date <= ? ORDER BY start_date DESC LIMIT 1`, [localToday()]))[0]
    || (await q(`SELECT ${TERM_COLS} FROM terms WHERE name=?`, [auto.name]))[0];
  return withMode(t);
}

// ---------- แผนกวิชา (ตาราง fields = ประเภทวิชา, departments = แผนก) ----------
const DEFAULT_DEPARTMENTS = [
  { group: 'ช่างอุตสาหกรรม', items: ['ช่างยนต์', 'ช่างกลโรงงาน', 'ช่างเชื่อมโลหะ', 'ช่างไฟฟ้ากำลัง', 'ช่างอิเล็กทรอนิกส์',
    'เทคโนโลยีคอมพิวเตอร์', 'ช่างก่อสร้าง', 'โยธา', 'ช่างเทคนิคอุตสาหกรรม', 'เทคโนโลยีการผลิต (ทล.บ.)'] },
  { group: 'พาณิชยกรรม', items: ['การบัญชี', 'เลขานุการ', 'การตลาด', 'เทคโนโลยีธุรกิจดิจิทัล'] },
  { group: 'คหกรรม', items: ['คหกรรม'] }
];
// กรองตามแผนก: ค่า "ชื่อแผนก", "group:ชื่อประเภทวิชา" หรือ "none" (ยังไม่ระบุแผนก)
const matchDept = (r, filter) => !filter || (filter === 'none' ? !r.department
  : filter.startsWith('group:') ? r.group === filter.slice(6) : r.department === filter);

const DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'service_hours',
  // ฐานข้อมูลบนคลาวด์ (เช่น Aiven) ต้องเชื่อมต่อแบบ SSL: DB_SSL=1 และใส่ใบรับรอง CA ใน DB_SSL_CA ถ้ามี
  ...(process.env.DB_SSL === '1' ? { ssl: process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n') } : { rejectUnauthorized: false } } : {})
};
let pool;
// q(sql, [ค่า]) -> SELECT ได้ "แถวทั้งหมด" / INSERT-UPDATE-DELETE ได้ข้อมูลผลลัพธ์ (insertId ฯลฯ)
const q = async (sql, params) => (await pool.query(sql, params))[0];

// ชั้นปีเริ่มต้น
const DEFAULT_LEVELS = ['ปวช.1', 'ปวช.2', 'ปวช.3', 'ปวส.1', 'ปวส.2'];
// เทียบชื่อชั้นปีโดยไม่สนช่องว่างและจุด เช่น "ปวช 1", "ปวช1", "ปวช.1/2" -> ปวช.1
const levelKey = s => { const m = /(ปวช|ปวส)\.?\s*(\d)/.exec(String(s || '')); return m ? m[1] + m[2] : String(s || '').replace(/[\s.]/g, ''); };

// ---------- ฐานข้อมูลเชิงสัมพันธ์ 7 ตาราง ----------
const TABLES = [
`CREATE TABLE IF NOT EXISTS fields(
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS departments(
  id INT AUTO_INCREMENT PRIMARY KEY,
  field_id INT NOT NULL,
  name VARCHAR(100) NOT NULL UNIQUE,
  FOREIGN KEY (field_id) REFERENCES fields(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS levels(
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(30) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS users(
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  role ENUM('admin','teacher','student') NOT NULL,
  name VARCHAR(100) NOT NULL,
  level_id INT NULL,
  department_id INT NULL,
  FOREIGN KEY (level_id) REFERENCES levels(id) ON DELETE SET NULL,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS activity_types(
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS terms(
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(60) NOT NULL UNIQUE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS logs(
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  activity_type_id INT NULL,
  term_id INT NULL,
  type ENUM('assign','done') NOT NULL,
  \`date\` DATE NOT NULL,
  hours DOUBLE NOT NULL,
  \`text\` VARCHAR(255) NOT NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_logs_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (activity_type_id) REFERENCES activity_types(id) ON DELETE SET NULL,
  FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];

// เพิ่มคอลัมน์ให้ฐานข้อมูลเวอร์ชันเก่า (สร้างตารางไว้ก่อนมีแผนก/ภาคเรียน)
async function addColumn(table, column, ddl) {
  const has = await q('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', [table, column]);
  if (!has.length) await q(`ALTER TABLE ${table} ${ddl}`);
}
const tableExists = async t => (await q('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [t])).length > 0;

// ย้ายข้อมูลจากเวอร์ชันเก่า
// 1) settings.json (แผนกของห้อง, ภาคเรียน)  2) ห้องเรียน (classes) -> ชั้นปี + แผนกของนักศึกษา  3) ดาวแดงที่ระบุด้วยข้อความ
async function migrateOld() {
  const hasClasses = await tableExists('classes');
  let s = null;
  try { s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (e) { /* ไม่มีไฟล์เก่า */ }
  if (s) {
    if (hasClasses) {
      await addColumn('classes', 'department_id', 'ADD COLUMN department_id INT NULL');
      for (const [classId, dept] of Object.entries(s.classDept || {}))
        await q('UPDATE classes c JOIN departments d ON d.name=? SET c.department_id=d.id WHERE c.id=? AND c.department_id IS NULL', [dept, classId]);
    }
    if (s.term && s.term.name) {
      await ensureTerm(s.term);
      await q('UPDATE terms SET start_date=?, end_date=? WHERE name=?', [s.term.start, s.term.end, s.term.name]);
    }
    fs.renameSync(SETTINGS_FILE, SETTINGS_FILE + '.migrated');
    console.log('ย้ายข้อมูลจาก settings.json เข้าฐานข้อมูลแล้ว');
  }
  if (hasClasses) {
    await addColumn('classes', 'department_id', 'ADD COLUMN department_id INT NULL');
    const levels = await q('SELECT id, name FROM levels');
    const users = await q('SELECT u.id, c.name, c.department_id FROM users u JOIN classes c ON c.id=u.class_id');
    for (const u of users) {
      const lv = levels.find(l => levelKey(l.name) === levelKey(u.name));
      await q('UPDATE users SET level_id=COALESCE(level_id, ?), department_id=COALESCE(department_id, ?) WHERE id=?', [lv ? lv.id : null, u.department_id, u.id]);
    }
    const fks = await q("SELECT CONSTRAINT_NAME AS n FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='class_id' AND REFERENCED_TABLE_NAME IS NOT NULL");
    for (const fk of fks) await q(`ALTER TABLE users DROP FOREIGN KEY \`${fk.n}\``);
    await q('ALTER TABLE users DROP COLUMN class_id');
    await q('DROP TABLE classes');
    console.log(`ย้ายห้องเรียนเป็นชั้นปีแล้ว (${users.length} คน)`);
  }
  const old = await q("SELECT id, `text` FROM logs WHERE type='assign' AND term_id IS NULL AND `text` LIKE ?", [RED_STAR + ' %']);
  for (const l of old) {
    const t = ovecByName(l.text);
    if (!t) continue;
    await ensureTerm(t);
    await q('UPDATE logs l JOIN terms t ON t.name=? SET l.term_id=t.id WHERE l.id=?', [t.name, l.id]);
  }
}

async function initDb() {
  // พยายามสร้างฐานข้อมูลให้เอง (ถ้าสิทธิ์ไม่พอ เช่น Host ที่สร้างไว้แล้ว ก็ข้ามไป)
  try {
    const c = await mysql.createConnection({ host: DB.host, port: DB.port, user: DB.user, password: DB.password, ssl: DB.ssl });
    await c.query('CREATE DATABASE IF NOT EXISTS `' + DB.database + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    await c.end();
  } catch (e) { /* ไปลองต่อด้วย pool ด้านล่าง */ }

  pool = mysql.createPool({ ...DB, charset: 'utf8mb4', dateStrings: true, waitForConnections: true, connectionLimit: 10 });
  for (const sql of TABLES) await pool.query(sql);
  await addColumn('users', 'level_id', 'ADD COLUMN level_id INT NULL, ADD FOREIGN KEY (level_id) REFERENCES levels(id) ON DELETE SET NULL');
  await addColumn('users', 'department_id', 'ADD COLUMN department_id INT NULL, ADD FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL');
  await addColumn('logs', 'term_id', 'ADD COLUMN term_id INT NULL AFTER activity_type_id, ADD FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE');

  if (!(await q('SELECT 1 FROM fields LIMIT 1')).length) {
    for (const g of DEFAULT_DEPARTMENTS) {
      const f = await q('INSERT INTO fields(name) VALUES(?)', [g.group]);
      for (const d of g.items) await q('INSERT INTO departments(field_id, name) VALUES(?,?)', [f.insertId, d]);
    }
  }
  if (!(await q('SELECT 1 FROM levels LIMIT 1')).length)
    for (const n of DEFAULT_LEVELS) await q('INSERT INTO levels(name) VALUES(?)', [n]);

  if (!(await q("SELECT 1 FROM users WHERE role='admin' LIMIT 1")).length) {
    const pw = process.env.ADMIN_PASSWORD || 'admin123';
    await q("INSERT INTO users(username,password_hash,role,name) VALUES('admin',?, 'admin','ผู้ดูแลระบบ')", [bcrypt.hashSync(pw, 10)]);
    console.log('สร้างผู้ดูแลเริ่มต้น: admin /', process.env.ADMIN_PASSWORD ? '(ตาม ADMIN_PASSWORD)' : 'admin123 (กรุณาเปลี่ยน)');
  }
  if (!(await q('SELECT 1 FROM activity_types LIMIT 1')).length) {
    for (const n of ['ทำความสะอาดอาคาร/ห้องเรียน', 'ดูแลสวนและพื้นที่สีเขียว', 'ช่วยงานห้องสมุด', 'ช่วยงานกิจกรรมวิทยาลัย', 'อื่น ๆ'])
      await q('INSERT INTO activity_types(name) VALUES(?)', [n]);
  }
  await migrateOld();
}

// ---------- เซิร์ฟเวอร์ ----------
const app = express();
if (process.env.COOKIE_SECURE === '1') app.set('trust proxy', 1); // ใช้หลัง nginx + HTTPS
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1', maxAge: 8 * 3600 * 1000 }
}));
// หน้าเว็บ: ใช้โฟลเดอร์ public ถ้ามี ไม่เช่นนั้นใช้ไฟล์ที่วางไว้ข้าง server.js (กรณีอัปโหลดขึ้น GitHub แบบไม่มีโฟลเดอร์)
// ส่งให้เฉพาะไฟล์หน้าเว็บในรายการนี้ ไฟล์อื่น เช่น server.js จะเปิดจากเว็บไม่ได้
const PUBLIC_FILES = ['index.html', 'admin.html', 'print.html', 'style.css', 'app.js', 'admin.js', 'logo.png'];
const STATIC_DIR = fs.existsSync(path.join(__dirname, 'public', 'index.html')) ? path.join(__dirname, 'public') : __dirname;
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const file = req.path === '/' ? 'index.html' : req.path.slice(1);
  if (!PUBLIC_FILES.includes(file)) return next();
  res.sendFile(path.join(STATIC_DIR, file));
});

const bad = (res, code, msg) => res.status(code).json({ error: msg });
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next); // ส่ง error ของ async ไปที่ตัวจัดการกลาง
const STAFF = ['admin', 'teacher'];
// ตรวจสิทธิ์ 3 ระดับ: admin / teacher / student
const need = (...roles) => (req, res, next) => {
  const u = req.session.user;
  if (!u) return bad(res, 401, 'กรุณาเข้าสู่ระบบ');
  if (roles.length && !roles.includes(u.role)) return bad(res, 403, 'ไม่มีสิทธิ์ใช้งานส่วนนี้');
  next();
};

// ---------- ล็อกอิน ----------
const fails = new Map();
const tooMany = ip => { const f = fails.get(ip); return f && f.n >= 10 && Date.now() - f.t < 900000; };

app.post('/api/login', wrap(async (req, res) => {
  if (tooMany(req.ip)) return bad(res, 429, 'ลองผิดหลายครั้ง กรุณารอสักครู่');
  const { username, password } = req.body || {};
  const u = (await q('SELECT * FROM users WHERE username=?', [String(username || '').trim()]))[0];
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) {
    const f = fails.get(req.ip);
    fails.set(req.ip, f && Date.now() - f.t < 900000 ? { n: f.n + 1, t: f.t } : { n: 1, t: Date.now() });
    return bad(res, 401, 'รหัสผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }
  fails.delete(req.ip);
  req.session.regenerate(() => {
    req.session.user = { id: u.id, role: u.role, name: u.name, username: u.username };
    res.json(req.session.user);
  });
}));
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', need(), (req, res) => res.json(req.session.user));
app.get('/api/config', (req, res) => res.json({ school: SCHOOL_NAME }));

app.post('/api/me/password', need(), wrap(async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 6) return bad(res, 400, 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัวอักษร');
  const u = (await q('SELECT * FROM users WHERE id=?', [req.session.user.id]))[0];
  if (!bcrypt.compareSync(String(oldPassword || ''), u.password_hash)) return bad(res, 400, 'รหัสผ่านเดิมไม่ถูกต้อง');
  await q('UPDATE users SET password_hash=? WHERE id=?', [bcrypt.hashSync(String(newPassword), 10), u.id]);
  res.json({ ok: true });
}));

// ---------- แผนก / ชั้นปี / ประเภทกิจกรรม (ผู้ดูแลจัดการ, ครูอ่านได้) ----------
// รายชื่อแผนกจัดกลุ่มตามประเภทวิชา (สำหรับตัวเลือก)
async function departmentTree() {
  const rows = await q(`SELECT f.id AS field_id, f.name AS field, d.id, d.name,
    (SELECT COUNT(*) FROM users u WHERE u.department_id=d.id AND u.role='student') AS students
    FROM fields f LEFT JOIN departments d ON d.field_id=f.id ORDER BY f.id, d.id`);
  const tree = [];
  for (const r of rows) {
    let g = tree.find(x => x.id === r.field_id);
    if (!g) tree.push(g = { id: r.field_id, group: r.field, items: [], departments: [] });
    if (r.id) { g.items.push(r.name); g.departments.push({ id: r.id, name: r.name, students: Number(r.students) }); }
  }
  return tree;
}
app.get('/api/departments', need(...STAFF), wrap(async (req, res) => res.json(await departmentTree())));
const nameOf = body => String((body || {}).name || '').trim();
app.post('/api/fields', need('admin'), wrap(async (req, res) => {
  if (!nameOf(req.body)) return bad(res, 400, 'กรอกชื่อประเภทวิชา');
  await q('INSERT INTO fields(name) VALUES(?)', [nameOf(req.body)]);
  res.json({ ok: true });
}));
app.put('/api/fields/:id', need('admin'), wrap(async (req, res) => {
  if (!nameOf(req.body)) return bad(res, 400, 'กรอกชื่อประเภทวิชา');
  await q('UPDATE fields SET name=? WHERE id=?', [nameOf(req.body), req.params.id]);
  res.json({ ok: true });
}));
app.delete('/api/fields/:id', need('admin'), wrap(async (req, res) => { await q('DELETE FROM fields WHERE id=?', [req.params.id]); res.json({ ok: true }); }));
app.post('/api/departments', need('admin'), wrap(async (req, res) => {
  const fid = Number((req.body || {}).field_id);
  if (!nameOf(req.body) || !fid) return bad(res, 400, 'กรอกชื่อแผนกและเลือกประเภทวิชา');
  await q('INSERT INTO departments(field_id, name) VALUES(?,?)', [fid, nameOf(req.body)]);
  res.json({ ok: true });
}));
app.put('/api/departments/:id', need('admin'), wrap(async (req, res) => {
  const fid = Number((req.body || {}).field_id);
  if (!nameOf(req.body) || !fid) return bad(res, 400, 'กรอกชื่อแผนกและเลือกประเภทวิชา');
  await q('UPDATE departments SET name=?, field_id=? WHERE id=?', [nameOf(req.body), fid, req.params.id]);
  res.json({ ok: true });
}));
app.delete('/api/departments/:id', need('admin'), wrap(async (req, res) => { await q('DELETE FROM departments WHERE id=?', [req.params.id]); res.json({ ok: true }); }));

app.get('/api/levels', need(...STAFF), wrap(async (req, res) => res.json(await q(
  "SELECT lv.id, lv.name, COUNT(u.id) AS students FROM levels lv LEFT JOIN users u ON u.level_id=lv.id AND u.role='student' GROUP BY lv.id, lv.name ORDER BY lv.id"))));
app.post('/api/levels', need('admin'), wrap(async (req, res) => {
  if (!nameOf(req.body)) return bad(res, 400, 'กรอกชื่อชั้นปี');
  await q('INSERT INTO levels(name) VALUES(?)', [nameOf(req.body).slice(0, 30)]);
  res.json({ ok: true });
}));
app.put('/api/levels/:id', need('admin'), wrap(async (req, res) => {
  if (!nameOf(req.body)) return bad(res, 400, 'กรอกชื่อชั้นปี');
  await q('UPDATE levels SET name=? WHERE id=?', [nameOf(req.body).slice(0, 30), req.params.id]);
  res.json({ ok: true });
}));
app.delete('/api/levels/:id', need('admin'), wrap(async (req, res) => { await q('DELETE FROM levels WHERE id=?', [req.params.id]); res.json({ ok: true }); }));

app.get('/api/activity-types', need(...STAFF), wrap(async (req, res) => res.json(await q(
  "SELECT a.id, a.name, COUNT(l.id) AS uses, COALESCE(SUM(CASE WHEN l.type='done' THEN l.hours END),0) AS hours FROM activity_types a LEFT JOIN logs l ON l.activity_type_id=a.id GROUP BY a.id, a.name ORDER BY a.id"))));
app.post('/api/activity-types', need('admin'), wrap(async (req, res) => {
  const n = String((req.body || {}).name || '').trim();
  if (!n) return bad(res, 400, 'กรอกชื่อประเภทกิจกรรม');
  await q('INSERT INTO activity_types(name) VALUES(?)', [n]);
  res.json({ ok: true });
}));
app.put('/api/activity-types/:id', need('admin'), wrap(async (req, res) => {
  const n = String((req.body || {}).name || '').trim();
  if (!n) return bad(res, 400, 'กรอกชื่อประเภทกิจกรรม');
  await q('UPDATE activity_types SET name=? WHERE id=?', [n, req.params.id]);
  res.json({ ok: true });
}));
app.delete('/api/activity-types/:id', need('admin'), wrap(async (req, res) => { await q('DELETE FROM activity_types WHERE id=?', [req.params.id]); res.json({ ok: true }); }));

// ---------- บัญชีผู้ดูแล/ครู (admin เท่านั้น) ----------
app.get('/api/staff', need('admin'), wrap(async (req, res) =>
  res.json(await q("SELECT id,username,name,role FROM users WHERE role IN ('admin','teacher') ORDER BY role,username"))));
app.post('/api/staff', need('admin'), wrap(async (req, res) => {
  const { username, name, role, password } = req.body || {};
  if (!String(username || '').trim() || !String(name || '').trim() || !STAFF.includes(role)) return bad(res, 400, 'ข้อมูลไม่ครบ');
  if (String(password || '').length < 6) return bad(res, 400, 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร');
  await q('INSERT INTO users(username,password_hash,role,name) VALUES(?,?,?,?)',
    [String(username).trim(), bcrypt.hashSync(String(password), 10), role, String(name).trim()]);
  res.json({ ok: true });
}));
app.delete('/api/staff/:id', need('admin'), wrap(async (req, res) => {
  if (String(req.session.user.id) === req.params.id) return bad(res, 400, 'ลบบัญชีตัวเองไม่ได้');
  await q("DELETE FROM users WHERE id=? AND role IN ('admin','teacher')", [req.params.id]);
  res.json({ ok: true });
}));
app.put('/api/staff/:id', need('admin'), wrap(async (req, res) => {
  const { name, role } = req.body || {};
  if (!String(name || '').trim() || !STAFF.includes(role)) return bad(res, 400, 'ข้อมูลไม่ครบ');
  if (String(req.session.user.id) === req.params.id && role !== 'admin') return bad(res, 400, 'ลดสิทธิ์บัญชีตัวเองไม่ได้');
  await q("UPDATE users SET name=?, role=? WHERE id=? AND role IN ('admin','teacher')", [String(name).trim(), role, req.params.id]);
  res.json({ ok: true });
}));
app.post('/api/staff/:id/password', need('admin'), wrap(async (req, res) => {
  const pw = String((req.body || {}).password || '');
  if (pw.length < 6) return bad(res, 400, 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร');
  await q("UPDATE users SET password_hash=? WHERE id=? AND role IN ('admin','teacher')", [bcrypt.hashSync(pw, 10), req.params.id]);
  res.json({ ok: true });
}));

// ---------- นักศึกษา ----------
async function studentRows({ level, q: kw, id, dept } = {}) {
  let sql = `SELECT u.id, u.username, u.name, u.level_id, lv.name AS level,
    d.id AS department_id, d.name AS department, f.id AS field_id, f.name AS \`group\`,
    COALESCE(SUM(CASE WHEN l.type='assign' THEN l.hours END),0) AS assigned,
    COALESCE(SUM(CASE WHEN l.type='done' THEN l.hours END),0) AS done,
    COUNT(l.term_id) AS red_stars
    FROM users u LEFT JOIN levels lv ON lv.id=u.level_id LEFT JOIN departments d ON d.id=u.department_id
    LEFT JOIN fields f ON f.id=d.field_id LEFT JOIN logs l ON l.user_id=u.id
    WHERE u.role='student'`;
  const p = [];
  if (id) { sql += ' AND u.id=?'; p.push(id); }
  if (level) { sql += ' AND u.level_id=?'; p.push(Number(level)); }
  if (kw) { sql += ' AND (u.username LIKE ? OR u.name LIKE ?)'; p.push('%' + kw + '%', '%' + kw + '%'); }
  const rows = await q(sql + ' GROUP BY u.id, u.username, u.name, u.level_id, lv.name, d.id, d.name, f.id, f.name ORDER BY u.username', p);
  return rows.map(r => ({ ...r, assigned: Number(r.assigned), done: Number(r.done), red_stars: Number(r.red_stars) }))
    .filter(r => matchDept(r, dept));
}

app.get('/api/students', need(...STAFF), wrap(async (req, res) =>
  res.json(await studentRows({ level: req.query.level_id, dept: req.query.dept, q: String(req.query.q || '').trim() }))));

// แผนกส่งมาเป็นชื่อ (ตามตัวเลือกในฟอร์ม) แปลงเป็น id
async function studentInput(body) {
  const { username, name, level_id, department } = body || {};
  const un = String(username || '').trim(), nm = String(name || '').trim(), dn = String(department || '').trim();
  if (!un || !nm) return { error: 'กรอกรหัสและชื่อนักศึกษา' };
  let dept = null;
  if (dn) {
    const d = (await q('SELECT id FROM departments WHERE name=?', [dn]))[0];
    if (!d) return { error: 'ไม่พบแผนกนี้' };
    dept = d.id;
  }
  return { un, nm, level: level_id ? Number(level_id) : null, dept };
}
app.post('/api/students', need(...STAFF), wrap(async (req, res) => {
  const v = await studentInput(req.body);
  if (v.error) return bad(res, 400, v.error);
  if ((await q('SELECT 1 FROM users WHERE username=?', [v.un])).length) return bad(res, 409, 'รหัสนี้มีในระบบแล้ว');
  const r = await q("INSERT INTO users(username,password_hash,role,name,level_id,department_id) VALUES(?,?, 'student',?,?,?)",
    [v.un, bcrypt.hashSync(String(req.body.password || v.un), 10), v.nm, v.level, v.dept]);
  res.json({ id: r.insertId });
}));
app.put('/api/students/:id', need(...STAFF), wrap(async (req, res) => {
  const v = await studentInput(req.body);
  if (v.error) return bad(res, 400, v.error);
  if ((await q('SELECT 1 FROM users WHERE username=? AND id<>?', [v.un, req.params.id])).length) return bad(res, 409, 'รหัสนี้มีในระบบแล้ว');
  await q("UPDATE users SET username=?, name=?, level_id=?, department_id=? WHERE id=? AND role='student'",
    [v.un, v.nm, v.level, v.dept, req.params.id]);
  res.json({ ok: true });
}));
// นำเข้าหลายคน: rows = [{ username, name, level, department }] (ชั้นปีและแผนกจับคู่จากชื่อที่มีในระบบ)
app.post('/api/students/import', need(...STAFF), wrap(async (req, res) => {
  const rows = Array.isArray((req.body || {}).rows) ? req.body.rows.slice(0, 1000) : [];
  const levels = await q('SELECT id, name FROM levels');
  const depts = new Map((await q('SELECT id, name FROM departments')).map(d => [d.name, d.id]));
  const result = { added: 0, skipped: [] };
  for (const r of rows) {
    const un = String(r.username || '').trim(), nm = String(r.name || '').trim();
    const ln = String(r.level || '').trim(), dn = String(r.department || '').trim();
    if (!un || !nm) { result.skipped.push({ username: un, reason: 'ข้อมูลไม่ครบ' }); continue; }
    if ((await q('SELECT 1 FROM users WHERE username=?', [un])).length) { result.skipped.push({ username: un, reason: 'รหัสซ้ำ' }); continue; }
    const lv = ln ? levels.find(l => levelKey(l.name) === levelKey(ln)) : null;
    await q("INSERT INTO users(username,password_hash,role,name,level_id,department_id) VALUES(?,?, 'student',?,?,?)",
      [un, bcrypt.hashSync(un, 10), nm, lv ? lv.id : null, depts.get(dn) || null]);
    result.added++;
    const miss = [ln && !lv && `ชั้นปี "${ln}"`, dn && !depts.has(dn) && `แผนก "${dn}"`].filter(Boolean);
    if (miss.length) result.skipped.push({ username: un, reason: 'เพิ่มแล้ว แต่ไม่พบ' + miss.join(' และ ') });
  }
  res.json(result);
}));
app.delete('/api/students/:id', need('admin'), wrap(async (req, res) => { await q("DELETE FROM users WHERE id=? AND role='student'", [req.params.id]); res.json({ ok: true }); }));
app.post('/api/students/:id/password', need(...STAFF), wrap(async (req, res) => {
  const pw = String((req.body || {}).password || '');
  if (pw.length < 6) return bad(res, 400, 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร');
  await q("UPDATE users SET password_hash=? WHERE id=? AND role='student'", [bcrypt.hashSync(pw, 10), req.params.id]);
  res.json({ ok: true });
}));

// นักศึกษาเห็นเฉพาะของตัวเอง, ครู/ผู้ดูแลเห็นทุกคน
app.get('/api/students/:id', need(), wrap(async (req, res) => {
  const me = req.session.user;
  if (!STAFF.includes(me.role) && String(me.id) !== req.params.id) return bad(res, 403, 'ไม่มีสิทธิ์');
  const s = (await studentRows({ id: req.params.id }))[0];
  if (!s) return bad(res, 404, 'ไม่พบนักศึกษา');
  const logs = await q('SELECT l.id, l.type, l.`date`, l.hours, l.`text`, l.activity_type_id, l.term_id, a.name AS activity, b.name AS recorder FROM logs l ' +
    'LEFT JOIN activity_types a ON a.id=l.activity_type_id LEFT JOIN users b ON b.id=l.created_by ' +
    'WHERE l.user_id=? ORDER BY l.`date` DESC, l.id DESC', [req.params.id]);
  res.json({ student: s, logs });
}));

// ---------- บันทึกชั่วโมง ----------
// ตรวจข้อมูลบันทึก คืนค่า [activity_type_id, type, date, hours, text] หรือ null ถ้าไม่ถูกต้อง
function logFields({ type, date, hours, text, activity_type_id } = {}) {
  const h = Number(hours);
  if (!['assign', 'done'].includes(type) || !(h > 0 && h <= 1000) || !/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !String(text || '').trim()) return null;
  return [activity_type_id ? Number(activity_type_id) : null, type, date, h, String(text).trim().slice(0, 255)];
}
app.post('/api/logs', need(...STAFF), wrap(async (req, res) => {
  const f = logFields(req.body);
  if (!f) return bad(res, 400, 'ข้อมูลไม่ครบหรือไม่ถูกต้อง');
  const { student_id } = req.body;
  if (!(await q("SELECT 1 FROM users WHERE id=? AND role='student'", [student_id])).length) return bad(res, 404, 'ไม่พบนักศึกษา');
  await q('INSERT INTO logs(user_id, activity_type_id, type, `date`, hours, `text`, created_by) VALUES(?,?,?,?,?,?,?)',
    [student_id, ...f, req.session.user.id]);
  res.json({ ok: true });
}));
// บันทึกรายการเดียวกันให้นักศึกษาหลายคนพร้อมกัน
app.post('/api/logs/bulk', need(...STAFF), wrap(async (req, res) => {
  const f = logFields(req.body);
  const ids = Array.isArray((req.body || {}).student_ids) ? req.body.student_ids.map(Number).filter(Boolean) : [];
  if (!f || !ids.length) return bad(res, 400, 'ข้อมูลไม่ครบหรือไม่ได้เลือกนักศึกษา');
  const valid = (await q("SELECT id FROM users WHERE role='student' AND id IN (?)", [ids])).map(r => r.id);
  for (const id of valid)
    await q('INSERT INTO logs(user_id, activity_type_id, type, `date`, hours, `text`, created_by) VALUES(?,?,?,?,?,?,?)', [id, ...f, req.session.user.id]);
  res.json({ added: valid.length });
}));
app.put('/api/logs/:id', need(...STAFF), wrap(async (req, res) => {
  const f = logFields(req.body);
  if (!f) return bad(res, 400, 'ข้อมูลไม่ครบหรือไม่ถูกต้อง');
  await q('UPDATE logs SET activity_type_id=?, type=?, `date`=?, hours=?, `text`=? WHERE id=?', [...f, req.params.id]);
  res.json({ ok: true });
}));
app.delete('/api/logs/:id', need(...STAFF), wrap(async (req, res) => { await q('DELETE FROM logs WHERE id=?', [req.params.id]); res.json({ ok: true }); }));

// ---------- ภาคเรียน + ดาวแดง ----------
app.get('/api/term', need(), wrap(async (req, res) => res.json({ ...(await getTerm()), today: localToday() })));
app.get('/api/terms', need(...STAFF), wrap(async (req, res) => {
  const current = await getTerm();
  const rows = await q(`SELECT t.id, t.name, t.start_date AS start, t.end_date AS end, COUNT(l.id) AS red_stars
    FROM terms t LEFT JOIN logs l ON l.term_id=t.id GROUP BY t.id, t.name, t.start_date, t.end_date ORDER BY t.start_date DESC`);
  res.json(rows.map(t => ({ ...withMode(t), red_stars: Number(t.red_stars), current: t.id === current.id })));
}));
// แก้วันของภาคเรียน หรือ reset = คืนค่าตามปฏิทิน สอศ.
app.put('/api/terms/:id', need('admin'), wrap(async (req, res) => {
  const t = (await q(`SELECT ${TERM_COLS} FROM terms WHERE id=?`, [req.params.id]))[0];
  if (!t) return bad(res, 404, 'ไม่พบภาคเรียน');
  let { start, end, reset } = req.body || {};
  if (reset) { const o = ovecByName(t.name); if (!o) return bad(res, 400, 'ภาคเรียนนี้ไม่มีในปฏิทิน สอศ.'); ({ start, end } = o); }
  const d = /^\d{4}-\d{2}-\d{2}$/;
  if (!d.test(start || '') || !d.test(end || '') || start > end) return bad(res, 400, 'กรอกวันที่ให้ถูกต้อง (วันเริ่มต้องไม่หลังวันสิ้นสุด)');
  await q('UPDATE terms SET start_date=?, end_date=? WHERE id=?', [start, end, t.id]);
  res.json({ ok: true });
}));

// นักศึกษาที่ยังค้างชั่วโมง ณ วันสิ้นภาคเรียน (นับเฉพาะรายการที่ลงวันที่ไม่เกินวันสิ้นภาคเรียน)
// และยังไม่เคยได้ดาวแดงของภาคเรียนนี้
async function redStarCandidates(term) {
  const rows = await q(`SELECT u.id, u.username, u.name, lv.name AS level, d.name AS department,
    COALESCE(SUM(CASE WHEN l.type='assign' THEN l.hours END),0) AS assigned,
    COALESCE(SUM(CASE WHEN l.type='done' THEN l.hours END),0) AS done,
    COUNT(CASE WHEN l.term_id=? THEN 1 END) AS already
    FROM users u LEFT JOIN levels lv ON lv.id=u.level_id LEFT JOIN departments d ON d.id=u.department_id
    LEFT JOIN logs l ON l.user_id=u.id AND l.\`date\` <= ?
    WHERE u.role='student' GROUP BY u.id, u.username, u.name, lv.name, d.name ORDER BY u.username`, [term.id, term.end]);
  return rows.map(r => ({ id: r.id, username: r.username, name: r.name, level: r.level, department: r.department,
    remaining: Math.max(Number(r.assigned) - Number(r.done), 0), already: Number(r.already) }))
    .filter(r => r.remaining > 0 && !r.already);
}
app.get('/api/red-stars', need(...STAFF), wrap(async (req, res) => {
  const term = await getTerm();
  const starred = await q("SELECT l.id, l.hours, l.`text`, l.`date`, l.term_id, u.id AS student_id, u.username, u.name FROM logs l JOIN users u ON u.id=l.user_id " +
    'WHERE l.term_id=? ORDER BY l.`date` DESC, u.username', [term.id]);
  res.json({ term, today: localToday(), ended: localToday() > term.end, candidates: await redStarCandidates(term), starred });
}));
// ให้ดาวแดง: เพิ่มคำสั่งชั่วโมงเท่ากับที่ค้าง (ผูกกับภาคเรียนด้วย term_id) ทำให้ชั่วโมงคงเหลือกลายเป็น 2 เท่า
app.post('/api/red-stars/apply', need('admin'), wrap(async (req, res) => {
  const term = await getTerm();
  if (localToday() <= term.end) return bad(res, 400, 'ยังไม่สิ้นภาคเรียน ให้ดาวแดงได้หลังวันสิ้นภาคเรียนเท่านั้น');
  const ids = Array.isArray((req.body || {}).student_ids) ? new Set(req.body.student_ids.map(Number)) : null;
  const list = (await redStarCandidates(term)).filter(r => !ids || ids.has(r.id));
  const fmt = n => Number(n.toFixed(1)).toString();
  for (const r of list)
    await q("INSERT INTO logs(user_id, activity_type_id, term_id, type, `date`, hours, `text`, created_by) VALUES(?,?,?, 'assign',?,?,?,?)",
      [r.id, null, term.id, term.end, r.remaining,
        `${RED_STAR} ${term.name} — ทำชั่วโมงไม่ครบภายในภาคเรียน ค้าง ${fmt(r.remaining)} ชม. จึงคูณสองเป็น ${fmt(r.remaining * 2)} ชม.`,
        req.session.user.id]);
  res.json({ added: list.length });
}));

// ---------- ภาพรวม ----------
app.get('/api/stats', need(...STAFF), wrap(async (req, res) => {
  const rows = await studentRows();
  const owing = rows.filter(r => r.assigned > r.done).map(r => ({ ...r, remaining: r.assigned - r.done }))
    .sort((a, b) => b.remaining - a.remaining);
  const recent = await q('SELECT l.id, l.type, l.`date`, l.hours, l.`text`, u.id AS student_id, u.username, u.name, b.name AS recorder ' +
    'FROM logs l JOIN users u ON u.id=l.user_id LEFT JOIN users b ON b.id=l.created_by ORDER BY l.id DESC LIMIT 10');
  const monthly = await q("SELECT DATE_FORMAT(`date`, '%Y-%m') AS month, SUM(CASE WHEN type='assign' THEN hours ELSE 0 END) AS assigned, " +
    "SUM(CASE WHEN type='done' THEN hours ELSE 0 END) AS done FROM logs WHERE `date` >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01') " +
    'GROUP BY month ORDER BY month');
  res.json({
    students: rows.length,
    owing: owing.length,
    completed: rows.filter(r => r.assigned > 0 && r.assigned <= r.done).length,
    assigned: rows.reduce((t, r) => t + r.assigned, 0),
    done: rows.reduce((t, r) => t + r.done, 0),
    topOwing: owing.slice(0, 10),
    recent,
    monthly: monthly.map(m => ({ month: m.month, assigned: Number(m.assigned), done: Number(m.done) }))
  });
}));

// ---------- รายงาน ----------
async function report(level, dept) {
  const rows = await studentRows({ level, dept });
  const summarize = keyOf => {
    const m = {};
    rows.forEach(r => {
      const [k, extra] = keyOf(r);
      const x = m[k] || (m[k] = { ...extra, students: 0, assigned: 0, done: 0, remaining: 0, completed: 0, pending: 0, red_stars: 0 });
      const rem = Math.max(r.assigned - r.done, 0);
      x.students++; x.assigned += r.assigned; x.done += r.done; x.remaining += rem; x.red_stars += r.red_stars ? 1 : 0;
      rem ? x.pending++ : x.completed++;
    });
    return Object.values(m);
  };
  // สรุปรายแผนก เรียงตามประเภทวิชาและแผนก (ไม่ระบุแผนกอยู่ท้าย)
  const byDept = summarize(r => [r.department || '-', { department: r.department || 'ไม่ระบุแผนก', group: r.group || '',
    order: r.department_id ? r.field_id * 100000 + r.department_id : Infinity }])
    .sort((a, b) => a.order - b.order);
  // สรุปรายชั้นปี เรียงตามลำดับชั้นปี
  const byLevel = summarize(r => [r.level || '-', { level: r.level || 'ไม่ระบุชั้นปี', order: r.level_id || Infinity }])
    .sort((a, b) => a.order - b.order);
  return { byDept, byLevel, students: rows.map(r => ({ ...r, remaining: Math.max(r.assigned - r.done, 0) })) };
}
app.get('/api/reports', need(...STAFF), wrap(async (req, res) => res.json(await report(req.query.level_id, req.query.dept))));
app.get('/api/export.csv', need(...STAFF), wrap(async (req, res) => {
  const esc = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const lines = ['รหัสนักศึกษา,ชื่อ-สกุล,ชั้นปี,แผนก,ประเภทวิชา,ชั่วโมงที่กำหนด,ทำแล้ว,คงเหลือ,ดาวแดง']
    .concat((await report(req.query.level_id, req.query.dept)).students.map(r =>
      [esc(r.username), esc(r.name), esc(r.level), esc(r.department), esc(r.group), r.assigned, r.done, r.remaining, r.red_stars].join(',')));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="service-hours.csv"');
  res.send('\ufeff' + lines.join('\r\n'));
}));

// ตัวจัดการ error กลาง
app.use((e, req, res, next) => {
  console.error(e);
  const dup = e && e.code === 'ER_DUP_ENTRY';
  if (e && e.code === 'ER_ROW_IS_REFERENCED_2') return bad(res, 409, 'ลบไม่ได้ เพราะยังมีข้อมูลอื่นใช้อยู่ (เช่น ประเภทวิชาที่ยังมีแผนก)');
  bad(res, dup ? 409 : 500, dup ? 'ข้อมูลนี้มีในระบบแล้ว' : 'เกิดข้อผิดพลาดในระบบ');
});

initDb()
  .then(() => app.listen(PORT, () => console.log('เปิดใช้งานที่ http://localhost:' + PORT)))
  .catch(e => { console.error('เชื่อมฐานข้อมูลไม่ได้:', e.message); process.exit(1); });
