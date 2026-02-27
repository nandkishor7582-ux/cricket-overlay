const fs = require('fs');
const axios = require('axios');

const fetchLiveMatchData = async () => {
    try {
        const response = await axios.get('https://api.football-data.org/v2/matches');
        return response.data;
    } catch (error) {
        console.error('Error fetching live match data:', error);
    }
};

const updateDataJson = async () => {
    const liveMatchData = await fetchLiveMatchData();
    if (liveMatchData) {
        fs.writeFileSync('data.json', JSON.stringify(liveMatchData, null, 2));
        console.log('data.json updated with live match data');
    }
};

// Run the update every 5 minutes
setInterval(updateDataJson, 5 * 60 * 1000);