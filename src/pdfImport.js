import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Column x-boundaries measured directly from real member DATA rows in a USWT
// "Chapter Roster" PDF (letter, landscape, 792x612pt) — not from the header text,
// since the Tri Due / Trans Code header words are stacked in a way that doesn't
// match where the actual data sits. This report is generated from a fixed
// template, so these positions should hold for any chapter's roster export.
const COLUMNS = [
  { key: 'lastName', start: -Infinity },
  { key: 'firstName', start: 99 },
  { key: 'address', start: 168.95 },
  { key: 'city', start: 248.9 },
  { key: 'state', start: 331.05 },
  { key: 'zip', start: 374.7 },
  { key: 'phone', start: 402.15 },
  { key: 'joinDate', start: 443.9 },
  { key: 'triDue', start: 510 },
  { key: 'transCode', start: 536 },
  { key: 'birthdate', start: 566 },
  { key: 'uspp', start: 607.6 },
  { key: 'email', start: 640.7 },
];

function columnFor(x) {
  let col = COLUMNS[0].key;
  for (const c of COLUMNS) {
    if (x >= c.start) col = c.key;
  }
  return col;
}

async function getPageWords(page) {
  const content = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });
  return content.items.map(item => ({
    text: item.str,
    x: item.transform[4],
    // pdf.js y grows upward from bottom; flip so it grows downward like a normal "top" value
    y: viewport.height - item.transform[5],
  })).filter(w => w.text.trim());
}

function groupIntoRows(words, tolerance = 3) {
  const sorted = [...words].sort((a, b) => a.y - b.y);
  const rows = [];
  for (const w of sorted) {
    let row = rows.find(r => Math.abs(r.y - w.y) <= tolerance);
    if (!row) { row = { y: w.y, words: [] }; rows.push(row); }
    row.words.push(w);
  }
  rows.forEach(r => r.words.sort((a, b) => a.x - b.x));
  return rows.sort((a, b) => a.y - b.y);
}

function lineText(row) {
  return row.words.map(w => w.text).join(' ').replace(/\s+/g, ' ').trim();
}

export async function parseChapterRosterPdf(arrayBuffer) {
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await doc.getPage(1);
  const words = await getPageWords(page);
  const rows = groupIntoRows(words);

  const fullText = rows.map(lineText).join('\n');

  const chapterNameMatches = [...fullText.matchAll(/^([A-Z][A-Z\s'-]*WOMEN OF TODAY)$/gm)]
    .map(m => m[1].trim())
    .filter(n => n !== 'UNITED STATES WOMEN OF TODAY');
  const chapterNameMatch = chapterNameMatches[0] ? [null, chapterNameMatches[0]] : null;
  const chapterNumMatch = fullText.match(/Chapter #:\s*(\S+)/);
  const districtMatch = fullText.match(/District #:\s*(\S+)/);
  const presidentMatch = fullText.match(/President:\s*(.+)/);
  const meetingMatch = fullText.match(/Meeting Night:\s*(.+)/);
  const phoneMatch = fullText.match(/Phone:\s*(\S+)/);
  const stateMatch = fullText.match(/\b([A-Z]{2}),?\s+\d{5}/);

  const chapter = {
    name: chapterNameMatch ? chapterNameMatch[1].trim() : '',
    chapterNum: chapterNumMatch ? chapterNumMatch[1] : '',
    district: districtMatch ? districtMatch[1] : '',
    state: stateMatch ? stateMatch[1] : '',
    president: presidentMatch ? presidentMatch[1].trim() : '',
    meetingNight: meetingMatch ? meetingMatch[1].trim() : '',
    presidentPhone: phoneMatch ? phoneMatch[1] : '',
  };

  // Table rows sit between the "Last Name / First Name / ..." header row and the "Total:" footer row.
  const headerIdx = rows.findIndex(r => {
    const t = lineText(r);
    return t.includes('Last Name') || (t.includes('Last') && t.includes('First'));
  });
  const footerIdx = rows.findIndex(r => lineText(r).startsWith('Total'));
  const dataRows = headerIdx >= 0 && footerIdx > headerIdx
    ? rows.slice(headerIdx + 1, footerIdx)
    : [];

  const members = dataRows.map(row => {
    const cells = {};
    for (const w of row.words) {
      const col = columnFor(w.x);
      cells[col] = (cells[col] ? cells[col] + ' ' : '') + w.text;
    }
    const triDueRaw = (cells.triDue || '').trim();
    const transCodeRaw = (cells.transCode || '').trim().toLowerCase();
    return {
      lastName: (cells.lastName || '').trim(),
      firstName: (cells.firstName || '').trim(),
      address: (cells.address || '').trim(),
      city: (cells.city || '').trim(),
      state: (cells.state || '').trim(),
      zip: (cells.zip || '').trim(),
      homePhone: (cells.phone || '').trim(),
      joinDate: normalizeDate(cells.joinDate),
      triDue: triDueRaw ? parseInt(triDueRaw, 10) : null,
      transCode: transCodeRaw === 'new' || transCodeRaw === 'rnew' ? transCodeRaw : '',
      birthdate: normalizeDate(cells.birthdate),
      uspp: !!(cells.uspp && cells.uspp.trim()),
      email: (cells.email || '').trim(),
    };
  }).filter(m => m.lastName && m.firstName);

  return { chapter, members, rawText: fullText };
}

function normalizeDate(raw) {
  if (!raw) return '';
  const s = raw.trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return '';
  let [, mo, da, yr] = m;
  if (yr.length === 2) yr = (parseInt(yr, 10) < 50 ? '20' : '19') + yr;
  return `${yr}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
}
