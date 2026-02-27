const { Octokit } = require('@octokit/rest');
const fs = require('fs');
const path = require('path');
const schedule = require('node-schedule');

const octokit = new Octokit({
  auth: 'YOUR_GITHUB_TOKEN'
});

const repoOwner = 'nandkishor7582-ux';
const repoName = 'cricket-overlay';
const filePath = 'match-data.json';

const updateMatchData = async () => {
  // Fetch or generate the updated match data. This is just a dummy object.
  const updatedMatchData = { time: new Date().toISOString(), data: 'Updated match data here.' };
  fs.writeFileSync(filePath, JSON.stringify(updatedMatchData, null, 2));

  // Get the SHA of the existing file to update it
  const { data: { sha } } = await octokit.repos.getContent({ owner: repoOwner, repo: repoName, path: filePath });

  // Commit the new file contents
  await octokit.repos.createOrUpdateFileContents({
    owner: repoOwner,
    repo: repoName,
    path: filePath,
    message: 'Automated update of match data',
    content: fs.readFileSync(filePath, { encoding: 'base64' }),
    sha: sha // Pass the SHA to replace existing file
  });
};

// Schedule the job to run every hour.
const job = schedule.scheduleJob('0 * * * *', updateMatchData);

console.log('Scheduled match data updates at every hour.');
