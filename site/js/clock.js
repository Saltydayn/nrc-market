// "Now" for the whole site. With sample data, now = the file's timestamp + 10 minutes,
// so the sample never looks stale. On the live site it's the real clock.

let offset = 0;

export function setSampleClock(updated) {
  offset = updated + 600 - Math.floor(Date.now() / 1000);
}

export function now() {
  return Math.floor(Date.now() / 1000) + offset;
}
