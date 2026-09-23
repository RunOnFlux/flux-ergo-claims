const { start } = require('./erg-patched.js');
const FLUX = 'e8b20745ee9d18817305f32eb21015831a48f02d40980de6e849f886dca7f807';
start(FLUX, 1878291).catch(e => { console.error('FAILED', String(e)); process.exit(1); });
