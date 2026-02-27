const fs = require('fs');
const https = require('https');

const config = JSON.parse(fs.readFileSync('match-config.json', 'utf8'));
const matchUrl = config.matchUrl.trim();
console.log('Match URL:', matchUrl);

// Extract team names from URL
const urlTeams = matchUrl.match(/([a-z]{2,3})-vs-([a-z]{2,3})/i);
const teamNames = urlTeams ? [urlTeams[1], urlTeams[2]] : ['eng', 'nz'];
console.log('Teams:', teamNames);

function fetchUrl(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/html, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        ...headers
      },
      timeout: 15000
    };
    const req = https.get(url, options, (res) => {
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

// Try Cricbuzz live matches list
async function tryLiveMatches() {
  const urls = [
    'https://www.cricbuzz.com/api/cricket-match/live-matches',
    'https://cricbuzz.com/live-cricket-scores',
    'https://www.cricbuzz.com/cricket-match/live-scores',
  ];

  for (const url of urls) {
    try {
      const res = await fetchUrl(url);
      if (res.status === 200) {
        // Try JSON parse
        try {
          const json = JSON.parse(res.body);
          const matches = json.typeMatches?.flatMap(t =>
            t.seriesMatches?.flatMap(s =>
              s.seriesAdWrapper?.matches || []
            ) || []
          ) || [];

          console.log(`Found ${matches.length} matches from ${url}`);

          for (const m of matches) {
            const info = m.matchInfo;
            const t1 = (info?.team1?.teamName || '').toLowerCase();
            const t2 = (info?.team2?.teamName || '').toLowerCase();
            for (const name of teamNames) {
              if (t1.includes(name) || t2.includes(name)) {
                console.log(`Match found: ${t1} vs ${t2} ID: ${info.matchId}`);
                return info.matchId;
              }
            }
          }
        } catch (e) {
          console.log('Not JSON, trying HTML parse');
        }
      }
    } catch (e) {
      console.log(`Failed ${url}:`, e.message);
    }
  }
  return null;
}

// Try Cricbuzz scorecard by match ID
async function tryScorecard(matchId) {
  const urls = [
    `https://www.cricbuzz.com/api/cricket-match/${matchId}/scorecard`,
    `https://www.cricbuzz.com/api/cricket-match/${matchId}/full-scorecard`,
    `https://www.cricbuzz.com/live-cricket-scorecard/${matchId}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetchUrl(url);
      if (res.status !== 200) continue;
      const json = JSON.parse(res.body);

      const innings = json.scorecard?.[0];
      const header = json.matchHeader;
      if (!innings || !header) continue;

      const batsmen = Object.values(innings.batTeamDetails?.batsmanData || {})
        .filter(b => !b.outDesc || b.outDesc === '')
        .slice(0, 2);

      const bowlers = Object.values(innings.bowlTeamDetails?.bowlerData || {})
        .filter(b => b.isCurrentBowler)
        .slice(0, 1);

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
          score: 'Yet to bat',
          overs: '0.0',
          flag: ''
        },
        matchInfo: `${header.matchDescription || ''} • ${header.seriesName || ''}`,
        event: '',
        batsman1: { name: b1.batName || '', runs: b1.runs || 0, balls: b1.balls || 0, fours: b1.fours || 0, sixes: b1.sixes || 0, isStriker: true },
        batsman2: { name: b2.batName || '', runs: b2.runs || 0, balls: b2.balls || 0, fours: b2.fours || 0, sixes: b2.sixes || 0, isStriker: false },
        bowler: { name: bwl.bowlName || '', overs: bwl.overs || '0', maidens: bwl.maidens || 0, runs: bwl.runs || 0, wickets: bwl.wickets || 0 },
        lastWicket: innings.scoreDetails?.lastWicket || '',
        nextBatter: '',
        runRate: String(innings.scoreDetails?.runRate || ''),
        requiredRate: '',
        target: '',
        ticker: `${header.team1?.teamSName} vs ${header.team2?.teamSName} • Live`,
        lastUpdated: new Date().toISOString(),
        source: 'cricbuzz'
      };
    } catch (e) {
      console.log(`Scorecard ${url} failed:`, e.message);
    }
  }
  return null;
}

// Try ESPN Cricinfo live data
async function tryESPN() {
  try {
    console.log('Trying ESPN Cricinfo...');
    const searchUrl = `https://site.api.espn.com/apis/site/v2/sports/cricket/summary?event=${teamNames[0]}`;
    const res = await fetchUrl('https://site.api.espn.com/apis/site/v2/sports/cricket/scoreboard');
    if (res.status !== 200) throw new Error(`Status ${res.status}`);

    const json = JSON.parse(res.body);
    const events = json.events || [];
    console.log(`ESPN: ${events.length} events found`);

    for (const event of events) {
      const name = (event.name || '').toLowerCase();
      for (const team of teamNames) {
        if (name.includes(team)) {
          const comp = event.competitions?.[0];
          const competitors = comp?.competitors || [];
          const t1 = competitors[0];
          const t2 = competitors[1];

          return {
            teamA: {
              name: t1?.team?.abbreviation || teamNames[0].toUpperCase(),
              score: t1?.score || '0/0',
              overs: '0.0',
              flag: ''
            },
            teamB: {
              name: t2?.team?.abbreviation || teamNames[1].toUpperCase(),
              score: t2?.score || 'Yet to bat',
              overs: '0.0',
              flag: ''
            },
            matchInfo: event.name || '',
            event: '',
            batsman1: { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isStriker: true },
            batsman2: { name: '', runs: 0, balls: 0, fours: 0, sixes: 0, isStriker: false },
            bowler: { name: '', overs: '0', maidens: 0, runs: 0, wickets: 0 },
            lastWicket: '',
            nextBatter: '',
            runRate: '',
            requiredRate: '',
            target: '',
            ticker: `${t1?.team?.abbreviation} vs ${t2?.team?.abbreviation} • Live`,
            lastUpdated: new Date().toISOString(),
            source: 'espn'
          };
        }
      }
    }
  } catch (e) {
    console.log('ESPN failed:', e.message);
  }
  return null;
}

async function main() {
  let data = null;

  // Try Cricbuzz
  const matchId = await tryLiveMatches();
  if (matchId) {
    data = await tryScorecard(matchId);
  }

  // Try ESPN as backup
  if (!data) {
    data = await tryESPN();
  }

  if (!data) {
    console.log('All sources failed. Keeping cached data.');
    try {
      const existing = JSON.parse(fs.readFileSync('data.json', 'utf8'));
      existing.lastUpdated = new Date().toISOString();
      existing.source = 'cached';
      fs.writeFileSync('data.json', JSON.stringify(existing, null, 2));
    } catch (e) {
      console.log('No existing data.json');
    }
    process.exit(0);
  }

  fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
  console.log('✅ data.json updated!');
  console.log(`   ${data.teamA.name} ${data.teamA.score} vs ${data.teamB.name} ${data.teamB.score}`);
  console.log(`   Source: ${data.source}`);
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(0);
});
