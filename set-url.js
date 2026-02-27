const fs = require('fs');
const url = process.env.MATCH_URL;
if (!url) { console.log('No URL provided'); process.exit(0); }
const cfg = JSON.parse(fs.readFileSync('match-config.json', 'utf8'));
cfg.matchUrl = url;
cfg.enabled = true;
cfg.lastSet = new Date().toISOString();
fs.writeFileSync('match-config.json', JSON.stringify(cfg, null, 2));
console.log('URL set to:', cfg.matchUrl);
