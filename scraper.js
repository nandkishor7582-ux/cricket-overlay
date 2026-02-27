const fs = require('fs');
const https = require('https');

const config = JSON.parse(fs.readFileSync('match-config.json', 'utf8'));
const matchUrl = config.matchUrl.trim();
console.log('Match URL:', matchUrl);

const urlTeams = matchUrl.match(/([a-z]{2,3})-vs-([a-z]{2,3})/i);
const teamNames = urlTeams ? [urlTeams[1], urlTeams[2]] : ['eng', 'nz'];
console.log('Teams:', teamNames);

function fetchUrl(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/html, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        ...headers
      },
      timeout: 20000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, headers).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`GET ${url} → ${res.statusCode}`);
        resolve({ status: res.statusCode, body: data });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// Try Cricbuzz new API endpoints
async function tryCricbuzz() {
  const endpoints = [
    'https://www.cricbuzz.com/api/cricket-match/live-matches',
    'https://www.cricbuzz.com/api/cricket-match/upcoming-matches',
    'https://www.cricbuzz.com/api/cricket-match/recent-matches',
  ];

  for (const url of endpoints) {
    try {
      const res = await fetchUrl(url, {
        'Referer': 'https://www.cricbuzz.com/',
        'X-Requested-With': 'XMLHttpRequest'
      });
      if (res.status !== 200) continue;

      const json = JSON.parse(res.body);
      const matches = json.typeMatches?.flatMap(t =>
        t.seriesMatches?.flatMap(s =>
          s.seriesAdWrapper?.matches || []
        ) || []
      ) || [];

      console.log(`Found ${matches.length} matches`);

      for (const m of matches) {
        const info = m.matchInfo;
        const t1 = (info?.team1?.teamName || '').toLowerCase();
        const t2 = (info?.team2?.teamName || '').toLowerCase();
        const t1s = (info?.team1?.teamSName || '').toLowerCase();
        const t2s = (info?.team2?.teamSName || '').toLowerCase();

        for (const name of teamNames) {
          if (t1.includes(name) || t2.includes(name) || t1s.includes(name) || t2s.includes(name)) {
            console.log(`Match: ${t1} vs ${t2} ID: ${info.matchId}`);
            return { matchId: info.matchId, info };
          }
        }
      }
    } catch (e) {
      console.log(`${url} failed:`, e.message);
    }
  }
  return null;
}

async function tryScorecard(matchId) {
  const endpoints = [
    `https://www.cricbuzz.com/api/cricket-match/${matchId}/scorecard`,
    `https://www.cricbuzz.com/api/cricket-match/${matchId}/full-scorecard`,
    `https://www.cricbuzz.com/api/cricket-match/${matchId}/commentary`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetchUrl(url, {
        'Referer': `https://www.cricbuzz.com/live-cricket-scorecard/${matchId}`
      });
      if (res.status !== 200) continue;

      const json = JSON.parse(res.body);
      const innings = json.scorecard?.[0];
      const header = json.matchHeader;
      if (!innings || !header) continue;

      const batsmen = Object.values(innings.batTeamDetails?.batsmanData || {})
        .filter(b => !b.outDesc || b.outDesc === '').slice(0, 2);
      const bowlers = Object.values(innings.bowlTeamDetails?.bowlerData || {})
        .filter(b => b.isCurrentBowler).slice(0, 1);

      const b1 = batsmen[0] || {};
      const b2 = batsmen[1] || {};
      const bwl = bowlers[0] || {};

      return {
        teamA: {
          name: header.team1?.teamSName || teamNames[0].toUpperCase(),
          score: `${innings.scoreDetails?.runs || 0}/${innings.scoreDetails?.wickets || 0}`,
          overs: String(innings.scoreDetails?.overs || '0.0'),
          flag: ''
        },
        teamB: {
          name: header.team2?.teamSName || teamNames[1].toUpperCase(),
          score: 'Yet to bat', overs: '0.0', flag: ''
        },
        matchInfo: `${header.matchDescription || ''} • ${header.seriesName || ''}`,
        event: '',
        batsman1: { name: b1.batName || '', runs: b1.runs || 0, balls: b1.balls || 0, fours: b1.fours || 0, sixes: b1.sixes || 0, isStriker: true },
        batsman2: { name: b2.batName || '', runs: b2.runs || 0, balls: b2.balls || 0, fours: b2.fours || 0, sixes: b2.sixes || 0, isStriker: false },
        bowler: { name: bwl.bowlName || '', overs: bwl.overs || '0', maidens: bwl.maidens || 0, runs: bwl.runs || 0, wickets: bwl.wickets || 0 },
        lastWicket: innings.scoreDetails?.lastWicket || '',
        nextBatter: '',
        runRate: String(innings.scoreDetails?.runRate || ''),
        requiredRate: '', target: '',
        ticker: `${header.team1?.teamSName} vs ${header.team2?.teamSName} • Live`,
        lastUpdated: new Date().toISOString(),
        source: 'cricbuzz'
      };
    } catch (e) {
      console.log(`Scorecard failed:`, e.message);
    }
  }
  return null;
}

// Try CricAPI (free, no key needed for basic)
async function tryCricAPI() {
  try {
    console.log('Trying CricAPI...');
    const res = await fetchUrl('https://api.cricapi.com/v1/currentMatches?apikey=a52ea237-4a2a-4e84-9ea2-accde1f7f6e0&offset=0');
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    const json = JSON.parse(res.body);
    if (!json.data) throw new Error('No data');

    for (const match of json.data) {
      const name = (match.name || '').toLowerCase();
      for (const team of teamNames) {
        if (name.includes(team)) {
          console.log('CricAPI match found:', match.name);
          const t1 = match.teams?.[0] || teamNames[0].toUpperCase();
          const t2 = match.teams?.[1] || teamNames[1].toUpperCase();
          const score = match.score || [];
          const s1 = score[0] || {};
          const s2 = score[1] || {};

          return {
            teamA: {
              name: t1.substring(0, 3).toUpperCase(),
              score: s1.r ? `${s1.r}/${s1.w}` : '0/0',
              overs: String(s1.o || '0.0'),
              flag: ''
            },
            teamB: {
              name: t2.substring(0, 3).toUpperCase(),
              score: s2.r ? `${s2.r}/${s2.w}` : 'Yet to bat',
              overs: String(s2.o || '0.0'),
              flag: ''
            },
            matchInfo: match.name || '',
            event: '',
            batsman1: { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isStriker: true },
            batsman2: { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isStriker: false },
            bowler: { name: '', overs: '0', maidens: 0, runs: 0, wickets: 0 },
            lastWicket: '', nextBatter: '', runRate: '', requiredRate: '', target: '',
            ticker: `${t1} vs ${t2} • Live`,
            lastUpdated: new Date().toISOString(),
            source: 'cricapi'
          };
        }
      }
    }
  } catch (e) {
    console.log('CricAPI failed:', e.message);
  }
  return null;
}

// Try cricbuzz-cricket npm alternative endpoint
async function tryAlternative() {
  try {
    console.log('Trying alternative cricket endpoint...');
    const t1 = teamNames[0].toUpperCase();
    const t2 = teamNames[1].toUpperCase();
    const res = await fetchUrl(`https://cricket-live-scores1.p.rapidapi.com/matches`, {
      'X-RapidAPI-Key': 'RAPIDAPI_KEY_HERE',
      'X-RapidAPI-Host': 'cricket-live-scores1.p.rapidapi.com'
    });
    console.log('RapidAPI status:', res.status);
  } catch (e) {
    console.log('Alternative failed:', e.message);
  }
  return null;
}

async function main() {
  let data = null;

  // Try Cricbuzz
  const match = await tryCricbuzz();
  if (match) {
    data = await tryScorecard(match.matchId);
  }

  // Try CricAPI
  if (!data) {
    data = await tryCricAPI();
  }

  if (!data) {
    console.log('All sources failed. Keeping cached data.');
    try {
      const existing = JSON.parse(fs.readFileSync('data.json', 'utf8'));
      existing.lastUpdated = new Date().toISOString();
      existing.source = 'cached';
      fs.writeFileSync('data.json', JSON.stringify(existing, null, 2));
      console.log('Cache updated');
    } catch (e) {
      console.log('No cache available');
    }
    process.exit(0);
  }

  fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
  console.log('✅ SUCCESS:', data.teamA.name, data.teamA.score, 'vs', data.teamB.name, data.teamB.score);
  console.log('Source:', data.source);
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(0);
});
```

---

After running, the key line to look for is:
```
GET https://api.cricapi.com/... → 200
