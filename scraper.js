/**
 * ═══════════════════════════════════════════════════════
 *  CRICKET AUTO-SCRAPER
 *  Tries Crex.com first → falls back to Cricbuzz
 *  Runs via GitHub Actions every 5 minutes
 * ═══════════════════════════════════════════════════════
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

// ── Read match config ──────────────────────────────────
const config = JSON.parse(fs.readFileSync('match-config.json', 'utf8'));

if (!config.enabled || !config.matchUrl) {
  console.log('⛔ No match URL set or scraping disabled. Set URL in control panel.');
  process.exit(0);
}

const MATCH_URL = config.matchUrl.trim();
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Referer': 'https://www.google.com/'
};

// ── Utility ─────────────────────────────────────────────
function safeStr(val, fallback = '') { return (val || fallback).toString().trim(); }
function safeInt(val, fallback = 0)  { return parseInt(val) || fallback; }
function safeFloat(val, fallback = '0.00') {
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n.toFixed(2);
}

// ─────────────────────────────────────────────────────────
//  CREX.COM SCRAPER
// ─────────────────────────────────────────────────────────
async function scrapeCrex(url) {
  console.log('🔄 Trying Crex.com:', url);
  try {
    // Extract match ID from URL patterns like:
    // https://crex.com/cricket-scorecard/ABC123/team-a-vs-team-b
    const matchIdMatch = url.match(/scorecard\/([A-Za-z0-9\-_]+)/);
    const matchSlug    = url.split('/').filter(Boolean).pop();

    // Crex internal API endpoints (no key required, same as mobile app uses)
    const apiEndpoints = [
      `https://crex.com/api/v1/match/${matchIdMatch?.[1]}/scorecard`,
      `https://crex.com/api/v1/scorecard?slug=${matchSlug}`,
      `https://crex.com/proxy/scorecard/${matchIdMatch?.[1]}`
    ];

    // Try each API endpoint
    for (const endpoint of apiEndpoints) {
      try {
        const res = await axios.get(endpoint, {
          headers: { ...HEADERS, 'Accept': 'application/json' },
          timeout: 10000
        });
        if (res.data && (res.data.score || res.data.matchData || res.data.batting)) {
          console.log('✅ Crex API responded');
          return parseCrexAPI(res.data);
        }
      } catch(e) { /* try next */ }
    }

    // Fallback: scrape HTML page
    const res = await axios.get(url, { headers: HEADERS, timeout: 12000 });
    return parseCrexHTML(res.data);

  } catch(e) {
    console.log('❌ Crex failed:', e.message);
    return null;
  }
}

function parseCrexAPI(data) {
  try {
    // Navigate Crex API response structure
    const match   = data.matchData || data.match || data;
    const batting = data.batting   || data.batsmen || match.batting || [];
    const bowling = data.bowling   || data.bowlers || match.bowling || [];
    const scorecard = data.scorecard || data.liveScore || match;

    const teamA = scorecard.team1 || scorecard.battingTeam || {};
    const teamB = scorecard.team2 || scorecard.fieldingTeam || {};

    const bat1 = batting[0] || {};
    const bat2 = batting[1] || {};
    const bowl = bowling[0] || bowling.find(b => b.currentlyBowling) || bowling[bowling.length - 1] || {};

    return buildDataObject({
      teamAName:  safeStr(teamA.name || teamA.shortName, 'TEAM A'),
      teamAScore: safeStr(scorecard.score || teamA.score, '0/0'),
      teamAOvers: safeStr(scorecard.overs || teamA.overs, '0.0'),
      teamAEmoji: getFlagEmoji(teamA.name),
      teamABatting: true,
      teamBName:  safeStr(teamB.name || teamB.shortName, 'TEAM B'),
      teamBScore: safeStr(teamB.score || scorecard.target, ''),
      teamBOvers: '',
      teamBEmoji: getFlagEmoji(teamB.name),
      teamBBatting: false,
      partnership: safeStr(scorecard.partnership, '0(0)'),
      crr: safeFloat(scorecard.crr || scorecard.runRate),
      rrr: safeFloat(scorecard.rrr || scorecard.requiredRunRate, ''),
      matchNote: safeStr(scorecard.tossText || scorecard.status, ''),
      event: getEventFromStatus(scorecard.status || scorecard.ballStatus || ''),
      bat1Name:   safeStr(bat1.name || bat1.batsman, 'BATSMAN 1'),
      bat1Runs:   safeInt(bat1.runs || bat1.r),
      bat1Balls:  safeInt(bat1.balls || bat1.b),
      bat1Fours:  safeInt(bat1.fours || bat1['4s']),
      bat1Sixes:  safeInt(bat1.sixes || bat1['6s']),
      bat1SR:     safeFloat(bat1.sr || bat1.strikeRate),
      bat1Photo:  safeStr(bat1.image || bat1.photoUrl || bat1.playerImage),
      bat1Striker: bat1.isStriker || bat1.onStrike || true,
      bat2Name:   safeStr(bat2.name || bat2.batsman, 'BATSMAN 2'),
      bat2Runs:   safeInt(bat2.runs || bat2.r),
      bat2Balls:  safeInt(bat2.balls || bat2.b),
      bat2Fours:  safeInt(bat2.fours || bat2['4s']),
      bat2Sixes:  safeInt(bat2.sixes || bat2['6s']),
      bat2SR:     safeFloat(bat2.sr || bat2.strikeRate),
      bat2Photo:  safeStr(bat2.image || bat2.photoUrl || bat2.playerImage),
      bat2Striker: bat2.isStriker || bat2.onStrike || false,
      bowlName:   safeStr(bowl.name || bowl.bowler, 'BOWLER'),
      bowlWkts:   safeInt(bowl.wickets || bowl.w),
      bowlRuns:   safeInt(bowl.runs || bowl.r),
      bowlOvers:  safeStr(bowl.overs || bowl.o, '0.0'),
      bowlEcon:   safeFloat(bowl.economy || bowl.econ),
      bowlPhoto:  safeStr(bowl.image || bowl.photoUrl || bowl.playerImage),
      lastWicketScore: safeStr(scorecard.lastWicket || scorecard.lastWkt, '—'),
      ticker: buildTicker(teamA.name, teamB.name, scorecard),
      source: 'crex'
    });
  } catch(e) {
    console.log('Crex API parse error:', e.message);
    return null;
  }
}

function parseCrexHTML(html) {
  try {
    const $ = cheerio.load(html);

    // Try to find embedded JSON data (Next.js / Angular apps embed state)
    let embeddedData = null;
    $('script').each((i, el) => {
      const src = $(el).html() || '';
      // Common patterns for embedded state
      const patterns = [
        /window\.__INITIAL_STATE__\s*=\s*({.+?});/s,
        /window\.__APP_STATE__\s*=\s*({.+?});/s,
        /__NEXT_DATA__['"]\s*type="application\/json"[^>]*>({.+?})<\/script>/s,
        /<script id="__NEXT_DATA__"[^>]*>({.+?})<\/script>/s,
      ];
      for (const p of patterns) {
        const m = src.match(p);
        if (m) {
          try { embeddedData = JSON.parse(m[1]); return false; } catch(e) {}
        }
      }
    });

    if (embeddedData) {
      // Try to extract from Next.js pageProps
      const props = embeddedData?.props?.pageProps || embeddedData;
      if (props.scorecard || props.match || props.liveData) {
        return parseCrexAPI(props.scorecard || props.match || props.liveData || props);
      }
    }

    // Pure HTML scraping as last resort
    const scoreText = $('.score, .live-score, [class*="score"]').first().text().trim();
    const teamsText = $('.team-name, [class*="team-name"]').map((i, el) => $(el).text().trim()).get();

    if (!scoreText) return null;

    const scoreMatch = scoreText.match(/(\d+\/\d+|\d+)\s*[\(\s]+(\d+\.?\d*)/);
    return buildDataObject({
      teamAName: teamsText[0] || 'TEAM A',
      teamAScore: scoreMatch?.[1] || '0/0',
      teamAOvers: scoreMatch?.[2] || '0.0',
      teamAEmoji: getFlagEmoji(teamsText[0]),
      teamBName: teamsText[1] || 'TEAM B',
      teamBEmoji: getFlagEmoji(teamsText[1]),
      source: 'crex-html'
    });

  } catch(e) {
    console.log('Crex HTML parse error:', e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────
//  CRICBUZZ SCRAPER
// ─────────────────────────────────────────────────────────
async function scrapeCricbuzz(url) {
  console.log('🔄 Trying Cricbuzz:', url);
  try {
    // Extract match ID: https://www.cricbuzz.com/live-cricket-scorecard/12345/...
    const idMatch = url.match(/\/(\d{4,6})\//);
    if (!idMatch) throw new Error('Cannot extract match ID from URL');

    const matchId = idMatch[1];
    console.log('  Match ID:', matchId);

    // Cricbuzz internal JSON APIs (used by their own mobile app — no key needed)
    const apiUrls = [
      `https://www.cricbuzz.com/api/cricket-match/${matchId}/commentary`,
      `https://www.cricbuzz.com/api/cricket-match/${matchId}/full-commentary`,
      `https://www.cricbuzz.com/api/html/cricket-scorecard/${matchId}`
    ];

    for (const apiUrl of apiUrls) {
      try {
        const res = await axios.get(apiUrl, {
          headers: {
            ...HEADERS,
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': `https://www.cricbuzz.com/live-cricket-scorecard/${matchId}/match`
          },
          timeout: 10000
        });

        if (res.data && typeof res.data === 'object') {
          console.log('✅ Cricbuzz API responded');
          return parseCricbuzzAPI(res.data, matchId);
        }
      } catch(e) { /* try next */ }
    }

    // HTML scrape fallback
    const res = await axios.get(
      url.includes('cricbuzz') ? url : `https://www.cricbuzz.com/live-cricket-scorecard/${matchId}/match`,
      { headers: HEADERS, timeout: 12000 }
    );
    return parseCricbuzzHTML(res.data);

  } catch(e) {
    console.log('❌ Cricbuzz failed:', e.message);
    return null;
  }
}

function parseCricbuzzAPI(data, matchId) {
  try {
    // Cricbuzz response has matchHeader and scoreCard
    const header   = data.matchHeader || {};
    const score    = data.scoreCard   || data.miniscore || {};
    const miniscore = data.miniscore  || {};
    const batsmen  = miniscore.batTeam?.teamPlayersList || score.batsmen || [];
    const bowler   = miniscore.bowlerStriker || score.bowler || {};

    const teamBatting  = miniscore.batTeam  || header.team1 || {};
    const teamBowling  = miniscore.bowlTeam || header.team2 || {};

    const bat1 = batsmen[0] || {};
    const bat2 = batsmen[1] || {};

    // Get photos via Cricbuzz CDN pattern
    const photoBase = 'https://static.cricbuzz.com/a/img/v1/152x152/i1/c';

    return buildDataObject({
      teamAName:  safeStr(teamBatting.teamSName || teamBatting.teamName, 'TEAM A'),
      teamAScore: `${miniscore.runs || 0}/${miniscore.wickets || 0}`,
      teamAOvers: safeStr(miniscore.overs, '0.0'),
      teamAEmoji: getFlagEmoji(teamBatting.teamName),
      teamABatting: true,
      teamBName:  safeStr(teamBowling.teamSName || teamBowling.teamName, 'TEAM B'),
      teamBScore: safeStr(miniscore.target || header.seriesName, ''),
      teamBEmoji: getFlagEmoji(teamBowling.teamName),
      teamBBatting: false,
      partnership: safeStr(miniscore.partnerShip?.runs ? `${miniscore.partnerShip.runs}(${miniscore.partnerShip.balls})` : '0(0)'),
      crr: safeFloat(miniscore.currentRunRate),
      rrr: safeFloat(miniscore.requiredRunRate, ''),
      matchNote: safeStr(header.tossResults?.tossResultTxt || miniscore.status, ''),
      event: getEventFromStatus(miniscore.status || data.commentary?.[0]?.event || 'LIVE'),
      bat1Name:   safeStr(bat1.batName || bat1.fullName, 'BATSMAN 1'),
      bat1Runs:   safeInt(bat1.runs),
      bat1Balls:  safeInt(bat1.balls),
      bat1Fours:  safeInt(bat1.fours || bat1['4s']),
      bat1Sixes:  safeInt(bat1.sixes || bat1['6s']),
      bat1SR:     safeFloat(bat1.strikeRate),
      bat1Photo:  bat1.batId ? `${photoBase}${bat1.batId}/i.jpg` : '',
      bat1Striker: bat1.isStriker ?? true,
      bat2Name:   safeStr(bat2.batName || bat2.fullName, 'BATSMAN 2'),
      bat2Runs:   safeInt(bat2.runs),
      bat2Balls:  safeInt(bat2.balls),
      bat2Fours:  safeInt(bat2.fours || bat2['4s']),
      bat2Sixes:  safeInt(bat2.sixes || bat2['6s']),
      bat2SR:     safeFloat(bat2.strikeRate),
      bat2Photo:  bat2.batId ? `${photoBase}${bat2.batId}/i.jpg` : '',
      bat2Striker: bat2.isStriker ?? false,
      bowlName:   safeStr(bowler.bowlName || bowler.fullName, 'BOWLER'),
      bowlWkts:   safeInt(bowler.wickets),
      bowlRuns:   safeInt(bowler.runs),
      bowlOvers:  safeStr(bowler.overs, '0.0'),
      bowlEcon:   safeFloat(bowler.economy),
      bowlPhoto:  bowler.bowlId ? `${photoBase}${bowler.bowlId}/i.jpg` : '',
      lastWicketScore: safeStr(miniscore.lastWicket, '—'),
      ticker: buildTicker(
        teamBatting.teamName,
        teamBowling.teamName,
        { score: `${miniscore.runs}/${miniscore.wickets}`, overs: miniscore.overs, crr: miniscore.currentRunRate }
      ),
      source: 'cricbuzz'
    });
  } catch(e) {
    console.log('Cricbuzz API parse error:', e.message);
    return null;
  }
}

function parseCricbuzzHTML(html) {
  try {
    const $ = cheerio.load(html);
    const teams = [];
    $('.cb-nav-main .cb-nav-item').each((i, el) => teams.push($(el).text().trim()));

    const scoreEl = $('.cb-min-bat-rw .cb-font-20').first().text().trim();
    const oversEl = $('.cb-min-bat-rw .cb-font-12').first().text().trim();
    const crrEl   = $('[ng-bind*="crr"], .cb-lv-score-sec-div').first().text().trim();

    const batsmen = [];
    $('.cb-min-itm-rw').each((i, el) => {
      const cols = $(el).find('td');
      if (cols.length >= 5) {
        batsmen.push({
          name: $(cols[0]).text().trim(),
          runs: parseInt($(cols[1]).text()) || 0,
          balls: parseInt($(cols[2]).text()) || 0,
          fours: parseInt($(cols[3]).text()) || 0,
          sixes: parseInt($(cols[4]).text()) || 0,
          sr: $(cols[5])?.text().trim() || '0.00'
        });
      }
    });

    const bat1 = batsmen[0] || {};
    const bat2 = batsmen[1] || {};

    return buildDataObject({
      teamAName: teams[0] || 'TEAM A',
      teamAScore: scoreEl || '0/0',
      teamAOvers: oversEl || '0.0',
      teamAEmoji: getFlagEmoji(teams[0]),
      teamBName: teams[1] || 'TEAM B',
      teamBEmoji: getFlagEmoji(teams[1]),
      crr: crrEl.replace(/[^0-9.]/g, '') || '0.00',
      bat1Name: bat1.name || 'BATSMAN 1',
      bat1Runs: bat1.runs || 0,
      bat1Balls: bat1.balls || 0,
      bat1Fours: bat1.fours || 0,
      bat1Sixes: bat1.sixes || 0,
      bat1SR: bat1.sr || '0.00',
      bat2Name: bat2.name || 'BATSMAN 2',
      bat2Runs: bat2.runs || 0,
      bat2Balls: bat2.balls || 0,
      source: 'cricbuzz-html'
    });
  } catch(e) {
    console.log('Cricbuzz HTML parse error:', e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────
//  BUILD FINAL data.json OBJECT
// ─────────────────────────────────────────────────────────
function buildDataObject(p) {
  return {
    teamA: {
      name: p.teamAName || 'TEAM A',
      shortName: (p.teamAName || 'A').substring(0, 3).toUpperCase(),
      flagUrl: p.teamAFlagUrl || '',
      flagEmoji: p.teamAEmoji || '🏏',
      score: p.teamAScore || '0/0',
      overs: p.teamAOvers || '0.0',
      isBatting: p.teamABatting !== false
    },
    teamB: {
      name: p.teamBName || 'TEAM B',
      shortName: (p.teamBName || 'B').substring(0, 3).toUpperCase(),
      flagUrl: p.teamBFlagUrl || '',
      flagEmoji: p.teamBEmoji || '🎯',
      score: p.teamBScore || '',
      overs: p.teamBOvers || '',
      isBatting: p.teamBBatting || false
    },
    matchInfo: {
      format: p.format || 'T20',
      series: p.series || '',
      venue: p.venue || '',
      partnership: p.partnership || '0(0)',
      crr: p.crr || '0.00',
      rrr: p.rrr || '',
      note: p.matchNote || '',
      inning: p.inning || ''
    },
    event: p.event || 'LIVE',
    batsman1: {
      name: (p.bat1Name || 'BATSMAN 1').toUpperCase(),
      fullName: p.bat1Name || 'BATSMAN 1',
      runs: p.bat1Runs || 0,
      balls: p.bat1Balls || 0,
      fours: p.bat1Fours || 0,
      sixes: p.bat1Sixes || 0,
      sr: p.bat1SR || '0.00',
      photoUrl: p.bat1Photo || '',
      isStriker: p.bat1Striker !== false
    },
    batsman2: {
      name: (p.bat2Name || 'BATSMAN 2').toUpperCase(),
      fullName: p.bat2Name || 'BATSMAN 2',
      runs: p.bat2Runs || 0,
      balls: p.bat2Balls || 0,
      fours: p.bat2Fours || 0,
      sixes: p.bat2Sixes || 0,
      sr: p.bat2SR || '0.00',
      photoUrl: p.bat2Photo || '',
      isStriker: p.bat2Striker || false
    },
    bowler: {
      name: (p.bowlName || 'BOWLER').toUpperCase(),
      fullName: p.bowlName || 'BOWLER',
      wickets: p.bowlWkts || 0,
      runs: p.bowlRuns || 0,
      overs: p.bowlOvers || '0.0',
      economy: p.bowlEcon || '0.00',
      photoUrl: p.bowlPhoto || ''
    },
    nextBatter: { name: p.nextBatter || 'NEXT BATTER', photoUrl: p.nextBatterPhoto || '', show: true },
    lastWicket: { name: p.lastWicketName || '—', score: p.lastWicketScore || '—', photoUrl: '', show: true },
    ticker: p.ticker || '',
    showTicker: true,
    dataSource: p.source || 'unknown',
    lastUpdated: new Date().toISOString()
  };
}

// ─────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────
function getEventFromStatus(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('six'))                  return 'SIX!';
  if (s.includes('four') || s.includes('boundary')) return 'FOUR!';
  if (s.includes('wicket') || s.includes('out') || s.includes(' w ')) return 'WICKET!';
  if (s.includes('wide'))                 return 'WIDE';
  if (s.includes('no ball') || s.includes('noball')) return 'NO BALL';
  if (s.includes('drs') || s.includes('review')) return 'DRS';
  if (s.includes('lbw'))                  return 'LBW CHECK';
  return 'LIVE';
}

function buildTicker(teamA, teamB, data) {
  const parts = [];
  if (teamA && teamB) parts.push(`${teamA} vs ${teamB}`);
  if (data?.score)  parts.push(`Score: ${data.score}`);
  if (data?.overs)  parts.push(`Overs: ${data.overs}`);
  if (data?.crr)    parts.push(`CRR: ${data.crr}`);
  return parts.join('  |  ');
}

const FLAG_MAP = {
  'india':'🇮🇳','pakistan':'🇵🇰','england':'🏴󠁧󠁢󠁥󠁮󠁧󠁿','australia':'🇦🇺',
  'south africa':'🇿🇦','new zealand':'🇳🇿','west indies':'🌴','sri lanka':'🇱🇰',
  'bangladesh':'🇧🇩','afghanistan':'🇦🇫','zimbabwe':'🇿🇼','ireland':'🇮🇪',
  'netherlands':'🇳🇱','uae':'🇦🇪','nepal':'🇳🇵','oman':'🇴🇲',
  'ind':'🇮🇳','pak':'🇵🇰','eng':'🏴󠁧󠁢󠁥󠁮󠁧󠁿','aus':'🇦🇺','sa':'🇿🇦',
  'nz':'🇳🇿','wi':'🌴','sl':'🇱🇰','ban':'🇧🇩','afg':'🇦🇫'
};

function getFlagEmoji(teamName) {
  if (!teamName) return '🏏';
  const key = teamName.toLowerCase().trim();
  for (const [k, v] of Object.entries(FLAG_MAP)) {
    if (key.includes(k)) return v;
  }
  return '🏏';
}

// ─────────────────────────────────────────────────────────
//  MAIN — Try Crex first, fallback to Cricbuzz
// ─────────────────────────────────────────────────────────
async function main() {
  console.log('🏏 Cricket Auto-Scraper Started');
  console.log('📌 Match URL:', MATCH_URL);
  console.log('⏰', new Date().toISOString());
  console.log('─'.repeat(50));

  let data = null;

  // Determine which site the URL is from
  const isCrex     = MATCH_URL.includes('crex.com');
  const isCricbuzz = MATCH_URL.includes('cricbuzz.com');

  // Try primary source
  if (isCrex || (!isCrex && !isCricbuzz)) {
    data = await scrapeCrex(MATCH_URL);
  } else if (isCricbuzz) {
    data = await scrapeCricbuzz(MATCH_URL);
  }

  // Fallback to the other source
  if (!data) {
    console.log('⚠️  Primary source failed, trying backup...');
    if (isCrex || (!isCrex && !isCricbuzz)) {
      // Try cricbuzz with same match name
      console.log('🔄 Looking up match on Cricbuzz...');
      try {
        const searchRes = await axios.get(
          `https://www.cricbuzz.com/api/cricket-match/live-matches`,
          { headers: HEADERS, timeout: 8000 }
        );
        const matches = searchRes.data?.typeMatches || [];
        for (const type of matches) {
          for (const series of (type.seriesMatches || [])) {
            for (const match of (series.seriesAdWrapper?.matches || [])) {
              const info = match.matchInfo;
              if (info?.matchId) {
                const cbUrl = `https://www.cricbuzz.com/live-cricket-scorecard/${info.matchId}/match`;
                data = await scrapeCricbuzz(cbUrl);
                if (data) break;
              }
            }
            if (data) break;
          }
          if (data) break;
        }
      } catch(e) { console.log('Backup search failed:', e.message); }
    } else {
      data = await scrapeCrex(MATCH_URL.replace('cricbuzz.com', 'crex.com'));
    }
  }

  if (!data) {
    console.log('❌ All sources failed. Keeping existing data.json.');
    process.exit(1);
  }

  // Write to data.json
  fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
  console.log('✅ data.json updated successfully!');
  console.log(`   ${data.teamA.name} ${data.teamA.score} (${data.teamA.overs}) vs ${data.teamB.name}`);
  console.log(`   ${data.batsman1.name}: ${data.batsman1.runs}(${data.batsman1.balls}) | ${data.batsman2.name}: ${data.batsman2.runs}(${data.batsman2.balls})`);
  console.log(`   Bowler: ${data.bowler.name} ${data.bowler.runs}-${data.bowler.wickets} (${data.bowler.overs})`);
  console.log(`   Source: ${data.dataSource}`);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
