// Small per-person things in localStorage. Storage can throw (private mode, blocked);
// then we keep things in memory for this visit.

const mem = new Map();

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v != null) return JSON.parse(v);
  } catch { /* storage unavailable or broken value */ }
  return mem.has(key) ? mem.get(key) : fallback;
}

function write(key, value) {
  mem.set(key, value);
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* memory copy is enough */ }
}

const WATCH = "nrc.watchlist";
const listeners = new Set();

export function watchlist() {
  const v = read(WATCH, []);
  return Array.isArray(v) ? v.map(String) : [];
}

export function isWatched(id) {
  return watchlist().includes(String(id));
}

export function toggleWatch(id) {
  id = String(id);
  const list = watchlist();
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1); else list.unshift(id);
  write(WATCH, list);
  listeners.forEach((fn) => fn(list));
  return i < 0;
}

export function onWatchChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function pref(name, fallback) {
  return read("nrc.pref." + name, fallback);
}

export function setPref(name, value) {
  write("nrc.pref." + name, value);
}
