// __mocks__/fflate.js — Manual stub used by Vitest so tests can run without
// the real fflate package installed (orchestrator installs it after commit).
//
// The stub's zipSync encodes the ZIP entry paths as a JSON byte sequence so
// zip.test.js can assert on which paths land in the archive.

export function zipSync(files) {
 const paths = Object.keys(files);
 return new TextEncoder().encode(JSON.stringify(paths));
}

export function zip(files, opts, callback) {
 try {
 const result = zipSync(files);
 callback(null, result);
 } catch (err) {
 callback(err);
 }
}
