// hosted-controller.js — a registry the hosted root (`HostedProjectSource`)
// publishes so deep UI (the dock brand menu) can drive project switching
// without prop-drilling the whole tree. Mirrors the `setHostedWriter` registry.
// In CLI mode it stays null and the dock falls back to the CLI switch path.
// (Epic 10 / H7.)

/**
 * @typedef {object} HostedController
 * @property {() => void | Promise<void>} openAnother  Pick a different folder and switch to it.
 * @property {() => void} close                          Leave the current project (back to the home/connect screen).
 */

/** @type {HostedController | null} */
let controller = null;

/** Register (or clear with null) the hosted project controller. */
export function setHostedController(c) {
  controller = c;
}

/** The active hosted controller, or null in CLI / standalone mode. */
export function getHostedController() {
  return controller;
}
