const axios = require('axios');
const cheerio = require('cheerio');

// Function to scrape data from Cricbuzz
const scrapeCricbuzz = async () => {
    const url = 'https://www.cricbuzz.com/';
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    // Example selector; this might need adjustments based on the actual structure of the website
    const liveScores = [];
    $('.cb-col.cb-col-100.cb-ltst-wgt').each((index, element) => {
        const match = $(element).find('.cb-col.cb-col-100.cb-mtch-blk').text().trim();
        const score = $(element).find('.cb-col.cb-col-100.cb-scrs-wrp').text().trim();
        liveScores.push({ match, score });
    });
    return liveScores;
};

// Function to scrape data from Crex
const scrapeCrex = async () => {
    const url = 'https://crex.com/';
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    // Example selector; this might need adjustments based on the actual structure of the website
    const liveScores = [];
    $('.live-match').each((index, element) => {
        const match = $(element).find('.match-name').text().trim();
        const score = $(element).find('.match-score').text().trim();
        liveScores.push({ match, score });
    });
    return liveScores;
};

// Main function to run scrapers
const main = async () => {
    const cricbuzzData = await scrapeCricbuzz();
    const crexData = await scrapeCrex();
    console.log('Cricbuzz Live Scores:', cricbuzzData);
    console.log('Crex Live Scores:', crexData);
};

main();
