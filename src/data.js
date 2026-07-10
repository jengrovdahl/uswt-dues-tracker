import { query, run, uid } from './db';

export async function updateChapter(id, fields) {
  const cols = [];
  const args = [];
  for (const [key, col] of Object.entries({
    name: 'name', chapterNum: 'chapter_num', district: 'district', state: 'state',
    president: 'president', presidentPhone: 'president_phone', presidentEmail: 'president_email',
    meetingNight: 'meeting_night',
  })) {
    if (fields[key] !== undefined) { cols.push(`${col} = ?`); args.push(fields[key]); }
  }
  if (cols.length === 0) return;
  args.push(id);
  await run(`UPDATE chapters SET ${cols.join(', ')} WHERE id = ?`, args);
}

export async function getChapters() {
  return query('SELECT * FROM chapters ORDER BY name');
}

export async function addChapter(c) {
  const id = uid();
  await run(
    `INSERT INTO chapters (id, name, chapter_num, district, state, president, president_phone, president_email, meeting_night)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, c.name, c.chapterNum || '', c.district || '', c.state || '', c.president || '', c.presidentPhone || '', c.presidentEmail || '', c.meetingNight || '']
  );
  return id;
}

export async function getMembers(chapterId = null) {
  if (chapterId) {
    return query('SELECT * FROM members WHERE chapter_id = ? ORDER BY last_name', [chapterId]);
  }
  return query('SELECT * FROM members ORDER BY last_name');
}

export async function addMember(m) {
  const id = uid();
  await run(
    `INSERT INTO members (id, chapter_id, last_name, first_name, address, city, state, zip, home_phone, email, birthdate, join_date, ssn, status, trans_code, uspp, tri_due, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, m.chapterId, m.lastName, m.firstName, m.address || '', m.city || '', m.state || '', m.zip || '',
     m.homePhone || '', m.email || '', m.birthdate || '', m.joinDate || new Date().toISOString().slice(0, 10),
     m.ssn || '0', m.status || 'active', (m.transCode !== undefined && m.transCode !== null) ? m.transCode : 'new', m.uspp ? 1 : 0, m.triDue || null, m.notes || '']
  );
  await logEvent(id, m.chapterId, m.transCode || 'new', 'Added to roster');
  return id;
}

export async function updateMember(id, fields) {
  const cols = [];
  const args = [];
  for (const [key, col] of Object.entries({
    lastName: 'last_name', firstName: 'first_name', address: 'address', city: 'city',
    state: 'state', zip: 'zip', homePhone: 'home_phone', email: 'email',
    birthdate: 'birthdate', joinDate: 'join_date', ssn: 'ssn', triDue: 'tri_due', transCode: 'trans_code',
  })) {
    if (fields[key] !== undefined) { cols.push(`${col} = ?`); args.push(fields[key]); }
  }
  if (cols.length === 0) return;
  args.push(id);
  await run(`UPDATE members SET ${cols.join(', ')}, updated_at = datetime('now') WHERE id = ?`, args);
}

export async function updateMemberStatus(memberId, chapterId, action) {
  const transCode = action === 'drop' ? 'drop' : action === 'transfer' ? 'transfer' : 'rnew';
  const status = action === 'drop' ? 'dropped' : 'active';
  await run(
    `UPDATE members SET status = ?, trans_code = ?, updated_at = datetime('now') WHERE id = ?`,
    [status, transCode, memberId]
  );
  await logEvent(memberId, chapterId, action, `Marked ${action} via roster`);
}

export async function logEvent(memberId, chapterId, eventType, note) {
  await run(
    `INSERT INTO member_events (id, member_id, chapter_id, event_type, note) VALUES (?, ?, ?, ?, ?)`,
    [uid(), memberId, chapterId, eventType, note || '']
  );
}

export async function getIntakeQueue() {
  return query(`SELECT * FROM intake_queue WHERE status = 'pending' ORDER BY submitted_date`);
}

export async function addIntake(entry) {
  const id = uid();
  await run(
    `INSERT INTO intake_queue (id, first_name, last_name, address, city, state, zip, phone, email, birthdate, submitted_date, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, entry.firstName, entry.lastName, entry.address || '', entry.city || '', entry.state || '', entry.zip || '',
     entry.phone || '', entry.email || '', entry.birthdate || '', entry.submitted || new Date().toISOString().slice(0, 10), entry.source || '']
  );
  return id;
}

export async function approveIntake(intakeRow, chapterId) {
  await addMember({
    chapterId,
    firstName: intakeRow.first_name,
    lastName: intakeRow.last_name,
    address: intakeRow.address,
    city: intakeRow.city,
    state: intakeRow.state,
    zip: intakeRow.zip,
    homePhone: intakeRow.phone,
    email: intakeRow.email,
    birthdate: intakeRow.birthdate,
    joinDate: intakeRow.submitted_date,
    transCode: 'new',
  });
  await run(`UPDATE intake_queue SET status = 'approved' WHERE id = ?`, [intakeRow.id]);
}

export async function dismissIntake(id) {
  await run(`UPDATE intake_queue SET status = 'dismissed' WHERE id = ?`, [id]);
}

export async function getTrimesters() {
  return query('SELECT * FROM trimesters ORDER BY start_date');
}

export async function getEventsSince(dateIso) {
  return query('SELECT * FROM member_events WHERE event_date >= ? ORDER BY event_date', [dateIso]);
}

export async function bulkAddChapters(rows) {
  for (const r of rows) {
    await addChapter(r);
  }
}

export async function bulkAddMembers(rows, chapterId) {
  for (const r of rows) {
    await addMember({ ...r, chapterId });
  }
}

