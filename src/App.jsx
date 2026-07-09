import { useEffect, useState, useCallback } from 'react';
import './index.css';
import * as api from './data';

const TRI_DEFAULTS = [
  { name: '1st Trimester', start_date: '2026-05-01', due_date: '2026-08-15' },
  { name: '2nd Trimester', start_date: '2026-09-01', due_date: '2026-12-15' },
  { name: '3rd Trimester', start_date: '2027-01-01', due_date: '2027-04-15' },
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
  const billingMembers = members.filter(m => m.chapter_id === billingChapter && m.status === 'active');
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
            <div className="due">Due {fmtDate(t.due_date)}</div>
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
            <button onClick={() => setShowSSN(v => !v)}>{showSSN ? 'Hide SSN column' : 'Show SSN column'}</button>
          </div>
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
                  <th>Name</th><th>Address</th><th>Phone</th><th>Join date</th>
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
          <p className="hint">Produces the roster + dues billing sheet in National's format, ready to mail or print. Total due excludes USPP and dropped members.</p>
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
