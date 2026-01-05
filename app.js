const BASE_URL = "http://localhost:3000"

// Get ncfa cookie from localStorage
function getNcfaCookie() {
    return localStorage.getItem('ncfa_cookie');
}

// Check if user has provided ncfa cookie, redirect to login if not
const ncfaCookie = getNcfaCookie();

if (!ncfaCookie) {
    window.location.href = '/login';
    throw new Error('Redirecting to login...');
}

// Logout functionality
document.addEventListener('DOMContentLoaded', () => {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('ncfa_cookie');
            window.location.href = '/login';
        });
    }
});

async function fetchGameTokens() {
    console.log("Fetching game tokens...");
    try {
        let paginationToken = null;
        const tokens = [];
        
        while (true) {
            const url = new URL(`${BASE_URL}/api/feed/private`);
            if (paginationToken) {
                url.searchParams.append('paginationToken', paginationToken);
            }
            
            const response = await fetch(url, {
                headers: {
                    'x-ncfa-cookie': ncfaCookie
                }
            });
            if (!response.ok) {
                throw new Error(`API request failed with status ${response.status}`);
            }
            
            const data = await response.json();
            if (!data.entries || !Array.isArray(data.entries)) {
                console.warn('No entries found in response');
                break;
            }
            
            for (const entry of data.entries) {
                try {
                    const payloadJson = JSON.parse(entry.payload);
                    for (const payload of payloadJson) {
                        if (payload?.payload?.gameMode === 'TeamDuels') {
                            tokens.push(payload.payload.gameId);
                        }
                    }
                } catch (parseError) {
                    console.warn('Failed to parse entry payload:', parseError, entry.payloadJson);
                    continue;
                }
            }
            
            paginationToken = data.paginationToken;
            if (!paginationToken) break;
        }
        
        console.log(`Fetched ${tokens.length} game tokens`);
        return tokens;
    } catch (error) {
        console.error('Error fetching game tokens:', error);
        return [];
    }
}

async function processGameTokens(game_tokens) {
    stats = await getStats(game_tokens, game_tokens.length);
    return stats;
}

/*
interface Stats {
    moving: ModeStats;
    noMove: ModeStats;
    nmpz: ModeStats;
}

interface ModeStats {
    games: GameStats[];
    rounds: RoundStats[];
}

interface GameStats {
    rounds: number;
    startTime: string;
    finalMultiplier: number;
    finalHealth: number;
    finalHealthDiff: number;
    //ranked: boolean;
    //isTeamDuels: boolean;
    //initialHealth: number;
}

interface RoundStats {
    score: number;
    scoreDiff: number;
    distance: number;
    firstGuessTime: number;
    guessedFirst: boolean;
    countryCode: string;
    panorama: Panorama;
    bestGuessLat: number;
    bestGuessLng: number;
}
*/

function initializeStats() {
    return {
        moving: createEmptyStats(),
        noMove: createEmptyStats(),
        nmpz: createEmptyStats()
    };
}

function createEmptyStats() {
    return {
        games: [],
        rounds: []
    };
}

async function getStats(gameTokens, numberOfGames) {
    const stats = initializeStats();

    console.log("Starting to process game tokens...");
    console.log(Math.min(numberOfGames, gameTokens.length));
    numberOfGames = Math.min(numberOfGames, gameTokens.length);
    
    for (let i = 0; i < numberOfGames; i++) {
        try {
            const token = gameTokens[i];
            console.log(`Processing token: (${i}/${numberOfGames})`, token);
            
            const response = await fetch(`${BASE_URL}/api/duels/${token}`, {
                headers: {
                    'x-ncfa-cookie': ncfaCookie
                }
            });
            const game = await response.json();
            console.log(game);
            
            const gameMode = getGameMode(game);
            const modeStats = stats[gameMode];
            
            const ranked = game.options.isRated;
            const isTeamDuels = game.options.isTeamDuels;
            const initialHealth = game.options.initialHealth;

            const ownTeamIndex = game.teams.findIndex(team => team.players.some(player => player.playerId === ""));

            if (ownTeamIndex !== 0 && ownTeamIndex !== 1) {
                console.warn(`Player not found in game ${token}`);
                continue;
            }

            const ownTeam = game.teams[ownTeamIndex];
            const opponentTeam = game.teams[1 - ownTeamIndex];

            const ownResults = ownTeam.roundResults;
            const opponentResults = opponentTeam.roundResults;
            
            const finalMultiplier = ownTeam.currentMultiplier;
            const finalHealth = ownTeam.health;
            const finalHealthOpponent = opponentTeam.health;
            const finalHealthDiff = finalHealth - finalHealthOpponent;

            const startTime = game.rounds[0]?.startTime;

            // Store game data
            modeStats.games.push({
                rounds: game.rounds.length,
                startTime,
                finalMultiplier,
                finalHealth,
                finalHealthDiff,
                //ranked,
                //isTeamDuels,
                //initialHealth
            });
            const gameIndex = modeStats.games.length - 1;

            let round = 0;
            let roundInfo = game.rounds[round];
            while (roundInfo = game.rounds[round]) {
                const countryCode = roundInfo.panorama.countryCode;
                const panoramaData = roundInfo.panorama;
                const panorama = {
                    panoId: panoramaData.panoId,
                    lat: panoramaData.lat,
                    lng: panoramaData.lng
                };

                const roundStartTime = new Date(roundInfo.startTime);
                const roundFirstGuessTime = roundInfo.timerStartTime;

                let guess1Time = ownTeam.players[0].guesses[round]?.created;
                let guess2Time = ownTeam.players[1].guesses[round]?.created;
                const guessedFirst = guess1Time === roundFirstGuessTime || guess2Time === roundFirstGuessTime;
                guess1Time = guess1Time ? new Date(guess1Time) : null;
                guess2Time = guess2Time ? new Date(guess2Time) : null;

                const ownResult = ownResults[round];
                const opponentResult = opponentResults[round];
                
                const didGuess = (!!guess1Time || !!guess2Time) && !!ownResult.bestGuess;
                if (!didGuess) {
                    console.log(`Did not guess for round ${round} in game ${token}, skipping`, roundInfo);
                    round++;
                    continue;
                }

                if (!ownResult || !opponentResult) {
                    console.warn(`Missing results for round ${round} in game ${token}, skipping`, roundInfo);
                    round++;
                    continue;
                }

                const roundScore = ownResult.score;
                const opponentScore = opponentResult.score;
                const scoreDiff = roundScore - opponentScore;

                const roundDistance = ownResult.bestGuess.distance;

                const bestGuessLat = ownResult.bestGuess.lat;
                const bestGuessLng = ownResult.bestGuess.lng;

                let ownFirstGuessTime = null;
                if (guess1Time) {
                    ownFirstGuessTime = guess1Time - roundStartTime;
                }
                if (guess2Time) {
                    if (!!guess1Time && guess2Time < guess1Time) {
                        ownFirstGuessTime = guess2Time - roundStartTime;
                    }
                }
                
                // Store round data
                modeStats.rounds.push({
                    game: gameIndex,
                    score: roundScore,
                    scoreDiff,
                    distance: roundDistance,
                    firstGuessTime: guessedFirst ? ownFirstGuessTime : null,
                    guessedFirst,
                    countryCode,
                    panorama,
                    bestGuessLat,
                    bestGuessLng
                });

                round++;
            }
        } catch (error) {
            console.error(`Error processing token ${gameTokens[i]}:`, error);
        }
    }
    
    return stats;
}

function getGameMode(game) {
    const { forbidMoving, forbidZooming, forbidRotating } = game.movementOptions;
    
    if (!forbidMoving && !forbidZooming && !forbidRotating) {
        return 'moving';
    } else if (forbidMoving && !forbidZooming && !forbidRotating) {
        return 'noMove';
    } else if (forbidMoving && forbidZooming && forbidRotating) {
        return 'nmpz';
    }
    
    return 'custom'; // TODO
}

const loadSavedTokens = true;
const loadSavedStats = true;


let game_tokens = [];
let stats = null;

(async () => {
    if (loadSavedTokens) {
        game_tokens = await fetch('game_tokens.json').then(res => res.json());
        console.log(game_tokens.length, 'game tokens loaded');
    } else {
        game_tokens = await fetchGameTokens();
        console.log('Game tokens fetched:', game_tokens);
    }

    if (loadSavedStats) {
        stats = await fetch('stats.json').then(res => res.json());
        console.log('Data loaded from save:', stats);
    } else {
        stats = await processGameTokens(game_tokens);
        console.log('Data loaded:', stats);
    }
    
    displayScoreDiffPerCountry();

    cldrToIso = (await fetch('countries.json').then(res => res.json())).cldrToIso3166Alpha3;
    displayPerformanceMap(cldrToIso);
    displayGuessesMap();
})();




function countryCodeToFlag(countryCode) {
    // Convert country code (e.g., 'US') to flag emoji using regional indicator symbols
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
}

function calculateMedian(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 
        ? Math.floor((sorted[mid - 1] + sorted[mid]) / 2)
        : sorted[mid];
}

function displayScoreDiffPerCountry() {
    const statsContent = document.getElementById('statsContent');
    
    if (!stats || !stats.moving || !stats.moving.rounds) {
        statsContent.innerHTML = '<p>No data available</p>';
        return;
    }
    
    const rounds = stats.moving.rounds;
    
    if (rounds.length === 0) {
        statsContent.innerHTML = '<p>No country data available</p>';
        return;
    }
    
    // Collect all score diffs by country
    const scoreDiffsByCountry = {};
    
    rounds.forEach(round => {
        const cc = round.countryCode;
        if (!scoreDiffsByCountry[cc]) {
            scoreDiffsByCountry[cc] = [];
        }
        scoreDiffsByCountry[cc].push(round.scoreDiff);
    });
    
    // Calculate medians and prepare for display
    const countries = Object.keys(scoreDiffsByCountry).map(cc => {
        const medianScoreDiff = calculateMedian(scoreDiffsByCountry[cc]);
        return [cc, medianScoreDiff, scoreDiffsByCountry[cc].length];
    }).sort((a, b) => b[1] - a[1]); // Sort by median score diff (highest to lowest)
    
    const grid = document.createElement('div');
    grid.className = 'stats-grid';
    
    countries.forEach(([countryCode, scoreDiff, count]) => {
        const card = document.createElement('div');
        card.className = `country-stat ${scoreDiff > 0 ? 'positive' : scoreDiff < 0 ? 'negative' : ''}`;
        
        const codeSpan = document.createElement('span');
        codeSpan.className = 'country-code';
        codeSpan.textContent = countryCodeToFlag(countryCode);
        codeSpan.title = countryCode; // Show country code on hover
        
        const infoContainer = document.createElement('div');
        infoContainer.style.display = 'flex';
        infoContainer.style.flexDirection = 'column';
        infoContainer.style.alignItems = 'flex-end';
        
        const scoreSpan = document.createElement('span');
        scoreSpan.className = `score-diff ${scoreDiff > 0 ? 'positive' : scoreDiff < 0 ? 'negative' : ''}`;
        scoreSpan.textContent = scoreDiff > 0 ? `+${scoreDiff}` : scoreDiff;
        
        const countSpan = document.createElement('span');
        countSpan.style.fontSize = '12px';
        countSpan.style.color = '#888';
        countSpan.style.marginTop = '4px';
        countSpan.textContent = `${count} locations`;
        
        infoContainer.appendChild(scoreSpan);
        infoContainer.appendChild(countSpan);
        
        card.appendChild(codeSpan);
        card.appendChild(infoContainer);
        grid.appendChild(card);
    });
    
    statsContent.innerHTML = '';
    statsContent.appendChild(grid);
}

function displayPerformanceMap(cldrToIso) {
    if (!stats || !stats.moving || !stats.moving.rounds) {
        console.warn('No stats data available for map');
        return;
    }
    
    const rounds = stats.moving.rounds;
    
    if (rounds.length === 0) {
        console.warn('No round data available for map');
        return;
    }
    
    // Collect all score diffs by country code
    const scoreDiffsByCountry = {};
    
    rounds.forEach(round => {
        const cc = round.countryCode;
        if (!scoreDiffsByCountry[cc]) {
            scoreDiffsByCountry[cc] = [];
        }
        scoreDiffsByCountry[cc].push(round.scoreDiff);
    });
    
    // Calculate medians for each country
    const countries = [];
    const medians = [];
    const locationCounts = [];
    
    Object.entries(scoreDiffsByCountry).forEach(([cc, diffs]) => {
        countries.push(cldrToIso[cc]);
        medians.push(calculateMedian(diffs));
        locationCounts.push(diffs.length);
    });

    medians.push(-5000);
    medians.push(5000);
    
    // Create choropleth data
    const data = [{
        type: 'choropleth',
        locations: countries,
        z: medians,
        colorscale: [
            [0, '#f44336'],
            [0.45, '#ffd0c8ff'],
            [0.5, '#f9f9f9'],
            [0.55, '#c1f3c0ff'],
            [1, '#4caf50'],
        ],
        colorbar: {
            title: 'Median Score Diff'
        },
        hovertext: countries.map((cc, i) => 
            `${cc}<br>Median: ${medians[i]}<br>Locations: ${locationCounts[i]}`
        ),
        hoverinfo: 'text',
    }];
    
    const layout = {
        title: 'Performance by Country (Median Score Difference)',
        geo: {
            projection: {
                type: 'natural earth'
            }
        },
        height: 600,
        margin: { l: 0, r: 0, t: 50, b: 0 }
    };
    
    Plotly.newPlot('map', data, layout, { responsive: true });
}

function displayGuessesMap() {
    if (!stats || !stats.moving || !stats.moving.rounds) {
        console.warn('No stats data available for guesses map');
        return;
    }
    
    const rounds = stats.moving.rounds;
    
    if (rounds.length === 0) {
        console.warn('No round data available for guesses map');
        return;
    }
    
    // Collect all guesses with their coordinates and scores
    const lats = [];
    const lons = [];
    const scores = [];
    const hoverTexts = [];
    
    rounds.forEach(round => {
        lats.push(round.panorama.lat);
        lons.push(round.panorama.lng);
        scores.push(round.score);
        hoverTexts.push(`Score: ${round.score}<br>Δ Score: ${round.scoreDiff > 0 ? '+' : ''}${round.scoreDiff}<br>Country: ${round.countryCode}<br>${new Date(stats.moving.games[round.game]?.startTime).toLocaleDateString()}`);
    });

    scores.push(0);
    scores.push(5000);
    
    // Create scatter map data
    const data = [{
        type: 'scattergeo',
        lon: lons,
        lat: lats,
        mode: 'markers',
        marker: {
            size: 6,
            color: scores,
            colorscale: [
                [0, '#f44336'],      
                [0.75, '#ffeb3b'],    
                [1, '#4caf50'],
            ],
            colorbar: {
                title: 'Score'
            },
            showscale: true,
        },
        text: hoverTexts,
        hoverinfo: 'text'
    }];
    
    const layout = {
        title: 'All Guesses (Color-coded by Score)',
        geo: {
            projection: {
                type: 'natural earth'
            }
        },
        height: 600,
        margin: { l: 0, r: 0, t: 50, b: 0 }
    };
    
    Plotly.newPlot('guessesMap', data, layout, { responsive: true });
    
    // Add hover event listener
    const mapElement = document.getElementById('guessesMap');
    mapElement.on('plotly_hover', (data) => {
        /*const point = data.points[0];
        console.log(`Hovering over point:`, {
            lat: point.lat,
            lon: point.lon,
            score: point.marker.color[point.pointNumber],
            text: point.text
        });*/
        //console.log('Hover data:', data);
    });
    mapElement.on('plotly_click', (data) => {
        const point = data.points[0];
        if (!point) 
            return;

        const i = point.pointNumber;
        const round = stats.moving.rounds[i];
        console.log('Click round:', round);

        const panoId = round.panorama.panoId;
        const decodedPanoId = String.fromCharCode(...panoId.match(/.{1,2}/g).map(hex => parseInt(hex, 16)));
        const svUrl = `https://www.google.com/maps/@-4.2267238,-73.4826543,3a,75y,285.31h,90t/data=!3m7!1e1!3m5!1s${decodedPanoId}!2e0!6shttps:%2F%2Fstreetviewpixels-pa.googleapis.com%2Fv1%2Fthumbnail%3Fcb_client%3Dmaps_sv.tactile!7i13312!8i6656`
        window.open(svUrl, '_blank');
    });
}
