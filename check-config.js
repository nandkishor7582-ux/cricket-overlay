const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('match-config.json', 'utf8'));
console.log('enabled=' + cfg.enabled);
console.log('url=' + cfg.matchUrl);
if (cfg.enabled && cfg.matchUrl) {
  console.log('Config OK - proceeding with scrape');
  process.exit(0);
} else {
  console.log('No active match - skipping');
  process.exit(1);
}
