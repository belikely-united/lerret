// workflow-mode.js — whether the studio shows the Design canvas or the
// Workflow view. A tiny shared store (like the edit session) so the dock's
// switch and the canvas agree without prop drilling.

import React from 'react';

let on = false;
const listeners = new Set();

export function isWorkflowMode() {
  return on;
}

export function setWorkflowMode(next) {
  if (on === !!next) return;
  on = !!next;
  for (const l of listeners) l();
}

/** @returns {boolean} */
export function useWorkflowMode() {
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => on,
    () => false,
  );
}
