// brand-toggle.jsx — the dock button that opens the Brand library.

import React from 'react';

import { useBrand, toggleBrandOpen } from './brand-store.js';
import { useWorkflowMode } from '../workflow/workflow-mode.js';
import { inCliMode } from '../../runtime/write-client.js';

export function BrandToggle({ Button }) {
  const { open } = useBrand();
  const workflow = useWorkflowMode();
  if (workflow || !inCliMode()) return null;
  return <Button label="Brand" icon="◐" active={open} onClick={toggleBrandOpen} title="Brand library — colours, fonts and logos for every page" />;
}

export default BrandToggle;
