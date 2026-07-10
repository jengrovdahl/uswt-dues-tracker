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
function isDue(m, cycleNumber) {
  return m.status === 'active' && !m.uspp && m.tri_due === cycleNumber;
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [members, setMembers] = useState([]);
  const [intake, setIntake] = useState([]);
  const [trimesters, setTrimesters] = useState(TRI_DEFAULTS);

  const [tab, setTab] = useState('browse');
  const [browseLevel, setBrowseLevel] = useState('states'); // 'states' | 'chapters' | 'roster'
  const [selectedState, setSelectedState] = useState(null); // null = all states
  const [selectedChapterId, setSelectedChapterId] = useState(null);

  const [showSSN, setShowSSN] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [addChapterOpen, setAddChapterOpen] = useState(false);
  const [bulkChaptersOpen, setBulkChaptersOpen] = useState(false);
  const [bulkChaptersText, setBulkChaptersText] = useState('');
  const [bulkMembersOpen, setBulkMembersOpen] = useState(false);
  const [bulkMembersText, setBulkMembersText] = useState('');
  const [bulkStatus, setBulkStatus] = useState('');
  const [pdfStatus, setPdfStatus] = useState('');
  const [pdfPreview, setPdfPreview] = useState(null);
  const [editingMemberId, setEditingMemberId] = useState(null);

  const refresh = useCallback(async () => {
    const [c, m, q, t] = await Promise.all([
      api.getChapters(), api.getMembers(), api.getIntakeQueue(), api.getTrimesters(),
    ]);
    setChapters(c);
    setMembers(m);
    setIntake(q);
    if (t.length) setTrimesters(t);
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
  const dueNational = members.filter(m => isDue(m, cur.cycle_number));

  function goStates() { setBrowseLevel('states'); setSelectedState(null); setSelectedChapterId(null); }
  function goState(state) { setSelectedState(state); setSelectedChapterId(null); setBrowseLevel('chapters'); }
  function goChapter(id) { setSelectedChapterId(id); setBrowseLevel('roster'); }

  const statesPresent = [...new Set(chapters.map(c => c.state).filter(Boolean))].sort();
  const stateSummaries = statesPresent.map(state => {
    const stChapters = chapters.filter(c => c.state === state);
    const stChapterIds = new Set(stChapters.map(c => c.id));
    const stMembers = members.filter(m => stChapterIds.has(m.chapter_id));
    return {
      state,
      chapterCount: stChapters.length,
      memberCount: stMembers.filter(m => m.status === 'active').length,
      dueCount: stMembers.filter(m => isDue(m, cur.cycle_number)).length,
    };
  });

  const chaptersFiltered = (selectedState ? chapters.filter(c => c.state === selectedState) : chapters);
  const chapterRows = chaptersFiltered.map(c => {
    const cm = members.filter(m => m.chapter_id === c.id);
    return {
      ...c,
      memberCount: cm.filter(m => m.status === 'active').length,
      dueCount: cm.filter(m => isDue(m, cur.cycle_number)).length,
    };
  });

  const selectedChapter = chapters.find(c => c.id === selectedChapterId);
  const chapterMembers = members.filter(m => m.chapter_id === selectedChapterId);
  const chapterDueMembers = chapterMembers.filter(m => isDue(m, cur.cycle_number));

  async function handleAddChapter(e) {
    e.preventDefault();
    const f = e.target;
    await api.addChapter({
      name: f.name.value.trim(),
      chapterNum: f.chapterNum.value.trim(),
      district: f.district.value.trim(),
      state: (f.state.value.trim() || selectedState || '').toUpperCase(),
      president: f.president.value.trim(),
    });
    f.reset();
    setAddChapterOpen(false);
    await refresh();
  }

  async function handleMark(memberId, chapterId, action) {
    await api.updateMemberStatus(memberId, chapterId, action);
    await refresh();
  }

  async function handleSaveEdit(e, memberId) {
    e.preventDefault();
    const f = e.target;
    await api.updateMember(memberId, {
      firstName: f.firstName.value.trim(),
      lastName: f.lastName.value.trim(),
      address: f.address.value.trim(),
      city: f.city.value.trim(),
      state: f.state.value.trim(),
      zip: f.zip.value.trim(),
      homePhone: f.phone.value.trim(),
      email: f.email.value.trim(),
      birthdate: f.birthdate.value,
      joinDate: f.joinDate.value,
      triDue: f.triDue.value ? parseInt(f.triDue.value, 10) : null,
    });
    setEditingMemberId(null);
    await refresh();
  }

  async function handleAddMember(e) {
    e.preventDefault();
    const f = e.target;
    await api.addMember({
      chapterId: selectedChapterId,
      firstName: f.firstName.value.trim(),
      lastName: f.lastName.value.trim(),
      address: f.address.value.trim(),
      city: f.city.value.trim(),
      state: selectedChapter?.state || '',
      zip: f.zip.value.trim(),
      homePhone: f.phone.value.trim(),
      email: f.email.value.trim(),
      birthdate: f.birthdate.value,
      joinDate: f.joinDate.value,
      ssn: f.ssn.value.trim() || '0',
      triDue: f.triDue.value ? parseInt(f.triDue.value, 10) : null,
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
      name: r[0] || '', chapterNum: r[1] || '', district: r[2] || '', state: r[3] || selectedState || '', president: r[4] || '',
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
    await api.bulkAddMembers(parsed, selectedChapterId);
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
    setAddChapterOpen(false);
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
      lines.push(`${c.name} (${c.chapter_num}), District ${c.district}, ${c.state}`);
      lines.push(`  New adds: ${newAdds.length}${newAdds.length ? ' — ' + newAdds.map(m => m.first_name + ' ' + m.last_name).join(', ') : ''}`);
      lines.push(`  Renewals: ${renewals.length}${renewals.length ? ' — ' + renewals.map(m => m.first_name + ' ' + m.last_name).join(', ') : ''}`);
      lines.push(`  Drops: ${drops.length}${drops.length ? ' — ' + drops.map(m => m.first_name + ' ' + m.last_name).join(', ') : ''}`);
      lines.push(`  Active total: ${cm.filter(m => m.status === 'active').length}`);
      lines.push('');
    });
    lines.push(`Pending new-member intake (not yet added to any chapter): ${intake.length}`);
    return lines.join('\n');
  }

  function addChapterBlock() {
    return (
      <div>
        <div className="row">
          <button className="primary" onClick={() => setAddChapterOpen(v => !v)}>{addChapterOpen ? 'Close' : '+ Add chapter'}</button>
        </div>
        {addChapterOpen && (
          <div style={{ marginBottom: 18 }}>
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
              <button onClick={() => setBulkChaptersOpen(v => !v)}>{bulkChaptersOpen ? 'Cancel' : 'Or paste chapter rows manually'}</button>
              <form className="row" style={{ margin: 0 }} onSubmit={handleAddChapter}>
                <input type="text" name="name" placeholder="Chapter name" required />
                <input type="text" name="chapterNum" placeholder="Chapter #" style={{ width: 100 }} />
                <input type="text" name="district" placeholder="District #" style={{ width: 90 }} />
                <input type="text" name="state" placeholder="State" defaultValue={selectedState || ''} style={{ width: 70 }} />
                <input type="text" name="president" placeholder="President" />
                <button type="submit">Add single chapter</button>
              </form>
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
          </div>
        )}
      </div>
    );
  }

  function breadcrumb() {
    return (
      <div className="row" style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>
        <span style={{ cursor: 'pointer', textDecoration: browseLevel === 'states' ? 'none' : 'underline' }} onClick={goStates}>All states</span>
        {selectedState && <><span>/</span><span style={{ cursor: 'pointer', textDecoration: browseLevel === 'chapters' ? 'none' : 'underline' }} onClick={() => goState(selectedState)}>{selectedState}</span></>}
        {selectedChapter && <><span>/</span><span>{selectedChapter.name}</span></>}
      </div>
    );
  }

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
        <div className="card"><div className="num">{statesPresent.length}</div><div className="lbl">States on file</div></div>
        <div className="card"><div className="num">{chapters.length}</div><div className="lbl">Chapters on file</div></div>
        <div className="card"><div className="num">{activeMembers.length}</div><div className="lbl">Active members</div></div>
        <div className="card"><div className="num">{dueNational.length}</div><div className="lbl">Due this trimester</div></div>
      </div>

      <div className="tabs">
        {[
          ['browse', 'Browse'],
          ['intake', 'New member intake'],
          ['recap', 'Monthly recap'],
        ].map(([key, label]) => (
          <div key={key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{label}</div>
        ))}
      </div>

      {tab === 'browse' && (
        <div>
          {breadcrumb()}

          {browseLevel === 'states' && (
            <div>
              <h2 className="section">States</h2>
              <p className="hint">Every state you have chapters in. Click a state to see its chapters, or add your first chapter to get started.</p>
              {addChapterBlock()}
              {stateSummaries.length === 0 ? <div className="empty">No chapters yet — add one above.</div> : (
                <table>
                  <thead><tr><th>State</th><th>Chapters</th><th>Active members</th><th>Due this trimester</th></tr></thead>
                  <tbody>
                    {stateSummaries.map(s => (
                      <tr key={s.state} style={{ cursor: 'pointer' }} onClick={() => goState(s.state)}>
                        <td>{s.state}</td>
                        <td>{s.chapterCount}</td>
                        <td>{s.memberCount}</td>
                        <td>{s.dueCount > 0 ? <span className="stamp rnew">{s.dueCount} due</span> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {chapters.length > 0 && (
                <p className="hint" style={{ marginTop: 14 }}>
                  <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => goState(null)}>View all chapters across every state →</span>
                </p>
              )}
            </div>
          )}

          {browseLevel === 'chapters' && (
            <div>
              <div className="row">
                <h2 className="section" style={{ margin: 0 }}>{selectedState ? `Chapters in ${selectedState}` : 'All chapters'}</h2>
                <select value={selectedState || ''} onChange={e => setSelectedState(e.target.value || null)} style={{ marginLeft: 'auto' }}>
                  <option value="">All states</option>
                  {statesPresent.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {addChapterBlock()}
              {chapterRows.length === 0 ? <div className="empty">No chapters here yet — add one above.</div> : (
                <table>
                  <thead><tr><th>Chapter</th><th>Chapter #</th><th>District</th><th>State</th><th>President</th><th>Members</th><th>Due this trimester</th></tr></thead>
                  <tbody>
                    {chapterRows.map(c => (
                      <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => goChapter(c.id)}>
                        <td>{c.name}</td>
                        <td style={{ fontFamily: 'var(--mono)' }}>{c.chapter_num}</td>
                        <td>{c.district}</td><td>{c.state}</td><td>{c.president}</td>
                        <td>{c.memberCount}</td>
                        <td>{c.dueCount > 0 ? <span className="stamp rnew">{c.dueCount} due</span> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {browseLevel === 'roster' && selectedChapter && (
            <div>
              <div className="cards" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <div className="card"><div className="num">{chapterMembers.filter(m => m.status === 'active').length}</div><div className="lbl">Active members</div></div>
                <div className="card"><div className="num">{chapterDueMembers.length}</div><div className="lbl">Due this trimester</div></div>
                <div className="card"><div className="num">{chapterMembers.filter(m => m.status === 'dropped').length}</div><div className="lbl">Dropped</div></div>
              </div>

              <h2 className="section">Roster</h2>
              <p className="hint">Mark renewals and drops here as returned forms come in — this feeds the billing sheet below and the monthly recap.</p>
              <div className="row">
                <button onClick={() => setAddMemberOpen(v => !v)}>{addMemberOpen ? 'Cancel' : 'Add member'}</button>
                <button onClick={() => setBulkMembersOpen(v => !v)}>{bulkMembersOpen ? 'Cancel bulk import' : 'Bulk import members'}</button>
                <button onClick={() => setShowSSN(v => !v)}>{showSSN ? 'Hide SSN column' : 'Show SSN column'}</button>
              </div>
              {bulkMembersOpen && (
                <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <p className="hint" style={{ marginBottom: 8 }}>
                    Paste rows for this chapter — one member per line: last name, first name, address, city, state, zip, phone, email, birthdate (YYYY-MM-DD), join date (YYYY-MM-DD), status (new / rnew / blank), USPP (1 or blank), Tri Due (1, 2, or 3). Tab or comma separated.
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
                  <select name="triDue" defaultValue="">
                    <option value="">Tri due?</option>
                    <option value="1">1</option><option value="2">2</option><option value="3">3</option>
                  </select>
                  <button type="submit" className="primary">Save member</button>
                </form>
              )}
              {chapterMembers.length === 0 ? <div className="empty">No members for this chapter yet.</div> : (
                <table>
                  <thead>
                    <tr>
                      <th>Name</th><th>Address</th><th>Phone</th><th>Join date</th><th>Tri due</th>
                      {showSSN && <th>SSN</th>}
                      <th>Status</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chapterMembers.map(m => editingMemberId === m.id ? (
                      <tr key={m.id}>
                        <td colSpan={showSSN ? 8 : 7}>
                          <form className="row" onSubmit={e => handleSaveEdit(e, m.id)}>
                            <input type="text" name="firstName" defaultValue={m.first_name} placeholder="First name" required style={{ width: 100 }} />
                            <input type="text" name="lastName" defaultValue={m.last_name} placeholder="Last name" required style={{ width: 100 }} />
                            <input type="text" name="address" defaultValue={m.address} placeholder="Address" style={{ width: 140 }} />
                            <input type="text" name="city" defaultValue={m.city} placeholder="City" style={{ width: 110 }} />
                            <input type="text" name="state" defaultValue={m.state} placeholder="State" style={{ width: 50 }} />
                            <input type="text" name="zip" defaultValue={m.zip} placeholder="Zip" style={{ width: 70 }} />
                            <input type="tel" name="phone" defaultValue={m.home_phone} placeholder="Phone" style={{ width: 110 }} />
                            <input type="email" name="email" defaultValue={m.email} placeholder="Email" style={{ width: 160 }} />
                            <input type="date" name="birthdate" defaultValue={m.birthdate} title="Birthdate" />
                            <input type="date" name="joinDate" defaultValue={m.join_date} title="Join date" />
                            <select name="triDue" defaultValue={m.tri_due || ''}>
                              <option value="">Tri due?</option>
                              <option value="1">1</option><option value="2">2</option><option value="3">3</option>
                            </select>
                            <button type="submit" className="primary small">Save</button>
                            <button type="button" className="ghost small" onClick={() => setEditingMemberId(null)}>Cancel</button>
                          </form>
                        </td>
                      </tr>
                    ) : (
                      <tr key={m.id}>
                        <td>{m.last_name}, {m.first_name}</td>
                        <td>{m.address}, {m.city} {m.state} {m.zip}</td>
                        <td style={{ fontFamily: 'var(--mono)' }}>{m.home_phone || '—'}</td>
                        <td>{fmtDate(m.join_date)}</td>
                        <td style={{ fontFamily: 'var(--mono)', textAlign: 'center' }}>{m.tri_due || '—'}</td>
                        {showSSN && <td style={{ fontFamily: 'var(--mono)' }}>{m.ssn}</td>}
                        <td>{stampFor(m)}</td>
                        <td>
                          <button className="small" onClick={() => setEditingMemberId(m.id)}>Edit</button>
                          <button className="small" onClick={() => handleMark(m.id, m.chapter_id, 'rnew')}>Renew</button>
                          <button className="small" onClick={() => handleMark(m.id, m.chapter_id, 'drop')}>Drop</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <h2 className="section" style={{ marginTop: 28 }}>Dues billing — {cur.name}</h2>
              <p className="hint">Only members whose own Tri Due matches the current trimester are billed here.</p>
              <div className="row">
                <button onClick={() => window.print()}>Print / save as PDF</button>
              </div>
              <div className="billing-sheet">
                <div className="bh">UNITED STATES WOMEN OF TODAY</div>
                <div className="bs">DUES BILLING — {cur.name.toUpperCase()} · Run date {fmtDate(new Date().toISOString().slice(0, 10))}</div>
                <div className="meta-grid">
                  <div>Chapter: {selectedChapter.name} ({selectedChapter.chapter_num})</div>
                  <div>District #: {selectedChapter.district}</div>
                  <div>President: {selectedChapter.president}</div>
                  <div>State: {selectedChapter.state}</div>
                  <div>Meeting night: {selectedChapter.meeting_night || '—'}</div>
                  <div>Phone: {selectedChapter.president_phone || '—'}</div>
                </div>
                {chapterDueMembers.length === 0 ? <p className="hint">No members due this trimester for this chapter.</p> : (
                  <table>
                    <thead><tr><th>Last name</th><th>First name</th><th>Address</th><th>City</th><th>Join date</th><th>Renew?</th><th>Birthdate</th></tr></thead>
                    <tbody>
                      {chapterDueMembers.map(m => (
                        <tr key={m.id}>
                          <td>{m.last_name}</td>
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
                )}
                <div className="deadline">
                  Total due: {chapterDueMembers.length} member{chapterDueMembers.length === 1 ? '' : 's'} · Send with dues check ($50.00/member) to Minnesota Women of Today, PO Box 216, Albany MN 56307, by {fmtDate(cur.due_date)}. Late renewals assessed a $10.00 per-chapter fee.
                </div>
              </div>
            </div>
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

      {tab === 'recap' && (
        <div>
          <h2 className="section">Monthly recap</h2>
          <p className="hint">Compiled across every chapter, every state, for the National President and Membership Vice President, per the contract's monthly reporting requirement.</p>
          <textarea className="recap" readOnly value={buildRecap()} onFocus={e => e.target.select()} />
          <div className="row" style={{ marginTop: 10 }}>
            <button onClick={() => { navigator.clipboard.writeText(buildRecap()); }}>Copy text</button>
          </div>
        </div>
      )}
    </div>
  );
}
