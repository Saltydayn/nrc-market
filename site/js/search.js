// Item search: English names and item IDs. Index is built once per data load.

export function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/['’`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function buildIndex(rows) {
  return rows.map((row) => {
    const norm = normalize(row.named ? row.name : "");
    return { row, norm, words: norm ? norm.split(" ") : [] };
  });
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
    else if (!e.norm) {
      if (isId && e.row.id.startsWith(nq)) rank = 3;
      else continue;
    } else {
      if (!tokens.every((t) => e.norm.includes(t))) {
        if (isId && e.row.id.startsWith(nq)) rank = 3;
        else continue;
      } else if (e.norm.startsWith(nq)) rank = 0;
      else if (tokens.every((t) => e.words.some((w) => w.startsWith(t)))) rank = 1;
      else rank = 2;
    }
    hits.push([rank, e.row]);
  }
  hits.sort((a, b) => a[0] - b[0] || b[1].listings - a[1].listings);
  return hits.slice(0, limit).map((h) => h[1]);
}
