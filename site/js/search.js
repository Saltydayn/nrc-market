// Item search: English names, German names and item IDs. Index is built once per data load.

export function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/['’`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function buildIndex(rows) {
  return rows.map((row) => {
    const norm = normalize(row.named ? row.name : "");
    const de = normalize(row.de || "");
    return { row, norm, words: norm ? norm.split(" ") : [], de, deWords: de ? de.split(" ") : [] };
  });
}

// Rank of one name for the query, or null if not every word is in it.
function rankIn(norm, words, nq, tokens) {
  if (!norm || !tokens.every((t) => norm.includes(t))) return null;
  if (norm.startsWith(nq)) return 0;
  if (tokens.every((t) => words.some((w) => w.startsWith(t)))) return 1;
  return 2;
}

// All query words must appear somewhere (any order). Ranking: name starts with the query,
// then every word starts a word in the name, then plain contains; ties by listings.
export function search(index, q, limit = Infinity) {
  const nq = normalize(q);
  if (!nq) return [];
  const tokens = nq.split(" ");
  const isId = /^\d+$/.test(nq);
  const hits = [];
  for (const e of index) {
    let rank;
    if (isId && e.row.id === nq) rank = -1;
    else {
      const en = rankIn(e.norm, e.words, nq, tokens);
      const de = rankIn(e.de, e.deWords, nq, tokens);
      rank = en ?? de;
      if (en != null && de != null) rank = Math.min(en, de);
      if (rank == null) {
        if (isId && e.row.id.startsWith(nq)) rank = 3;
        else continue;
      }
    }
    hits.push([rank, e.row]);
  }
  hits.sort((a, b) => a[0] - b[0] || b[1].listings - a[1].listings);
  return hits.slice(0, limit).map((h) => h[1]);
}
