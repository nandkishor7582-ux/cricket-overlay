const fs = require('fs');
const https = require('https');
const http = require('http');

// ─── Read match config ───────────────────────────────────────────────────────
const config = JSON.parse(fs.readFileSync('match-config.json', 'utf8'));

if (!config.enabled || !config.matchUrl) {
  console.log('No active match configured. Exiting.');
  process.exit(1);
}

const matchUrl = config.matchUrl.trim();
console.log('Match URL:', matchUrl);

// ─── Extract match ID from Crex URL ──────────────────────────────────────────
function extractCrexMatchId(url) {
  const match = url.match(/scoreboard\/([A-Z0-9]+)\/([A-Z0-9]+)\//);
  return match ? `${match[1]}/${match[2]}` : null;
}

// ─── Extract match ID from Cricbuzz URL ──────────────────────────────────────
function extractCricbuzzMatchId(url) {
  const match = url.match(/\/(\d+)\//);
  return match ? match[1] : null;
}

// ─── HTTP fetch helper ────────────────────────────────────────────────────────
function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/html, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.cricbuzz.com/',
        ...options.headers
      },
      timeout: 15000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, options).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ─── Try Cricbuzz API ─────────────────────────────────────────────────────────
async function tryCricbuzz(matchId) {
  console.log('Trying Cricbuzz API, match ID:', matchId);
  
  try {
    const url = `https://www.cricbuzz.com/api/cricket-match/${matchId}/full-scorecard`;
    const res = await fetchUrl(url);
    console.log('Cricbuzz status:', res.status);
    
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    
    const json = JSON.parse(res.body);
    const innings = json.scorecard?.[0];
    const matchHeader = json.matchHeader;
    
    if (!innings || !matchHeader) throw new Error('No scorecard data');

    const teamA = matchHeader.team1;
    const teamB = matchHeader.team2;
    const bat = innings.batTeamDetails;
    const bowl = innings.bowlTeamDetails;

    // Get batsmen
    const batsmen = Object.values(bat?.batsmanData || {})
      .filter(b => b.outDesc === '' || !b.outDesc)
      .slice(0, 2);

    // Get current bowler
    const bowlers = Object.values(bowl?.bowlerData || {})
      .filter(b => b.isCurrentBowler)
      .slice(0, 1);

    const b1 = batsmen[0] || {};
    const b2 = batsmen[1] || {};
    const bowler = bowlers[0] || {};

    return {
      teamA: {
        name: teamA?.teamSName || 'TEAM A',
        score: `${innings.scoreDetails?.runs || 0}/${innings.scoreDetails?.wickets || 0}`,
        overs: innings.scoreDetails?.overs || '0.0',
        flag: ''
      },
      teamB: {
        name: teamB?.teamSName || 'TEAM B',
        score: 'Yet to bat',
        overs: '0.0',
        flag: ''
      },
      matchInfo: `${matchHeader.matchDescription || ''} • ${matchHeader.seriesName || ''}`,
      event: '',
      batsman1: {
        name: b1.batName || '',
        runs: b1.runs || 0,
        balls: b1.balls || 0,
        fours: b1.fours || 0,
        sixes: b1.sixes || 0,
        isStriker: true
      },
      batsman2: {
        name: b2.batName || '',
        runs: b2.runs || 0,
        balls: b2.balls || 0,
        fours: b2.fours || 0,
        sixes: b2.sixes || 0,
        isStriker: false
      },
      bowler: {
        name: bowler.bowlName || '',
        overs: bowler.overs || '0',
        maidens: bowler.maidens || 0,
        runs: bowler.runs || 0,
        wickets: bowler.wickets || 0
      },
      lastWicket: innings.scoreDetails?.lastWicket || '',
      nextBatter: '',
      runRate: innings.scoreDetails?.runRate || '',
      requiredRate: '',
      target: '',
      ticker: `${teamA?.teamSName} vs ${teamB?.teamSName} • Live`,
      lastUpdated: new Date().toISOString(),
      source: 'cricbuzz'
    };
  } catch (e) {
    console.log('Cricbuzz failed:', e.message);
    return null;
  }
}

// ─── Try Cricbuzz search to find match ID ─────────────────────────────────────
async function findCricbuzzMatchId(teamNames) {
  try {
    console.log('Searching Cricbuzz for live matches...');
    const res = await fetchUrl('https://www.cricbuzz.com/api/cricket-match/live-matches');
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    
    const json = JSON.parse(res.body);
    const matches = json.typeMatches?.flatMap(t => t.seriesMatches?.flatMap(s => s.seriesAdWrapper?.matches || []) || []) || [];
    
    console.log(`Found ${matches.length} live matches`);
    
    for (const m of matches) {
      const info = m.matchInfo;
      const t1 = info?.team1?.teamName?.toLowerCase() || '';
      const t2 = info?.team2?.teamName?.toLowerCase() || '';
      
      for (const name of teamNames) {
        if (t1.includes(name.toLowerCase()) || t2.includes(name.toLowerCase())) {
          console.log(`Found match: ${t1} vs ${t2}, ID: ${info.matchId}`);
          return String(info.matchId);
        }
      }
    }
    return null;
  } catch (e) {
    console.log('Search failed:', e.message);
    return null;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  let data = null;

  // Extract team names from URL for search
  const urlTeams = matchUrl.match(/([a-z]{2,3})-vs-([a-z]{2,3})/i);
  const teamNames = urlTeams ? [urlTeams[1], urlTeams[2]] : ['eng', 'nz'];
  console.log('Looking for teams:', teamNames);

  // Try to find on Cricbuzz
  const cricbuzzId = await findCricbuzzMatchId(teamNames);
  
  if (cricbuzzId) {
    data = await tryCricbuzz(cricbuzzId);
  }

  // If all failed, keep existing data.json but update timestamp
  if (!data) {
    console.log('All sources failed. Keeping existing data.json');
    try {
      const existing = JSON.parse(fs.readFileSync('data.json', 'utf8'));
      existing.lastUpdated = new Date().toISOString();
      existing.source = 'cached';
      fs.writeFileSync('data.json', JSON.stringify(existing, null, 2));
      console.log('Updated timestamp on existing data');
      process.exit(0);
    } catch (e) {
      console.log('No existing data.json either');
      process.exit(2);
    }
  }

  // Save data
  fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
  console.log('✅ data.json updated successfully');
  console.log(`   ${data.teamA.name} ${data.teamA.score} vs ${data.teamB.name} ${data.teamB.score}`);
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(2);
});
