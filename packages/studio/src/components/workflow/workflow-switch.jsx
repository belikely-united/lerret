// workflow-switch.jsx — the dock's Design | Workflow switch.

import React from 'react';

import { useWorkflowMode, setWorkflowMode } from './workflow-mode.js';
import { selectElement } from '../edit-mode/edit-session.js';
import './workflow.css';

export function WorkflowSwitch() {
  const on = useWorkflowMode();
  const pick = (next) => {
    if (next) selectElement(null); // the design selection doesn't apply in Workflow
    setWorkflowMode(next);
  };
  return (
    <div className="lm-wf-switch" role="radiogroup" aria-label="View" data-testid="lm-workflow-switch">
      <button type="button" role="radio" aria-checked={!on} data-on={!on || undefined} onClick={() => pick(false)}>Design</button>
      <button type="button" role="radio" aria-checked={on} data-on={on || undefined} onClick={() => pick(true)} title="Fill a design from a spreadsheet, in bulk">Workflow</button>
    </div>
  );
}

export default WorkflowSwitch;
