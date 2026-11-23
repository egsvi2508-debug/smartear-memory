// listen.ts: window events for a piece of UI that gets thrown away (a game's
// stats strip, its keys picker). The listener only runs while its node is on the
// page, and is removed once the node is gone: every new listener schedules a
// sweep, so restarting a game many times never piles listeners up.

const live: { node: Node; type: string; h: EventListener }[] = [];
let sweepQueued = false;

function sweep() {
  sweepQueued = false;
  for (let i = live.length - 1; i >= 0; i--) {
    const l = live[i];
    if (l.node.isConnected) continue;
    window.removeEventListener(l.type, l.h);
    live.splice(i, 1);
  }
}

export function listenWhileShown(node: Node, type: string, fn: (e: Event) => void) {
  const h = (e: Event) => {
    if (node.isConnected) fn(e);
  };
  window.addEventListener(type, h);
  live.push({ node, type, h });
  // Later, not now: the node is usually put on the page right after this call.
  if (!sweepQueued) {
    sweepQueued = true;
    setTimeout(sweep, 0);
  }
}
