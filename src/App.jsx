import { useEffect, useState, useCallback } from 'react';
import './index.css';
import * as api from './data';
import { parseChapterRosterPdf } from './pdfImport';

const TRI_DEFAULTS = [
  { name: '1st Trimester', cycle_number: 1, start_date: '2026-05-01', end_date: '2026-08-31', due_date: '2026-08-15' },
  { name: '2nd Trimester', cycle_number: 2, start_date: '2026-09-01', end_date: '2026-12-31', due_date: '2026-12-15' },
  { name: '3rd Trimester', cycle_number: 3, start_date: '2027-01-01', end_date: '2027-04-30', due_date: '2027-04-15' },
];

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
}
function daysUntil(iso) {
  const d = new Date(iso + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((d - now) / 86400000);
}
function currentTri(trimesters) {
  const now = new Date();
  let cur = trimesters[0];
  for (const t of trimesters) if (new Date(t.start_date) <= now) cur = t;
  return cur;
}
function parseDelimited(text) {
  return text.trim().split('\n').map(line => {
    const delim = line.includes('\t') ? '\t' : ',';
    return line.split(delim).map(cell => cell.trim().replace(/^"|"$/g, ''));
  }).filter(row => row.some(cell => cell));
}

function stampFor(m) {
  if (m.uspp) return <span className="stamp uspp">USPP</span>;
  if (m.status === 'dropped') return <span className="stamp drop">DROP</span>;
  if (m.trans_code === 'new') return <span className="stamp new">NEW</span>;
  if (m.trans_code === 'rnew') return <span className="stamp rnew">RNEW</span>;
  return <span className="stamp none">—</span>;
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [members, setMembers] = useState([]);
  const [intake, setIntake] = useState([]);
  const [trimesters, setTrimesters] = useState(TRI_DEFAULTS);
  const [tab, setTab] = useState('chapters');
  const [rosterChapter, setRosterChapter] = useState('');
  const [billingChapter, setBillingChapter] = useState('');
  const [showSSN, setShowSSN] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [bulkChaptersOpen, setBulkChaptersOpen] = useState(false);
  const [bulkChaptersText, setBulkChaptersText] = useState('');
  const [bulkMembersOpen, setBulkMembersOpen] = useState(false);
  const [bulkMembersText, setBulkMembersText] = useState('');
  const [bulkStatus, setBulkStatus] = useState('');
  const [pdfStatus, setPdfStatus] = useState('');
  const [pdfPreview, setPdfPreview] = useState(null);

  const refresh = useCallback(async () => {
    const [c, m, q, t] = await Promise.all([
      api.getChapters(), api.getMembers(), api.getIntakeQueue(), api.getTrimesters(),
    ]);
    setChapters(c);
    setMembers(m);
    setIntake(q);
    if (t.length) setTrimesters(t);
    if (c.length) {
      setRosterChapter(prev => prev || c[0].id);
      setBillingChapter(prev => prev || c[0].id);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await refresh();
      } catch (e) {
        console.error(e);
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  if (loading) return <div className="app"><div className="loading">Connecting to database…</div></div>;
  if (error) return (
    <div className="app">
      <div className="loading">
        Couldn't connect to Turso: {error}<br /><br />
        Check that VITE_TURSO_URL and VITE_TURSO_AUTH_TOKEN are set in your .env file (or repo secrets, for the deployed build).
      </div>
    </div>
  );

  const cur = currentTri(trimesters);
  const dd = daysUntil(cur.due_date);
  const activeMembers = members.filter(m => m.status === 'active');

  async function handleAddChapter(e) {
    e.preventDefault();
    const f = e.target;
    await api.addChapter({
      name: f.name.value.trim(),
      chapterNum: f.chapterNum.value.trim(),
      district: f.district.value.trim(),
      state: f.state.value.trim(),
      president: f.president.value.trim(),
    });
    f.reset();
    await refresh();
  }

  async function handleMark(memberId, chapterId, action) {
    await api.updateMemberStatus(memberId, chapterId, action);
    await refresh();
  }

  async function handleAddMember(e) {
    e.preventDefault();
    const f = e.target;
    await api.addMember({
      chapterId: rosterChapter,
      firstName: f.firstName.value.trim(),
      lastName: f.lastName.value.trim(),
      address: f.address.value.trim(),
      city: f.city.value.trim(),
      state: chapters.find(c => c.id === rosterChapter)?.state || '',
      zip: f.zip.value.trim(),
      homePhone: f.phone.value.trim(),
      email: f.email.value.trim(),
      birthdate: f.birthdate.value,
      joinDate: f.joinDate.value,
      ssn: f.ssn.value.trim() || '0',
      transCode: 'new',
    });
    f.reset();
    setAddMemberOpen(false);
    await refresh();
  }

  async function handleApproveIntake(row, chapterId) {
    await api.approveIntake(row, chapterId);
    await refresh();
  }
  async function handleDismissIntake(id) {
    await api.dismissIntake(id);
    await refresh();
  }

  async function handleBulkChapters() {
    const rows = parseDelimited(bulkChaptersText);
    const parsed = rows.map(r => ({
      name: r[0] || '', chapterNum: r[1] || '', district: r[2] || '', state: r[3] || '', president: r[4] || '',
    })).filter(r => r.name);
    if (parsed.length === 0) { setBulkStatus('No valid rows found — need at least a chapter name in column 1.'); return; }
    setBulkStatus(`Importing ${parsed.length} chapters…`);
    await api.bulkAddChapters(parsed);
    setBulkStatus(`Imported ${parsed.length} chapters.`);
    setBulkChaptersText('');
    await refresh();
  }

  async function handleBulkMembers() {
    const rows = parseDelimited(bulkMembersText);
    const parsed = rows.map(r => ({
      lastName: r[0] || '', firstName: r[1] || '', address: r[2] || '', city: r[3] || '', state: r[4] || '',
      zip: r[5] || '', homePhone: r[6] || '', email: r[7] || '', birthdate: r[8] || '', joinDate: r[9] || '',
      transCode: r.length > 10 ? (r[10] || '').toLowerCase() : 'new',
      uspp: /^(1|y|yes|true)$/i.test((r[11] || '').trim()),
      triDue: r[12] ? parseInt(r[12], 10) : null,
    })).filter(r => r.lastName && r.firstName);
    if (parsed.length === 0) { setBulkStatus('No valid rows found — need last name and first name in the first two columns.'); return; }
    setBulkStatus(`Importing ${parsed.length} members…`);
    await api.bulkAddMembers(parsed, rosterChapter);
    setBulkStatus(`Imported ${parsed.length} members.`);
    setBulkMembersText('');
    await refresh();
  }

  async function handlePdfFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setPdfStatus('Reading PDF…');
    setPdfPreview(null);
    try {
      const buf = await file.arrayBuffer();
      const result = await parseChapterRosterPdf(buf);
      setPdfPreview(result);
      setPdfStatus(`Found ${result.chapter.name || '(no chapter name detected)'} — ${result.members.length} members. Review below, then confirm import.`);
    } catch (err) {
      console.error(err);
      setPdfStatus(`Couldn't read that PDF: ${err.message}`);
    }
  }

  async function confirmPdfImport() {
    if (!pdfPreview) return;
    setPdfStatus('Importing…');
    const chapterId = await api.addChapter(pdfPreview.chapter);
    await api.bulkAddMembers(pdfPreview.members, chapterId);
    setPdfStatus(`Imported ${pdfPreview.chapter.name} with ${pdfPreview.members.length} members.`);
    setPdfPreview(null);
    await refresh();
  }

  function buildRecap() {
    const now = new Date();
    const lines = [];
    lines.push(`MONTHLY MEMBERSHIP RECAP — ${now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`);
    lines.push('Prepared for: USWT National President and Membership Vice President');
    lines.push('');
    chapters.forEach(c => {
      const cm = members.filter(m => m.chapter_id === c.id);
      const newAdds = cm.filter(m => m.trans_code === 'new');
      const renewals = cm.filter(m => m.trans_code === 'rnew');
      const drops = cm.filter(m => m.status === 'dropped');
      lines.push(`${c.name} (${c.chapter_num}), District ${c.district}`);
      lines.push(`  New adds: ${newAdds.length}${newAdds.length ? ' — ' + newAdds.map(m => m.first_name + ' ' + m.last_name).join(', ') : ''}`);
      lines.push(`  Renewals: ${renewals.length}${renewals.length ? ' — ' + renewals.map(m => m.first_name + ' ' + m.last_name).join(', ') : ''}`);
      lines.push(`  Drops: ${drops.length}${drops.length ? ' — ' + drops.map(m => m.first_name + ' ' + m.last_name).join(', ') : ''}`);
      lines.push(`  Active total: ${cm.filter(m => m.status === 'active').length}`);
      lines.push('');
    });
    lines.push(`Pending new-member intake (not yet added to any chapter): ${intake.length}`);
    return lines.join('\n');
  }

  const billingCh = chapters.find(c => c.id === billingChapter);
  const billingMembers = members.filter(m => m.chapter_id === billingChapter && m.status === 'active' && m.tri_due === cur.cycle_number);
  const billable = billingMembers.filter(m => !m.uspp);
  const rosterMembers = members.filter(m => m.chapter_id === rosterChapter);

  return (
    <div className="app">
      <div className="masthead">
        <div>
          <h1>USWT Membership Dues Tracker</h1>
          <div className="sub">TURSO-BACKED · LIVE</div>
        </div>
        <div className="org">United States Women of Today<br />Membership Records &amp; Billing</div>
      </div>

      <div className="ledger-rule">
        {trimesters.map(t => (
          <div key={t.name} className={`tri-tick ${t.name === cur.name ? 'current' : ''}`}>
            <div className="name">{t.name}</div>
            <div className="due">{fmtDate(t.start_date)} – {fmtDate(t.end_date)}</div>
            <div className="due" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Billing due {fmtDate(t.due_date)}</div>
          </div>
        ))}
        <div className="tri-countdown"><strong>{dd}</strong>days to mailing deadline</div>
      </div>

      <div className="cards">
        <div className="card"><div className="num">{chapters.length}</div><div className="lbl">Chapters on file</div></div>
        <div className="card"><div className="num">{activeMembers.length}</div><div className="lbl">Active members</div></div>
        <div className="card"><div className="num">{intake.length}</div><div className="lbl">Pending intake</div></div>
        <div className="card"><div className="num">{members.filter(m => m.status === 'dropped').length}</div><div className="lbl">Dropped this cycle</div></div>
      </div>

      <div className="tabs">
        {[
          ['chapters', 'Chapters'],
          ['roster', 'Roster'],
          ['intake', 'New member intake'],
          ['billing', 'Dues billing'],
          ['recap', 'Monthly recap'],
        ].map(([key, label]) => (
          <div key={key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{label}</div>
        ))}
      </div>

      {tab === 'chapters' && (
        <div>
          <h2 className="section">Chapters</h2>
          <p className="hint">Every chapter National assigns you. Add chapters as you take on more of the roster.</p>
          <form className="row" onSubmit={handleAddChapter}>
            <input type="text" name="name" placeholder="Chapter name" required />
            <input type="text" name="chapterNum" placeholder="Chapter #" style={{ width: 100 }} />
            <input type="text" name="district" placeholder="District #" style={{ width: 90 }} />
            <input type="text" name="state" placeholder="State" style={{ width: 70 }} />
            <input type="text" name="president" placeholder="President" />
            <button type="submit" className="primary">Add chapter</button>
          </form>
          <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <p className="hint" style={{ marginBottom: 8 }}>Drop in a Chapter Roster PDF from National — it reads the chapter details and every member, including each person's real Tri Due, directly off the file.</p>
            <input type="file" accept="application/pdf" onChange={handlePdfFile} />
            {pdfStatus && <p className="hint" style={{ marginTop: 8 }}>{pdfStatus}</p>}
            {pdfPreview && (
              <div style={{ marginTop: 10 }}>
                <table>
                  <thead><tr><th>Name</th><th>City</th><th>Tri due</th><th>Status</th></tr></thead>
                  <tbody>
                    {pdfPreview.members.map((m, i) => (
                      <tr key={i}>
                        <td>{m.lastName}, {m.firstName}</td>
                        <td>{m.city}, {m.state}</td>
                        <td style={{ fontFamily: 'var(--mono)', textAlign: 'center' }}>{m.triDue || '—'}</td>
                        <td>{m.uspp ? 'USPP' : (m.transCode || '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="primary" onClick={confirmPdfImport}>Confirm import</button>
                  <button className="ghost" onClick={() => { setPdfPreview(null); setPdfStatus(''); }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
          <div className="row">
            <button onClick={() => setBulkChaptersOpen(v => !v)}>{bulkChaptersOpen ? 'Cancel bulk import' : 'Or paste chapter rows manually'}</button>
          </div>
          {bulkChaptersOpen && (
            <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <p className="hint" style={{ marginBottom: 8 }}>
                Paste rows from a spreadsheet or CSV — one chapter per line, columns in this order: name, chapter #, district, state, president. Tab or comma separated both work.
              </p>
              <textarea className="recap" style={{ minHeight: 120 }} value={bulkChaptersText} onChange={e => setBulkChaptersText(e.target.value)} placeholder={'Example City Women of Today\tMN0099\t4\tMN\tPat Example'} />
              <div className="row" style={{ marginTop: 8 }}>
                <button className="primary" onClick={handleBulkChapters}>Import chapters</button>
                {bulkStatus && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{bulkStatus}</span>}
              </div>
            </div>
          )}
          {chapters.length === 0 ? <div className="empty">No chapters yet — add one above.</div> : (
            <table>
              <thead><tr><th>Chapter</th><th>Chapter #</th><th>District</th><th>State</th><th>President</th><th>Members</th></tr></thead>
              <tbody>
                {chapters.map(c => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td style={{ fontFamily: 'var(--mono)' }}>{c.chapter_num}</td>
                    <td>{c.district}</td><td>{c.state}</td><td>{c.president}</td>
                    <td>{members.filter(m => m.chapter_id === c.id && m.status === 'active').length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'roster' && (
        <div>
          <h2 className="section">Member roster</h2>
          <p className="hint">Mark renewals and drops here as returned forms come in — this feeds the quarterly billing and the monthly recap.</p>
          <div className="row">
            <label style={{ fontSize: 13, color: 'var(--muted)' }}>Chapter</label>
            <select value={rosterChapter} onChange={e => setRosterChapter(e.target.value)}>
              {chapters.map(c => <option key={c.id} value={c.id}>{c.name} ({c.chapter_num})</option>)}
            </select>
            <button onClick={() => setAddMemberOpen(v => !v)}>{addMemberOpen ? 'Cancel' : 'Add member'}</button>
            <button onClick={() => setBulkMembersOpen(v => !v)}>{bulkMembersOpen ? 'Cancel bulk import' : 'Bulk import members'}</button>
            <button onClick={() => setShowSSN(v => !v)}>{showSSN ? 'Hide SSN column' : 'Show SSN column'}</button>
          </div>
          {bulkMembersOpen && (
            <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <p className="hint" style={{ marginBottom: 8 }}>
                Paste rows for the chapter selected above — one member per line: last name, first name, address, city, state, zip, phone, email, birthdate (YYYY-MM-DD), join date (YYYY-MM-DD), status (new / rnew / blank), USPP (1 or blank), and Tri Due (1, 2, or 3 — which trimester this member is actually billed in). Tab or comma separated.
              </p>
              <textarea className="recap" style={{ minHeight: 140 }} value={bulkMembersText} onChange={e => setBulkMembersText(e.target.value)} placeholder={'Example\tJane\t123 Main St\tBlooming Prairie\tMN\t55917\t507-555-0100\tjane@example.com\t1985-04-12\t2020-01-01\trnew\t0\t2'} />
              <div className="row" style={{ marginTop: 8 }}>
                <button className="primary" onClick={handleBulkMembers}>Import members</button>
                {bulkStatus && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{bulkStatus}</span>}
              </div>
            </div>
          )}
          {addMemberOpen && (
            <form className="row" onSubmit={handleAddMember}>
              <input type="text" name="firstName" placeholder="First name" required />
              <input type="text" name="lastName" placeholder="Last name" required />
              <input type="text" name="address" placeholder="Address" />
              <input type="text" name="city" placeholder="City" style={{ width: 110 }} />
              <input type="text" name="zip" placeholder="Zip" style={{ width: 80 }} />
              <input type="tel" name="phone" placeholder="Phone" />
              <input type="email" name="email" placeholder="Email" />
              <input type="date" name="birthdate" title="Birthdate" />
              <input type="date" name="joinDate" title="Join date" />
              <input type="text" name="ssn" placeholder="SSN (leave 0)" style={{ width: 110 }} />
              <button type="submit" className="primary">Save member</button>
            </form>
          )}
          {rosterMembers.length === 0 ? <div className="empty">No members for this chapter yet.</div> : (
            <table>
              <thead>
                <tr>
                  <th>Name</th><th>Address</th><th>Phone</th><th>Join date</th><th>Tri due</th>
                  {showSSN && <th>SSN</th>}
                  <th>Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rosterMembers.map(m => (
                  <tr key={m.id}>
                    <td>{m.last_name}, {m.first_name}</td>
                    <td>{m.address}, {m.city} {m.state} {m.zip}</td>
                    <td style={{ fontFamily: 'var(--mono)' }}>{m.home_phone || '—'}</td>
                    <td>{fmtDate(m.join_date)}</td>
                    <td style={{ fontFamily: 'var(--mono)', textAlign: 'center' }}>{m.tri_due || '—'}</td>
                    {showSSN && <td style={{ fontFamily: 'var(--mono)' }}>{m.ssn}</td>}
                    <td>{stampFor(m)}</td>
                    <td>
                      <button className="small" onClick={() => handleMark(m.id, m.chapter_id, 'rnew')}>Renew</button>
                      <button className="small" onClick={() => handleMark(m.id, m.chapter_id, 'drop')}>Drop</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'intake' && (
        <div>
          <h2 className="section">New member intake</h2>
          <p className="hint">In a live deployment, this queue fills automatically — the USWT member-add form emails you a submission, and a mail-parsing rule drops it in here for one-tap approval instead of retyping.</p>
          {intake.length === 0 ? <div className="empty">Queue is empty. New submissions will appear here.</div> : (
            intake.map(q => (
              <div className="queue-item" key={q.id}>
                <div>
                  <div style={{ fontWeight: 500 }}>{q.first_name} {q.last_name}</div>
                  <div className="meta">{q.address}, {q.city} {q.state} {q.zip} · {q.phone} · {q.email}</div>
                  <div className="meta">Submitted {fmtDate(q.submitted_date)} — {q.source}</div>
                </div>
                <div className="row" style={{ margin: 0 }}>
                  <select id={`assign-${q.id}`} defaultValue={chapters[0]?.id}>
                    {chapters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button className="primary small" onClick={() => handleApproveIntake(q, document.getElementById(`assign-${q.id}`).value)}>Approve</button>
                  <button className="ghost small" onClick={() => handleDismissIntake(q.id)}>Dismiss</button>
                </div>
              </div>
            ))
          )}
          <div className="note"><b>To make this live:</b> this needs an inbox-parsing hook (a Gmail filter + Apps Script, or a Zapier/Make automation) watching for the USWT add-form confirmation email and posting the parsed fields into this queue.</div>
        </div>
      )}

      {tab === 'billing' && (
        <div>
          <h2 className="section">Generate dues billing</h2>
          <p className="hint">Produces the roster + dues billing sheet in National's format, ready to mail or print. Only members whose own Tri Due matches the current trimester are billed — most members appear on just one of the three billing runs each year, not all of them.</p>
          <div className="row">
            <label style={{ fontSize: 13, color: 'var(--muted)' }}>Chapter</label>
            <select value={billingChapter} onChange={e => setBillingChapter(e.target.value)}>
              {chapters.map(c => <option key={c.id} value={c.id}>{c.name} ({c.chapter_num})</option>)}
            </select>
            <button onClick={() => window.print()}>Print / save as PDF</button>
          </div>
          {!billingCh ? <div className="empty">Add a chapter first.</div> : (
            <div className="billing-sheet">
              <div className="bh">UNITED STATES WOMEN OF TODAY</div>
              <div className="bs">DUES BILLING — {cur.name.toUpperCase()} · Run date {fmtDate(new Date().toISOString().slice(0, 10))}</div>
              <div className="meta-grid">
                <div>Chapter: {billingCh.name} ({billingCh.chapter_num})</div>
                <div>District #: {billingCh.district}</div>
                <div>President: {billingCh.president}</div>
                <div>State: {billingCh.state}</div>
                <div>Meeting night: {billingCh.meeting_night || '—'}</div>
                <div>Phone: {billingCh.president_phone || '—'}</div>
              </div>
              <table>
                <thead><tr><th>Last name</th><th>First name</th><th>Address</th><th>City</th><th>Join date</th><th>Renew?</th><th>Birthdate</th></tr></thead>
                <tbody>
                  {billingMembers.map(m => (
                    <tr key={m.id}>
                      <td>{m.last_name}{m.uspp ? ' (USPP)' : ''}</td>
                      <td>{m.first_name}</td>
                      <td>{m.address}</td>
                      <td>{m.city}, {m.state} {m.zip}</td>
                      <td>{fmtDate(m.join_date)}</td>
                      <td></td>
                      <td>{fmtDate(m.birthdate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="deadline">
                Total due: {billable.length} member{billable.length === 1 ? '' : 's'} · Send with dues check ($50.00/member) to Minnesota Women of Today, PO Box 216, Albany MN 56307, by {fmtDate(cur.due_date)}. Late renewals assessed a $10.00 per-chapter fee.
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'recap' && (
        <div>
          <h2 className="section">Monthly recap</h2>
          <p className="hint">Compiled across every chapter for the National President and Membership Vice President, per the contract's monthly reporting requirement.</p>
          <textarea className="recap" readOnly value={buildRecap()} onFocus={e => e.target.select()} />
          <div className="row" style={{ marginTop: 10 }}>
            <button onClick={() => { navigator.clipboard.writeText(buildRecap()); }}>Copy text</button>
          </div>
        </div>
      )}
    </div>
  );
}
