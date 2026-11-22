// vexflow.ts — loads VexFlow (Bravura font build) on first use and exposes
// it both as a module and as the classic global `Vex.Flow`, which the
// carried-over notation modules (rhythm staff, memory staff board) expect.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Flow = any;

let loading: Promise<Flow> | null = null;
let flow: Flow | null = null;

export function loadVexFlow(): Promise<Flow> {
  if (!loading) {
    loading = import("vexflow/bravura").then((VF) => {
      const ns: Flow = { ...VF };
      const g = globalThis as unknown as { Vex?: { Flow: Flow } };
      g.Vex = { Flow: ns };
      flow = ns;
      return ns;
    });
  }
  return loading;
}

export const vexFlow = () => flow;
