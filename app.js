// TODO: remove hardcoding, offer selection after login
let ownPlayerId = "";
let teamMateId = "";

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

// Backup preference: default ON
if (localStorage.getItem('enable_duel_backup') === null) {
    localStorage.setItem('enable_duel_backup', '1');
}

function isBackupEnabled() {
    return localStorage.getItem('enable_duel_backup') === '1';
}

        
// TODO: fetch this from https://www.geoguessr.com/api/v4/ranked-team-duels/divisions ?
const DIVISION_DATA = {
    "1": "Champion",
    "2": "Master I",
    "3": "Master II",
    "4": "Gold I",
    "5": "Gold II",
    "6": "Gold III",
    "7": "Silver I",
    "8": "Silver II",
    "9": "Silver III",
    "10": "Bronze",
}

// Current mode state
let currentMode = 'moving';

let game_tokens = [];
let stats = null;

let countryData = {}; // Maps CLDR country code to {name, iso3166Alpha3}
let profileSummary = null;
let teamDuelsStats = null;
let duelsStats = null;
let singleplayerStats = null;
let selectedCategory = 'teamDuels';
let selectedTeamId = null;
let duelsScope = 'ranked'; // ranked | all
let selectedEvolutionCountry = null; // 'world' or CLDR code
// Global timeframe selection for the bottom timeline (ms since epoch)
const timelineSelection = {
    startMs: null,
    endMs: null
};

function persistValue(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.warn('Persist failed', key, e);
    }
}

function loadPersistedValue(key) {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return undefined;
        return JSON.parse(raw);
    } catch (e) {
        return undefined;
    }
}

const LS_KEYS = {
    ownPlayerId: 'ls_ownPlayerId',
    teamMateId: 'ls_teamMateId',
    selectedCategory: 'ls_selectedCategory',
    selectedTeamId: 'ls_selectedTeamId',
    duelsScope: 'ls_duelsScope',
    currentMode: 'ls_currentMode',
    metric_map: 'ls_metric_map',
    metric_guesses: 'ls_metric_guesses',
    metric_boxplot: 'ls_metric_boxplot',
    metric_countrylist: 'ls_metric_countrylist',
    metric_evolution: 'ls_metric_evolution',
    evolution_country: 'ls_evolution_country',
    timeframeStart: 'ls_timeframeStart',
    timeframeEnd: 'ls_timeframeEnd'
};

function loadPersistedState() {
    const storedOwn = loadPersistedValue(LS_KEYS.ownPlayerId);
    if (storedOwn) ownPlayerId = storedOwn;
    const storedMate = loadPersistedValue(LS_KEYS.teamMateId);
    if (storedMate) teamMateId = storedMate;
    const storedCat = loadPersistedValue(LS_KEYS.selectedCategory);
    if (storedCat) selectedCategory = storedCat;
    const storedTeam = loadPersistedValue(LS_KEYS.selectedTeamId);
    if (storedTeam) selectedTeamId = storedTeam;
    const storedDuelsScope = loadPersistedValue(LS_KEYS.duelsScope);
    if (storedDuelsScope) duelsScope = storedDuelsScope;
    const storedMode = loadPersistedValue(LS_KEYS.currentMode);
    if (storedMode) currentMode = storedMode;
    const storedEvoCountry = loadPersistedValue(LS_KEYS.evolution_country);
    if (storedEvoCountry) selectedEvolutionCountry = storedEvoCountry;
    const storedTimeframeStart = loadPersistedValue(LS_KEYS.timeframeStart);
    if (storedTimeframeStart === 'earliest') {
        timelineSelection.startMs = null;
    } else if (storedTimeframeStart) {
        timelineSelection.startMs = storedTimeframeStart;
    }
    const storedTimeframeEnd = loadPersistedValue(LS_KEYS.timeframeEnd);
    if (storedTimeframeEnd === 'latest') {
        timelineSelection.endMs = null;
    } else if (storedTimeframeEnd) {
        timelineSelection.endMs = storedTimeframeEnd;
    }
}

loadPersistedState();

// Logout functionality and mode toggle
document.addEventListener('DOMContentLoaded', () => {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('ncfa_cookie');
            window.location.href = '/login';
        });
    }

    // Mode toggle functionality
    const modeOptions = document.querySelectorAll('.mode-option');
    modeOptions.forEach(option => {
        if (option.dataset.mode === currentMode) {
            option.classList.add('active');
        }
        option.addEventListener('click', () => {
            modeOptions.forEach(opt => opt.classList.remove('active'));
            option.classList.add('active');
            currentMode = option.dataset.mode;
            persistValue(LS_KEYS.currentMode, currentMode);
            refreshDisplays();
        });
    });

    // Discreet backup toggle in corner
    const toggleContainer = document.createElement('div');
    toggleContainer.className = 'backup-toggle';

    const label = document.createElement('label');
    label.title = 'Toggle backing up duels game data on the server';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isBackupEnabled();
    checkbox.addEventListener('change', () => {
        localStorage.setItem('enable_duel_backup', checkbox.checked ? '1' : '0');
    });

    const span = document.createElement('span');
    span.textContent = 'Save duels';
    span.style.userSelect = 'none';

    label.appendChild(checkbox);
    label.appendChild(span);
    toggleContainer.appendChild(label);
    document.body.appendChild(toggleContainer);
    // Create metric selectors for each statistic
    function metricKeyForId(id) {
        if (id === 'map-metric-select') return LS_KEYS.metric_map;
        if (id === 'guesses-metric-select') return LS_KEYS.metric_guesses;
        if (id === 'boxplot-metric-select') return LS_KEYS.metric_boxplot;
        if (id === 'countrylist-metric-select') return LS_KEYS.metric_countrylist;
        if (id === 'evolution-metric-select') return LS_KEYS.metric_evolution;
        return null;
    }

    function createMetricSelector(parentSelector, id, includeGuessedFirst, defaultSelected = 'scoreDiff') {
        const parent = document.querySelector(parentSelector);
        if (!parent) return;
        const container = document.createElement('div');
        container.className = 'metric-selector';

        const label = document.createElement('label');
        label.textContent = 'Metric:';

        const select = document.createElement('select');
        select.id = id;

        const options = [
            { v: 'scoreDiff', t: 'Score Difference' },
            { v: 'score', t: 'Score' },
            //{ v: 'distance', t: 'Distance' }
        ];
        options.forEach(o => select.appendChild(new Option(o.t, o.v)));
        if (includeGuessedFirst) {
            select.appendChild(new Option('Guessed-first rate', 'guessedFirstRate'));
        }

        const persistedKey = metricKeyForId(id);
        const persistedVal = persistedKey ? loadPersistedValue(persistedKey) : undefined;
        select.value = persistedVal || defaultSelected;

        select.addEventListener('change', () => {
            if (persistedKey) persistValue(persistedKey, select.value);
            refreshDisplays();
        });

        container.appendChild(label);
        container.appendChild(select);
        // insert container after the heading inside the stats container
        const heading = parent.querySelector('h2') || parent.querySelector('h1');
        if (heading && heading.parentNode) {
            heading.parentNode.insertBefore(container, heading.nextSibling);
        } else {
            parent.insertBefore(container, parent.firstChild);
        }
    }

    // Keep selectors aligned with sections order
    createMetricSelector('.stats-container:nth-of-type(1)', 'map-metric-select', true);
    createMetricSelector('.stats-container:nth-of-type(2)', 'guesses-metric-select', false, 'score');
    createMetricSelector('.stats-container:nth-of-type(3)', 'boxplot-metric-select', false);
    // New evolution section at index 4
    createMetricSelector('.stats-container:nth-of-type(4)', 'evolution-metric-select', false, 'scoreDiff');
    // Country list moved to index 5
    createMetricSelector('.stats-container:nth-of-type(5)', 'countrylist-metric-select', true);
});

let currentGamesInRange = null;
let cachedFilteredData = null;
let timeframeDebounceTimer = null;

function refreshTimeframe(gamesInRange) {
    if (gamesInRange && currentGamesInRange === gamesInRange) {
        return; // No change
    }
    currentGamesInRange = gamesInRange;

    // Clear existing debounce timer
    if (timeframeDebounceTimer) {
        clearTimeout(timeframeDebounceTimer);
    }

    // Set new debounce timer
    timeframeDebounceTimer = setTimeout(() => {
        cachedFilteredData = getFilteredGameData(true);
        console.log('Timeframe updated:', timelineSelection.startMs, timelineSelection.endMs);
        refreshDisplays();
        timeframeDebounceTimer = null;
    }, 100);
}

/**
 * Filter games and rounds by the selected timeframe (timelineSelection)
 * Returns {games, rounds, gameIndexMap} where gameIndexMap maps old indices to new indices
 */
function getFilteredGameData(recalculate = false) {
    if (cachedFilteredData && !recalculate) {
        return cachedFilteredData;
    }

    if (!timelineSelection || !timelineSelection.startMs || !timelineSelection.endMs) {
        return { games: stats[currentMode].games, rounds: stats[currentMode].rounds, gameIndexMap: null };
    }

    if (!stats || !stats[currentMode] || !stats[currentMode].games) {
        return { games: [], rounds: [], gameIndexMap: {} };
    }

    const allGames = stats[currentMode].games;
    const allRounds = stats[currentMode].rounds;
    const { startMs, endMs } = timelineSelection;

    // Filter games by timeframe
    const gameIndexMap = {}; // maps old index to new index
    const filteredGames = [];
    allGames.forEach((game, oldIdx) => {
        if (!game || !game.startTime) return;
        const time = new Date(game.startTime).getTime();
        if (time >= startMs && time <= endMs) {
            gameIndexMap[oldIdx] = filteredGames.length;
            filteredGames.push(game);
        }
    });

    // Filter rounds by included games
    const filteredRounds = allRounds.filter(round => {
        const gameIdx = round.game;
        return gameIndexMap.hasOwnProperty(gameIdx);
    });

    console.log(`Filtered data: ${filteredGames.length} games, ${filteredRounds.length} rounds within timeframe ${new Date(startMs).toISOString()} - ${new Date(endMs).toISOString()}`);
    return { games: filteredGames, rounds: filteredRounds, gameIndexMap };
}

function refreshDisplays() {
    // Update title
    const listTitle = document.getElementById('listTitle');
    const boxplotTitle = document.getElementById('boxplotTitle');
    const evolutionTitle = document.getElementById('evolutionTitle');


    if (listTitle) {
        const listMetric = (document.getElementById('countrylist-metric-select') || { value: 'scoreDiff' }).value;
        let listMetricName = 'Score Difference';
        if (listMetric === 'guessedFirstRate') 
            listMetricName = 'Guessed-First Rate';
        else if (listMetric === 'score') 
            listMetricName = 'Score';
        else if (listMetric === 'distance') 
            listMetricName = 'Distance';
        listTitle.textContent = `${listMetric !== "guessedFirstRate" ? "Median " : ""}${listMetricName} Per Country`;
    }
    if (boxplotTitle) {
        const boxplotMetric = (document.getElementById('boxplot-metric-select') || { value: 'scoreDiff' }).value;
        const boxplotMetricName = boxplotMetric === 'score' ? 'Score' : 'Score Difference';
        boxplotTitle.textContent = `${boxplotMetricName} by Country (Boxplot)`;
    }
    if (evolutionTitle) {
        const evoMetric = (document.getElementById('evolution-metric-select') || { value: 'scoreDiff' }).value;
        const evoMetricName = evoMetric === 'score' ? 'Score' : 'Score Difference';
        const sel = selectedEvolutionCountry || 'world';
        let titleCountry = 'Worldwide';
        if (sel !== 'world') titleCountry = getCountryName(sel);
        evolutionTitle.textContent = `${evoMetricName} Evolution — ${titleCountry}`;
    }
    
    displayPerformanceMap();
    displayGuessesMap();
    displayBoxplot();
    renderEvolutionControls();
    displayEvolutionGraph();
    displayStatsAsList();
    renderTimeSelector();
}

async function fetchGameTokens() {
    console.log("Fetching game tokens...");
    
    const tokensByType = {
        "singlePlayer": [],
        "soloDuels": [],
        "teamDuels": [],
        "otherGames": [],
    };

    try {
        let paginationToken = null;
        
        let pageIndex = 1;
        while (true) {
            // TODO: Can see statistics of friends as well, using /friends instead of /private
            /*const url = new URL("/api/feed/private");
            if (paginationToken) {
                url.searchParams.append('paginationToken', paginationToken);
            }*/
            
            const response = await fetch(`/api/feed/private${paginationToken ? `?paginationToken=${encodeURIComponent(paginationToken)}` : ''}`, {
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
            
            function addEntries(entries) {
                for (const entry of entries) {
                    // payload, time, type, user: {id, ...}
                    let payload = entry.payload;
                    if (typeof payload === "string") {
                        try {
                            payload = JSON.parse(entry.payload);
                        } catch (parseError) {
                            console.warn('Failed to parse entry payload:', parseError, entry.payload);
                            continue;
                        }
                    }

                    const entryType = entry.type;
                    if (entryType === 7) { // Collection of entries
                        addEntries(payload);
                    } else if (entryType === 1) { // Singleplayer game
                        // mapSlug, mapName, points, gameToken, gameMode
                        tokensByType.singlePlayer.push({
                            token: payload.gameToken,
                            type: entryType,
                            mode: payload.gameMode,
                        });
                    } else if (entryType === 2) { // Challenge
                        // mapSlug, mapName, points, challengeToken, gameMode, isDailyChallenge
                        tokensByType.singlePlayer.push({
                            token: payload.challengeToken,
                            type: entryType,
                            mode: payload.gameMode,
                            dailyChallenge: payload.isDailyChallenge || false,
                        });
                    } else if (entryType === 6) { // Competitive Duel
                        // gameId, gameMode, competitiveGameMode
                        if (payload.gameMode === "Duels") {
                            tokensByType.soloDuels.push(payload.gameId);
                        } else if (payload.gameMode === "TeamDuels") {
                            tokensByType.teamDuels.push(payload.gameId);
                        } else {
                            console.warn('Unknown duel game mode:', payload.gameMode, entry);
                        }
                    } else {
                        // 4 = Achievement Unlocked
                        // 9 = Party Game: gameId, partyId, gameMode
                        // 11 = Unranked Duel: gameId, gameMode, competitiveGameMode
                        tokensByType.otherGames.push({
                            type: entryType,
                            payload: payload,
                        });
                    }
                }
            }
            addEntries(data.entries);
            console.log(`Page ${pageIndex}: Fetched ${data.entries.length} entries, total so far:`)
            
            paginationToken = data.paginationToken;
            if (!paginationToken)
                break;
            pageIndex++;
        }
    } catch (error) {
        console.error('Error fetching game tokens:', error);
    }

    try {
        backupFetchedGameTokens(tokensByType);
    } catch (e) {
        console.warn('Error backing up tokens:', e);
    }
    // Return empty combined list on error
    return tokensByType;
}

// Backup fetched game tokens in browser localStorage for recovery
function backupFetchedGameTokens(tokens) {
    try {
        console.log('Backing up game tokens to localStorage');
        
        console.log("Loading existing backup tokens from localStorage");
        let existingBackup = localStorage.getItem('backup_game_tokens');
        if (existingBackup) {
            existingBackup = JSON.parse(existingBackup);
            console.log("Existing backup found:", existingBackup);
        } else {
            console.log("No existing backup found.");
        }

        if (existingBackup) {
            console.log("Merging with existing backup tokens");
            // Merge existing backup with new tokens
            for (const key of Object.keys(tokens)) {
                if (Array.isArray(existingBackup[key])) {
                    const existingTokensSet = new Set(existingBackup[key].map(t => typeof t === 'object' ? JSON.stringify(t) : t));
                    for (const token of tokens[key]) {
                        const tokenKey = typeof token === 'object' ? JSON.stringify(token) : token;
                        if (!existingTokensSet.has(tokenKey)) {
                            existingBackup[key].push(token);
                            existingTokensSet.add(tokenKey);
                        }
                    }
                    tokens[key] = existingBackup[key];
                }
            }
        }

        localStorage.setItem('backup_game_tokens', JSON.stringify(tokens));
    } catch (err) {
        console.warn('Failed to backup game tokens to localStorage', err);
    }
}

async function processGameTokens() {
    stats = await getStats();
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

async function getStats(numberOfGames) {
    const stats = initializeStats();

    let tokens = [];
    // select token set based on selected category
    if (selectedCategory === 'soloDuels') {
        tokens = game_tokens.soloDuels;
    } else if (selectedCategory === 'teamDuels') {
        tokens = game_tokens.teamDuels;
    } else if (selectedCategory === 'singlePlayer') {
        tokens = game_tokens.singlePlayer.map(t => t.token);
    } else {
        return stats; // unsupported category
    }

    console.log("Starting to process game tokens...");
    if (!numberOfGames || numberOfGames <= 0) {
        numberOfGames = tokens.length;
    }
    console.log(Math.min(numberOfGames, tokens.length));
    numberOfGames = Math.min(numberOfGames, tokens.length);
    
    for (let i = 0; i < numberOfGames; i++) {
        try {
            const token = tokens[i];
            console.log(`Processing token: (${i + 1}/${numberOfGames})`, token);
            
            const requestHeaders = {
                'x-ncfa-cookie': ncfaCookie
            };
            if (isBackupEnabled()) 
                requestHeaders['x-backup'] = '1';
            const response = await fetch(`/api/duels/${token}`, {
                headers: requestHeaders
            });
            const game = await response.json();
            console.log(game);
            
            const gameMode = getGameMode(game);
            const modeStats = stats[gameMode];
            
            /*
            Not needed for now
            const ranked = game.options.isRated; // should always be true
            const initialHealth = game.options.initialHealth; // should always be 6000
            */
           
            const isTeamDuels = game.options.isTeamDuels; // should always be the expected value
            if (isTeamDuels !== (selectedCategory === 'teamDuels')) {
                console.warn(`Game ${token} isTeamDuels=${isTeamDuels} but selected category is ${selectedCategory}, skipping`);
                continue;
            }

            const ownTeamIndex = game.teams.findIndex(team => team.players.some(player => player.playerId === ownPlayerId));

            if (ownTeamIndex !== 0 && ownTeamIndex !== 1) {
                console.warn(`Own player not found in game ${token}`);
                continue;
            }

            const ownTeam = game.teams[ownTeamIndex];
            const opponentTeam = game.teams[1 - ownTeamIndex];

            // For team duels, check if teammate is in the game
            if (isTeamDuels && teamMateId) {
                const hasSelectedTeamMate = ownTeam.players.findIndex(player => player.playerId === teamMateId) !== -1;
                if (!hasSelectedTeamMate) {
                    console.warn(`Team mate (${teamMateId}) not found in own team for game ${token}`);
                    continue;
                }
            }

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
                let countryCode = roundInfo.panorama.countryCode;

                const panoramaData = roundInfo.panorama;
                const panorama = {
                    panoId: panoramaData.panoId,
                    lat: panoramaData.lat,
                    lng: panoramaData.lng
                };
                
                if (!countryCode) {
                    // it can happen that Cocos Islands don't have a country code set
                    if (panorama.lat <= -11.798727 && panorama.lat >= -12.236607 && panorama.lng >= 96.792723 && panorama.lng <= 96.974684) {
                        countryCode = "cc";
                    }
                } else if (countryCode === "fr") {
                    // Réunion is marked as France
                    if (panorama.lat <= -20.692274 && panorama.lat >= -21.478713 && panorama.lng >= 55.104502 && panorama.lng <= 55.945443) {
                        countryCode = "re";
                    }
                } else if (countryCode === "cn") {
                    // Macau is marked as China, we want it as "mo"
                    if (panorama.lat <= 22.220582 && panorama.lat >= 22.106154 && panorama.lng >= 113.521383 && panorama.lng <= 113.606134) {
                        countryCode = "mo";
                    }
                }
                // TODO: other special cases? (pm, io, ...)

                const roundStartTime = new Date(roundInfo.startTime);
                const roundFirstGuessTime = roundInfo.timerStartTime;

                let guessedFirst;
                let guess1Time = ownTeam.players[0].guesses[round]?.created;
                let guess2Time = null;
                if (isTeamDuels) {
                    guess2Time = ownTeam.players[1].guesses[round]?.created;
                    guessedFirst = guess1Time === roundFirstGuessTime || guess2Time === roundFirstGuessTime;
                    guess2Time = guess2Time ? new Date(guess2Time) : null;
                } else {
                    guessedFirst = guess1Time === roundFirstGuessTime;
                }
                guess1Time = guess1Time ? new Date(guess1Time) : null;

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
            console.error(`Error processing token ${tokens[i]}:`, error);
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

const loadSavedTokens = false;
const loadSavedStats = false;

(async () => {
    if (loadSavedTokens) {
        const tokenData = await fetch('tokens.json').then(res => res.json());
        console.log("Loaded saved game tokens:", tokenData);
        game_tokens = tokenData;
    } else {
        game_tokens = await fetchGameTokens();
        console.log(`Total game tokens fetched: ${game_tokens.soloDuels.length + game_tokens.teamDuels.length + game_tokens.singlePlayer.length + game_tokens.otherGames.length}`);
        console.log('Game tokens data:', game_tokens);
    }

    countryData = await fetch('countries.json').then(res => res.json());

    console.log('Loading menu data...');
    await loadMenuData();

    if (loadSavedStats) {
        stats = await fetch('stats.json').then(res => res.json());
        console.log('Data loaded from save:', stats);
    } else {
        stats = await processGameTokens();
        console.log('Data loaded:', stats);
    }
    
    refreshDisplays();
})();




function countryCodeToFlag(countryCode) {
    // Convert country code (e.g., 'US') to flag emoji using regional indicator symbols
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
}

function getCountryName(cldrCode) {
    return countryData[cldrCode]?.name || cldrCode;
}

function getCountryIso3(cldrCode) {
    return countryData[cldrCode]?.iso3166Alpha3 || cldrCode.toUpperCase();
}

function calculateMedian(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 
        ? Math.floor((sorted[mid - 1] + sorted[mid]) / 2)
        : sorted[mid];
}

async function loadMenuData() {
    // 1) Load profile first and render immediately
    try {
        const profileResponse = await fetch("/api/profiles", {
            headers: {
                'x-ncfa-cookie': ncfaCookie
            }
        });
        if (!profileResponse.ok) {
            throw new Error(`API request failed with status ${profileResponse.status}`);
        }
        const profile = await profileResponse.json();

        profileSummary = {
            userId: profile.user.id,
            name: profile.user.nick,
            level: profile.user.progress.level,
            countryCode: profile.user.countryCode,
        };
        if (profileSummary?.userId) {
            ownPlayerId = profileSummary.userId;
            persistValue(LS_KEYS.ownPlayerId, ownPlayerId);
        }
        renderMenuBar();
    } catch (e) {
        console.warn('Failed to load profile data', e);
    }

    // 2) Load overview asynchronously afterwards and re-render when ready
    (async () => {
        try {
            const rankedSystemResponse = await fetch("/api/ranked-system/me", {
                headers: {
                    'x-ncfa-cookie': ncfaCookie
                }
            });
            if (!rankedSystemResponse.ok) {
                throw new Error(`API request failed with status ${rankedSystemResponse.ok}`);
            }
            const rankedSystemData = await rankedSystemResponse.json();

            duelsStats = {
                divisionId: rankedSystemData.divisionNumber,
                division: DIVISION_DATA[rankedSystemData.divisionNumber] || '—',
                rating: rankedSystemData.rating,
                modeRatings: {
                    moving: rankedSystemData.gameModeRatings.standardDuels.rating,
                    noMove: rankedSystemData.gameModeRatings.noMoveDuels.rating,
                    nmpz: rankedSystemData.gameModeRatings.nmpzDuels.rating,
                },
                games: null, // TODO: from /stats/me
                winRate: null,
            };
            renderMenuBar();
        } catch (e) {
            console.warn('Failed to load solo duels data', e);
        }
    })();

    (async () => {
       try {
            const teamsResponse = await fetch("/api/ranked-team-duels/me/teams", {
                headers: {
                    'x-ncfa-cookie': ncfaCookie
                }
            });
            if (!teamsResponse.ok) {
                throw new Error(`API request failed with status ${teamsResponse.status}`);
            }
            const teamsData = await teamsResponse.json();

            const teamsRaw = teamsData.teams || [];
            const teams = teamsRaw.map(t => ({
                id: t.teamId, // is this even useful?
                name: t.teamName,
                mateId: t.members.find(m => m.userId !== ownPlayerId)?.userId || null,
                contryCodes: t.members.map(m => m.countryCode),
                gamesWon: t.gamesWon,
                gamesPlayed: t.gamesPlayed,
                latestGamePlayedAt: t.latestGamePlayedAt,
            }));
            // sort teams by latestGamePlayedAt desc
            teams.sort((a, b) => {
                const dateA = new Date(a.latestGamePlayedAt);
                const dateB = new Date(b.latestGamePlayedAt);
                return dateB - dateA;
            });

            teamDuelsStats = { teams };

            selectedTeamId = teams[0]?.id || selectedTeamId;
            if (selectedTeamId) 
                persistValue(LS_KEYS.selectedTeamId, selectedTeamId);
            if (!teamMateId && selectedTeamId) {
                const t = teamDuelsStats?.teams?.find(team => team.id === selectedTeamId);
                if (t?.mateId) {
                    teamMateId = t.mateId;
                    persistValue(LS_KEYS.teamMateId, teamMateId);
                }
            }
            renderMenuBar();
        } catch (e) {
            console.warn('Failed to load team duel data', e);
        }
    })();
}

function ensureDefaultEvolutionCountry() {
    if (!stats || !stats[currentMode] || !stats[currentMode].rounds) return 'world';
    const rounds = stats[currentMode].rounds;
    const metric = (document.getElementById('evolution-metric-select') || { value: 'scoreDiff' }).value;
    const valuesByCountry = {};
    rounds.forEach(r => {
        const cc = r.countryCode;
        if (!valuesByCountry[cc]) valuesByCountry[cc] = [];
        valuesByCountry[cc].push(metric === 'score' ? r.score : r.scoreDiff);
    });
    const threshold = 10; // substantial amount
    const ranked = Object.entries(valuesByCountry).map(([cc, vals]) => {
        const med = calculateMedian(vals);
        return { cc, med, count: vals.length };
    }).filter(x => x.count >= threshold)
      .sort((a, b) => b.med - a.med);
    return ranked.length ? ranked[0].cc : 'world';
}

function renderEvolutionControls() {
    const wrap = document.getElementById('evolutionControls');
    if (!wrap) return;
    wrap.innerHTML = '';

    // Country selector
    const label = document.createElement('label');
    label.textContent = 'Country:';
    label.style.fontSize = '12px';
    label.style.color = '#444';

    const select = document.createElement('select');
    select.id = 'evolution-country-select';

    // Worldwide option
    const unFlag = '🇺🇳';
    const worldwideOption = new Option(`${unFlag} Worldwide`, 'world');
    select.appendChild(worldwideOption);

    if (stats && stats[currentMode] && stats[currentMode].rounds) {
        const rounds = stats[currentMode].rounds;
        const counts = {};
        rounds.forEach(r => { counts[r.countryCode] = (counts[r.countryCode] || 0) + 1; });
        const entries = Object.keys(counts)
            .sort((a, b) => counts[b] - counts[a])
            .map(cc => ({ cc, name: getCountryName(cc), flag: countryCodeToFlag(cc), count: counts[cc] }));
        entries.forEach(e => {
            const opt = new Option(`${e.flag} ${e.name} (${e.count})`, e.cc);
            select.appendChild(opt);
        });
    }

    if (!selectedEvolutionCountry) {
        selectedEvolutionCountry = ensureDefaultEvolutionCountry();
        persistValue(LS_KEYS.evolution_country, selectedEvolutionCountry);
    }
    select.value = selectedEvolutionCountry || 'world';
    select.addEventListener('change', () => {
        selectedEvolutionCountry = select.value;
        persistValue(LS_KEYS.evolution_country, selectedEvolutionCountry);
        refreshDisplays();
    });

    wrap.appendChild(label);
    wrap.appendChild(select);
}

function ensureTimeSelectorContainer() {
    let wrap = document.getElementById('timeSelector');
    if (wrap) return wrap;

    wrap = document.createElement('div');
    wrap.id = 'timeSelector';
    wrap.className = 'time-selector';
    wrap.innerHTML = `
        <div class="time-selector__header">Timeframe</div>
        <div class="time-selector__timeline">
            <div class="time-selector__track"></div>
            <div class="time-selector__selection"></div>
            <div class="time-selector__dots"></div>
            <div class="time-selector__handle start" title="Drag to set start"></div>
            <div class="time-selector__handle end" title="Drag to set end"></div>
        </div>
        <div class="time-selector__labels">
            <span class="time-selector__label-start"></span>
            <span class="time-selector__label-range"></span>
            <span class="time-selector__label-end"></span>
        </div>
    `;
    document.body.appendChild(wrap);
    return wrap;
}

function formatTimelineLabel(ms) {
    if (!ms) return '—';
    const d = new Date(ms);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function renderTimeSelector() {
    const container = ensureTimeSelectorContainer();
    const timelineEl = container.querySelector('.time-selector__timeline');
    const dotsEl = container.querySelector('.time-selector__dots');
    const selectionEl = container.querySelector('.time-selector__selection');
    const startHandle = container.querySelector('.time-selector__handle.start');
    const endHandle = container.querySelector('.time-selector__handle.end');
    const startLabel = container.querySelector('.time-selector__label-start');
    const endLabel = container.querySelector('.time-selector__label-end');
    const rangeLabel = container.querySelector('.time-selector__label-range');

    const games = (stats && stats[currentMode] && stats[currentMode].games ? stats[currentMode].games : []).filter(g => g && g.startTime);
    if (!games.length) {
        container.classList.add('time-selector--empty');
        dotsEl.innerHTML = '';
        selectionEl.style.width = '0';
        selectionEl.style.left = '0';
        startLabel.textContent = 'No games yet';
        endLabel.textContent = '';
        rangeLabel.textContent = '';
        return;
    }
    container.classList.remove('time-selector--empty');

    const times = games
        .map(g => new Date(g.startTime).getTime())
        .filter(t => Number.isFinite(t))
        .sort((a, b) => a - b);

    if (!times.length) {
        container.classList.add('time-selector--empty');
        startLabel.textContent = 'No game dates available';
        endLabel.textContent = '';
        rangeLabel.textContent = '';
        dotsEl.innerHTML = '';
        selectionEl.style.width = '0';
        selectionEl.style.left = '0';
        return;
    }

    const minTime = times[0];
    const maxTime = times[times.length - 1];
    const span = Math.max(1, maxTime - minTime);

    // Load persisted timeframe or initialize to full range
    if (!timelineSelection.startMs || timelineSelection.startMs < minTime || timelineSelection.startMs > maxTime) {
        timelineSelection.startMs = minTime;
    }
    // Handle special 'earliest' and 'latest' values
    if (timelineSelection.endMs === 'latest' || !timelineSelection.endMs || timelineSelection.endMs > maxTime || timelineSelection.endMs < minTime) {
        timelineSelection.endMs = maxTime;
    }
    if (timelineSelection.startMs > timelineSelection.endMs) {
        timelineSelection.startMs = timelineSelection.endMs;
    }

    dotsEl.innerHTML = '';
    times.forEach((t) => {
        const pct = ((t - minTime) / span) * 100;
        const dot = document.createElement('div');
        dot.className = 'time-selector__dot';
        dot.style.left = `${pct}%`;
        dot.title = new Date(t).toLocaleString();
        dotsEl.appendChild(dot);
    });

    function applyPositions() {
        const startPct = ((timelineSelection.startMs - minTime) / span) * 100;
        const endPct = ((timelineSelection.endMs - minTime) / span) * 100;

        selectionEl.style.left = `${startPct}%`;
        selectionEl.style.width = `${Math.max(endPct - startPct, 0)}%`;

        startHandle.style.left = `${startPct}%`;
        endHandle.style.left = `${endPct}%`;

        startLabel.textContent = formatTimelineLabel(timelineSelection.startMs);
        endLabel.textContent = formatTimelineLabel(timelineSelection.endMs);

        const gamesInRange = times.filter(t => t >= timelineSelection.startMs && t <= timelineSelection.endMs).length;
        rangeLabel.textContent = `${gamesInRange} game${gamesInRange === 1 ? '' : 's'} selected`;

        // Expose selection to other code paths if needed
        container.dataset.timeframeStart = new Date(timelineSelection.startMs).toISOString();
        container.dataset.timeframeEnd = new Date(timelineSelection.endMs).toISOString();
        
        // Persist timeframe to localStorage
        // Save 'earliest' if start time equals min time, otherwise save the actual time
        persistValue(LS_KEYS.timeframeStart, timelineSelection.startMs === minTime ? 'earliest' : timelineSelection.startMs);
        // Save 'latest' if end time equals max time, otherwise save the actual time
        persistValue(LS_KEYS.timeframeEnd, timelineSelection.endMs === maxTime ? 'latest' : timelineSelection.endMs);
        
        refreshTimeframe(gamesInRange);
    }

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    function startDrag(handleType, event) {
        event.preventDefault();
        const rect = timelineEl.getBoundingClientRect();

        const onMove = (e) => {
            const width = rect.width || 1;
            const pct = clamp((e.clientX - rect.left) / width, 0, 1);
            const time = minTime + pct * span;

            if (handleType === 'start') {
                let maxPoint = timelineSelection.endMs;
                maxPoint -= (maxTime - minTime) * 0.01; // prevent overlap
                timelineSelection.startMs = Math.min(time, maxPoint);
            } else {
                timelineSelection.endMs = Math.max(time, timelineSelection.startMs);
            }

            applyPositions();
        };

        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }

    startHandle.onpointerdown = (e) => startDrag('start', e);
    endHandle.onpointerdown = (e) => startDrag('end', e);

    applyPositions();
}

function formatWinRate(rate) {
    if (rate === null || rate === undefined || Number.isNaN(rate)) return '—';
    return `${Math.round(rate * 1000) / 10}%`;
}

async function renderMenuBar() {
    const profileEl = document.getElementById('profileSummary');
    const cardsEl = document.getElementById('modeCards');
    if (!profileEl || !cardsEl) return;

    // Profile chip
    if (profileSummary) {
        const flag = countryCodeToFlag(profileSummary.countryCode || '');
        profileEl.innerHTML = `
            <span class="flag">${flag}</span>
            <div>
                <div class="name">${profileSummary.name || ''}</div>
                <div class="level">Level ${profileSummary.level || '—'}</div>
            </div>
        `;
    } else {
        profileEl.textContent = 'Loading profile...';
    }

    const modeNames = {
        'moving': 'Moving',
        'noMove': 'No Move',
        'nmpz': 'NMPZ'
    };

    cardsEl.innerHTML = '';
    const cardData = [];
    if (duelsStats) {
        const d = duelsStats;
        cardData.push({
            id: 'soloDuels',
            title: 'Duels',
            rows: [
                ['Division', d.division || '—'],
                ['Rating', d.rating != null ? d.rating : '—'],
                // mode rating
                [`${modeNames[currentMode]} Rating`, d.modeRatings[currentMode] ?? '—'],
                ['Games', d.games != null ? d.games : '—'],
                ['Win Rate', formatWinRate(d.winRate)]
            ],
            controls: () => {
                const wrap = document.createElement('div');
                wrap.className = 'controls';
                if (selectedCategory !== 'duels') {
                    wrap.style.display = 'none';
                }

                const toggle = document.createElement('div');
                toggle.className = 'pill-toggle';
                const rankedBtn = document.createElement('button');
                rankedBtn.textContent = 'Ranked';
                rankedBtn.className = duelsScope === 'ranked' ? 'active' : '';
                rankedBtn.onclick = (e) => { e.stopPropagation(); duelsScope = 'ranked'; persistValue(LS_KEYS.duelsScope, duelsScope); renderMenuBar(); };
                const allBtn = document.createElement('button');
                allBtn.textContent = 'All';
                allBtn.className = duelsScope === 'all' ? 'active' : '';
                allBtn.onclick = (e) => { e.stopPropagation(); duelsScope = 'all'; persistValue(LS_KEYS.duelsScope, duelsScope); renderMenuBar(); };
                toggle.appendChild(rankedBtn);
                toggle.appendChild(allBtn);

                wrap.appendChild(toggle);
                return wrap;
            }
        });
    }

    if (teamDuelsStats) {
        const t = teamDuelsStats;
        const selectedTeam = t.teams?.find(team => team.id === selectedTeamId) || t.teams?.[0];

        const teamStats = {
            divisionId: null,
            division: null,
            rating: null,
            games: selectedTeam?.gamesPlayed,
            winRate: selectedTeam && selectedTeam.gamesPlayed > 0 ? selectedTeam.gamesWon / selectedTeam.gamesPlayed : null,
        };

        if (selectedTeam) {
            const teamsResponse = await fetch(`/api/ranked-team-duels/me/teams/${selectedTeam.mateId}`, {
                headers: {
                    'x-ncfa-cookie': ncfaCookie
                }
            });
            if (!teamsResponse.ok) {
                throw new Error(`API request failed with status ${teamsResponse.status}`);
            }
            const teamsData = await teamsResponse.json();

            teamStats.divisionId = teamsData.divisionNumber;
            teamStats.division = DIVISION_DATA[teamsData.divisionNumber] || '—';
            teamStats.rating = teamsData.rating;
        }

        cardData.push({
            id: 'teamDuels',
            title: 'Team Duels',
            rows: [
                ['Division', teamStats.division || '—'],
                ['Rating', teamStats.rating != null ? teamStats.rating : '—'],
                ['Games', teamStats.games != null ? teamStats.games : '—'],
                ['Win Rate', formatWinRate(teamStats.winRate)]
            ],
            controls: () => {
                const wrap = document.createElement('div');
                wrap.className = 'controls';
                if (selectedCategory !== 'teamDuels') {
                    wrap.style.display = 'none';
                }

                const select = document.createElement('select');
                (t.teams || []).forEach(team => {
                    const opt = new Option(`${team.name} (${team.division || '—'})`, team.id);
                    opt.addEventListener('click', (e) => e.stopPropagation());

                    if (team.id === selectedTeamId) 
                        opt.selected = true;
                    select.appendChild(opt);
                });

                // TODO: make these options work
                const allRankedOpt = new Option("All Ranked Games", 'all-ranked');
                allRankedOpt.addEventListener('click', (e) => e.stopPropagation());
                if (!selectedTeamId) 
                    allRankedOpt.selected = true;
                select.appendChild(allRankedOpt);

                const allOpt = new Option("All Games", 'all-games');
                allOpt.addEventListener('click', (e) => e.stopPropagation());
                select.appendChild(allOpt);

                select.addEventListener('click', (e) => e.stopPropagation());
                select.onchange = async (e) => {
                    selectedTeamId = e.target.value;
                    persistValue(LS_KEYS.selectedTeamId, selectedTeamId);
                    const selected = (t.teams || []).find(team => team.id === selectedTeamId);
                    if (selected && selected.mateId) {
                        teamMateId = selected.mateId;
                        persistValue(LS_KEYS.teamMateId, teamMateId);
                        statsContentLoading('Recomputing for selected team...');
                        stats = await processGameTokens(game_tokens);
                    }
                    renderMenuBar();
                    refreshDisplays();
                };

                wrap.appendChild(select);
                return wrap;
            }
        });
    };

    if (singleplayerStats) {
        const s = singleplayerStats;
        cardData.push({
            id: 'singleplayer',
            title: 'Singleplayer',
            rows: [
                ['Games', s.games != null ? s.games : '—'],
                ['Avg score', s.averageScore != null ? s.averageScore : '—']
            ]
        });
    }

    cardData.forEach(card => {
        const el = document.createElement('div');
        el.className = `mode-card ${selectedCategory === card.id ? 'active' : ''}`;
        el.onclick = async () => {
            if (selectedCategory !== card.id) {
                selectedCategory = card.id;
                persistValue(LS_KEYS.selectedCategory, selectedCategory);
                renderMenuBar();
                statsContentLoading('Recomputing stats for selected category...');
                stats = await processGameTokens();
                refreshDisplays();
            }
        };
        const title = document.createElement('div');
        title.className = 'card-title';
        title.textContent = card.title;
        el.appendChild(title);

        (card.rows || []).forEach(([label, value]) => {
            const row = document.createElement('div');
            row.className = 'card-row';
            row.innerHTML = `<span>${label}</span><span>${value}</span>`;
            el.appendChild(row);
        });

        if (card.controls) {
            const ctrl = card.controls(card);
            el.appendChild(ctrl);
        }

        cardsEl.appendChild(el);
    });
}

function statsContentLoading(msg) {
    const statsContent = document.getElementById('statsContent');
    if (statsContent) {
        statsContent.textContent = msg;
    }
}

const scoreColorscale = [
    [0, '#f44336'],      
    [0.75, '#ffee53ff'],    
    [0.95, '#88cc8aff'],  
    [1, '#90f3ebff'],
];
const scoreDiffColorscale = [
    [0, '#f44336'],
    [0.45, '#ffd0c8ff'],
    [0.5, '#f9f9f9'],
    [0.55, '#c1f3c0ff'],
    [1, '#4caf50']
];
const rateColorScale = [
    [0, '#f44336'],
    [0.5, '#f9f9f9'],
    [1, '#4caf50']
];
const distanceColorscale = undefined; // TODO

function displayStatsAsList() {
    const statsContent = document.getElementById('statsContent');
    
    if (!stats || !stats[currentMode] || !stats[currentMode].rounds) {
        statsContent.innerHTML = '<p>No data available</p>';
        return;
    }
    
    const { rounds } = getFilteredGameData();
    
    if (rounds.length === 0) {
        statsContent.innerHTML = '<p>No country data available</p>';
        return;
    }
    
    const metric = (document.getElementById('countrylist-metric-select') || { value: 'scoreDiff' }).value;
    const valuesByCountry = {};
    rounds.forEach(round => {
        const cc = round.countryCode;
        if (!valuesByCountry[cc]) valuesByCountry[cc] = [];
        if (metric === 'guessedFirstRate') valuesByCountry[cc].push(round.guessedFirst ? 1 : 0);
        else if (metric === 'score') valuesByCountry[cc].push(round.score);
        else if (metric === 'distance') valuesByCountry[cc].push(round.distance);
        else valuesByCountry[cc].push(round.scoreDiff);
    });

    const countries = Object.keys(valuesByCountry).map(cc => {
        const vals = valuesByCountry[cc];
        let value;
        if (metric === 'guessedFirstRate') {
            const sum = vals.reduce((a, b) => a + b, 0);
            value = vals.length ? (sum / vals.length) : 0;
        } else {
            value = calculateMedian(vals);
        }
        return [cc, value, vals.length];
    }).sort((a, b) => b[1] - a[1]);
    
    const grid = document.createElement('div');
    grid.className = 'stats-grid';
    
    countries.forEach(([countryCode, value, count]) => {
        const isRate = metric === 'guessedFirstRate';
        const numeric = isRate ? value : value;
        const card = document.createElement('div');
        card.className = `country-stat ${(!isRate && numeric > 0) ? 'positive' : (!isRate && numeric < 0) ? 'negative' : ''}`;

        const codeSpan = document.createElement('span');
        codeSpan.className = 'country-code';
        codeSpan.textContent = countryCodeToFlag(countryCode);
        codeSpan.title = getCountryName(countryCode);
        codeSpan.style.cursor = 'help';

        const infoContainer = document.createElement('div');
        infoContainer.style.display = 'flex';
        infoContainer.style.flexDirection = 'column';
        infoContainer.style.alignItems = 'flex-end';

        const scoreSpan = document.createElement('span');
        scoreSpan.className = `score-diff ${(!isRate && numeric > 0) ? 'positive' : (!isRate && numeric < 0) ? 'negative' : ''}`;
        if (isRate) {
            scoreSpan.textContent = `${Math.round(value * 10000) / 100}%`;
        } else {
            scoreSpan.textContent = numeric > 0 ? `+${numeric}` : numeric;
        }

        const countSpan = document.createElement('span');
        countSpan.style.fontSize = '12px';
        countSpan.style.color = '#888';
        countSpan.style.marginTop = '4px';
        countSpan.textContent = `${count} ${count === 1 ? 'location' : 'locations'}`;

        infoContainer.appendChild(scoreSpan);
        infoContainer.appendChild(countSpan);

        card.appendChild(codeSpan);
        card.appendChild(infoContainer);
        grid.appendChild(card);
    });
    
    statsContent.innerHTML = '';
    statsContent.appendChild(grid);
    
    // Add unencountered countries section
    const encounteredCodes = new Set(countries.map(([cc]) => cc));
    const unencounteredCountries = Object.keys(countryData).filter(cldrCode => {
        const country = countryData[cldrCode];
        // Include countries that have Street View (not marked as false) and are not encountered
        return country.hasStreetView !== false && !country.veryLimitedStreetView && !encounteredCodes.has(cldrCode);
    });
    
    if (unencounteredCountries.length > 0) {
        const unencounteredSection = document.createElement('div');
        unencounteredSection.style.marginTop = '30px';
        unencounteredSection.style.padding = '15px';
        unencounteredSection.style.background = '#f5f5f5';
        unencounteredSection.style.borderRadius = '6px';
        
        const heading = document.createElement('h3');
        heading.textContent = 'Countries Not Encountered:';
        heading.style.fontSize = '14px';
        heading.style.marginBottom = '10px';
        heading.style.color = '#666';
        unencounteredSection.appendChild(heading);
        
        const flagContainer = document.createElement('div');
        flagContainer.style.display = 'flex';
        flagContainer.style.flexWrap = 'wrap';
        flagContainer.style.gap = '8px';
        
        unencounteredCountries.forEach(cldrCode => {
            const flagSpan = document.createElement('span');
            flagSpan.textContent = countryCodeToFlag(cldrCode);
            flagSpan.title = getCountryName(cldrCode);
            flagSpan.style.fontSize = '24px';
            flagSpan.style.cursor = 'help';
            flagSpan.style.fontFamily = "'Twemoji Country Flags', 'Apple Color Emoji', sans-serif";
            flagContainer.appendChild(flagSpan);
        });
        
        unencounteredSection.appendChild(flagContainer);
        statsContent.appendChild(unencounteredSection);
    }
}

function displayPerformanceMap() {
    if (!stats || !stats[currentMode] || !stats[currentMode].rounds) {
        console.warn('No stats data available for map');
        return;
    }
    
    const { rounds } = getFilteredGameData();
    
    if (rounds.length === 0) {
        console.warn('No round data available for map');
        return;
    }
    
    const metric = (document.getElementById('map-metric-select') || { value: 'scoreDiff' }).value;

    let zmin;
    let zmax;
    let colorscale; 
    if (metric === 'guessedFirstRate') {
        zmin = 0;
        zmax = 1;
        colorscale = [
            [0, '#f9f9f9'],
            [0.5, '#c1f3c0ff'],
            [1, '#4caf50']
        ];
    } else if (metric === 'score') {
        zmin = 0;
        zmax = 5000;
        colorscale = [
            [0, '#f44336'],      
            [0.75, '#ffee53ff'],    
            [0.95, '#88cc8aff'],  
            [1, '#90f3ebff'],
        ];
    } else if (metric === 'distance') {
    } else {
        zmin = -5000;
        zmax = 5000;
        colorscale = [
            [0, '#f44336'],
            [0.45, '#ffd0c8ff'],
            [0.5, '#f9f9f9'],
            [0.55, '#c1f3c0ff'],
            [1, '#4caf50']
        ];
    }
    
    const valuesByCountry = {};

    rounds.forEach(round => {
        const cc = round.countryCode;
        if (!valuesByCountry[cc]) valuesByCountry[cc] = [];
        if (metric === 'guessedFirstRate') {
            valuesByCountry[cc].push(round.guessedFirst ? 1 : 0);
        } else if (metric === 'score') {
            valuesByCountry[cc].push(round.score);
        } else if (metric === 'distance') {
            valuesByCountry[cc].push(round.distance);
        } else {
            valuesByCountry[cc].push(round.scoreDiff);
        }
    });
    
    // Calculate medians for each country
    const countryCodes = [];
    const countryNames = [];
    const cldrCodes = [];
    const z = [];
    const locationCounts = [];
    const displayValues = [];
    Object.entries(valuesByCountry).forEach(([cldrCode, vals]) => {
        countryCodes.push(getCountryIso3(cldrCode));
        countryNames.push(getCountryName(cldrCode));
        cldrCodes.push(cldrCode);
        locationCounts.push(vals.length);
        if (metric === 'guessedFirstRate') {
            const sum = vals.reduce((a, b) => a + b, 0);
            const rate = vals.length ? (sum / vals.length) : 0;
            z.push(rate);
            displayValues.push(`${Math.round(rate * 10000) / 100}%`);
        } else {
            const med = calculateMedian(vals);
            z.push(med);
            displayValues.push(med);
        }
    });

    const isRate = metric === 'guessedFirstRate';
    let metricTitle = "Score Difference";
    if (metric === 'score') {
        metricTitle = "Score";
    } else if (metric === 'distance') {
        metricTitle = "Distance";
    } else if (metric === 'guessedFirstRate') {
        metricTitle = "Guessed-first rate";
    }

    const data = [{
        type: 'choropleth',
        locations: countryCodes,
        z,
        colorscale,
        colorbar: {
            title: isRate ? 'Guessed-first rate' : `Median ${metric}`
        },
        zmin,
        zmax,
        customdata: countryCodes.map((_, i) => ({
            name: countryNames[i],
            flag: countryCodeToFlag(cldrCodes[i]),
            value: displayValues[i],
            count: locationCounts[i]
        })),
        hovertemplate:
            '<span style="font-family: \'Twemoji Country Flags\', \'Apple Color Emoji\', sans-serif;">%{customdata.flag}</span> %{customdata.name}<br>' +
            `${isRate ? "" : "Median "}${metricTitle}: %{customdata.value}<br>` +
            'Locations: %{customdata.count}' +
            '<extra></extra>',
        hoverinfo: 'text',
        hoverlabel: {
            bgcolor: '#f9f9f9'
        }
    }];
    
    const layout = {
        title: `Performance by Country (${isRate ? 'Guessed-first rate' : 'Median ' + metric})`,
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
    if (!stats || !stats[currentMode] || !stats[currentMode].rounds) {
        console.warn('No stats data available for performance map');
        return;
    }
    
    const { rounds, games, gameIndexMap } = getFilteredGameData();
    
    if (rounds.length === 0) {
        console.warn('No round data available for guesses map');
        return;
    }
    
    const metric = (document.getElementById('guesses-metric-select') || { value: 'score' }).value;

    let colorscale = [
        [0, '#f44336'],      
        [0.75, '#ffeb3b'],    
        [0.95, '#4caf50'],
        [1, '#45e4d6ff'],
    ];
    if (metric === 'scoreDiff') {
        colorscale = [
            [0, '#f44336'],
            [0.4, '#ffeb3b'],
            [0.5, '#4caf50'],
            [0.8, '#6389dbff'],
            [1, '#aa6acfff']
        ];
    } else if (metric === 'distance') {
        colorscale = undefined; // TODO
    }

    const lats = [];
    const lons = [];
    const values = [];
    const hoverTexts = [];

    rounds.forEach(round => {
        lats.push(round.panorama.lat);
        lons.push(round.panorama.lng);
        let val = round.score;
        if (metric === 'scoreDiff') 
            val = round.scoreDiff;
        else if (metric === 'distance') 
            val = round.distance;
        values.push(val);
        const countryFlag = countryCodeToFlag(round.countryCode);
        const countryName = getCountryName(round.countryCode);
        const gameIdx = gameIndexMap ? gameIndexMap[round.game] : round.game;
        const gameTime = gameIdx !== undefined ? games[gameIdx]?.startTime : null;
        hoverTexts.push(`<span style="font-family: 'Twemoji Country Flags', 'Apple Color Emoji', sans-serif;">${countryFlag}</span> ${countryName}<br>Score: ${round.score}<br>Δ Score: ${round.scoreDiff > 0 ? '+' : ''}${round.scoreDiff}<br>${gameTime ? new Date(gameTime).toLocaleDateString() : ''}`);
    });

    values.push(0);
    values.push(5000);
    
    // Create scatter map data
    const data = [{
        type: 'scattergeo',
        lon: lons,
        lat: lats,
        mode: 'markers',
        marker: {
            size: 6,
            color: values,
            colorscale,
            colorbar: {
                title: metric === 'score' ? 'Score' : metric === 'scoreDiff' ? 'Score Diff' : 'Distance'
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
        const round = stats[currentMode].rounds[i];
        console.log('Click round:', round);

        const panoId = round.panorama.panoId;
        const decodedPanoId = String.fromCharCode(...panoId.match(/.{1,2}/g).map(hex => parseInt(hex, 16)));
        const svUrl = `https://www.google.com/maps/@-4.2267238,-73.4826543,3a,75y,285.31h,90t/data=!3m7!1e1!3m5!1s${decodedPanoId}!2e0!6shttps:%2F%2Fstreetviewpixels-pa.googleapis.com%2Fv1%2Fthumbnail%3Fcb_client%3Dmaps_sv.tactile!7i13312!8i6656`
        window.open(svUrl, '_blank');
    });
}

function displayBoxplot() {
    if (!stats || !stats[currentMode] || !stats[currentMode].rounds) {
        console.warn('No stats data available for boxplot');
        return;
    }
    
    const { rounds } = getFilteredGameData();
    
    if (rounds.length === 0) {
        console.warn('No round data available for boxplot');
        return;
    }
    
    const metric = (document.getElementById('boxplot-metric-select') || { value: 'scoreDiff' }).value;

    let ymin;
    let ymax;
    if (metric === 'score') {
        ymin = 0;
        ymax = 5000;
    } else if (metric === 'distance') {
    } else {
        ymin = -5000;
        ymax = 5000;
    }
    const addToRange = (ymax - ymin) * 0.05;

    const valuesByCountry = {};
    rounds.forEach(round => {
        const cc = round.countryCode;
        if (!valuesByCountry[cc]) 
            valuesByCountry[cc] = [];

        if (metric === 'score') 
            valuesByCountry[cc].push(round.score);
        else if (metric === 'distance') 
            valuesByCountry[cc].push(round.distance);
        else 
            valuesByCountry[cc].push(round.scoreDiff);
    });

    const countriesWithStats = Object.keys(valuesByCountry).map(cc => {
        const values = valuesByCountry[cc];
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 === 0 
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];

        let q1, q3;
        if (sorted.length >= 4) {
            const lowerHalf = sorted.slice(0, mid);
            const upperHalf = sorted.length % 2 === 0 ? sorted.slice(mid) : sorted.slice(mid + 1);
            const midLower = Math.floor(lowerHalf.length / 2);
            const midUpper = Math.floor(upperHalf.length / 2);
            q1 = lowerHalf.length % 2 === 0
                ? (lowerHalf[midLower - 1] + lowerHalf[midLower]) / 2
                : lowerHalf[midLower];
            q3 = upperHalf.length % 2 === 0
                ? (upperHalf[midUpper - 1] + upperHalf[midUpper]) / 2
                : upperHalf[midUpper];

            if (sorted.length % 2 === 1) {
                const lowerHalfIncl = sorted.slice(0, mid + 1);
                const upperHalfIncl = sorted.slice(mid);
                const midLowerIncl = Math.floor(lowerHalfIncl.length / 2);
                const midUpperIncl = Math.floor(upperHalfIncl.length / 2);
                const q1Incl = lowerHalfIncl.length % 2 === 0
                    ? (lowerHalfIncl[midLowerIncl - 1] + lowerHalfIncl[midLowerIncl]) / 2
                    : lowerHalfIncl[midLowerIncl];
                const q3Incl = upperHalfIncl.length % 2 === 0
                    ? (upperHalfIncl[midUpperIncl - 1] + upperHalfIncl[midUpperIncl]) / 2
                    : upperHalfIncl[midUpperIncl];
                q1 = (q1 + q1Incl) / 2;
                q3 = (q3 + q3Incl) / 2;
            }
        } else {
            q1 = sorted[0];
            q3 = sorted[sorted.length - 1];
        }

        const iqr = q3 - q1;

        /*let whiskerLow = q1 - 1.5 * iqr;
        let whiskerHigh = q3 + 1.5 * iqr;

        for (let v of sorted) {
            if (v >= whiskerLow) {
                whiskerLow = v;
                break;
            }
        }

        for (let i = sorted.length - 1; i >= 0; i--) {
            const v = sorted[i];
            if (v <= whiskerHigh) {
                whiskerHigh = v;
                break;
            }
        }*/

        const minVal = sorted[0];
        const maxVal = sorted[sorted.length - 1];

        return { 
            country: cc, 
            values, 
            median, 
            //q1, 
            //q3, 
            iqr,
            //whiskerLow,
            //whiskerHigh,
            minVal,
            maxVal
        };
    });
    
    // Sort by median (descending)
    countriesWithStats.sort((a, b) => b.median - a.median);
    
    // Prepare data for boxplot
    const traces = countriesWithStats.map((item, index) => {
        const countryFlag = countryCodeToFlag(item.country);
        const countryName = getCountryName(item.country);
        return {
            y: item.values,
            type: 'box',
            name: countryFlag,
            hovertemplate: 
                '<b style="font-family: \'Twemoji Country Flags\', \'Apple Color Emoji\', sans-serif;">%{customdata.countryFlag}</b>&nbsp;' +
                '<b>%{customdata.countryName}</b><br>' +
                `${metric === 'score' ? 'Score' : 'Δ Score'}: %{y}<br>` +
                '<extra></extra>',
            boxmean: false,
            customdata: item.values.map(() => ({
                countryFlag: countryFlag,
                countryName: countryName
            })),
            marker: {
                color: '#4caf50'
            }
        };
    });
    
    // Create bar trace for custom hover data
    const barTraceData = countriesWithStats.map((item, index) => {
        const countryFlag = countryCodeToFlag(item.country);
        const countryName = getCountryName(item.country);
        
        return {
            x: "country",
            countryFlag: countryFlag,
            countryName: countryName,
            median: item.median,
            //q1: item.q1,
            //q3: item.q3,
            iqr: item.iqr,
            //whiskerLow: item.whiskerLow,
            //whiskerHigh: item.whiskerHigh,
            minVal: item.minVal,
            maxVal: item.maxVal,
            count: item.values.length
        };
    });
    
    // Add invisible bar trace with custom hover
    traces.push({
        x: barTraceData.map(d => d.countryFlag),
        y: barTraceData.map(d => d.maxVal - d.minVal < 2 * addToRange ? d.maxVal - d.minVal + 2 * addToRange : d.maxVal - d.minVal),
        width: 1,
        base: barTraceData.map(d => d.maxVal - d.minVal < 2 * addToRange ? d.minVal - addToRange : d.minVal),
        type: 'bar',
        opacity: 0,
        hovertemplate: 
            '<b style="font-family: \'Twemoji Country Flags\', \'Apple Color Emoji\', sans-serif;">%{customdata.countryFlag}</b>&nbsp;' +
            '<b>%{customdata.countryName}</b><br>' +
            'Median: %{customdata.median:.0f}<br>' +
            'IQR: %{customdata.iqr:.0f}<br>' +
            'Locations: %{customdata.count}<br>' +
            '<extra></extra>',
        customdata: barTraceData.map(d => ({
            countryFlag: d.countryFlag,
            countryName: d.countryName,
            median: d.median,
            iqr: d.iqr,
            count: d.count
        })),
        marker: {
            color: '#4caf50'
        },
        showlegend: false
    });
    
    // Show only a subset of countries at once (20 countries)
    const visibleCountries = 20;
    const totalCountries = traces.length;
    
    const layout = {
        title: `${metric === 'score' ? 'Score' : 'Score Difference'} Difference Distribution by Country`,
        yaxis: {
            title: metric === 'score' ? 'Score' : 'Score Difference',
            range: [ymin - addToRange, ymax + addToRange],
            dtick: 1000,
            zeroline: true,
            zerolinecolor: '#666',
            zerolinewidth: 2
        },
        xaxis: {
            title: 'Country',
            range: [-0.5, Math.min(visibleCountries - 0.5, totalCountries - 0.5)],
            rangeslider: { visible: true },
            tickfont: {
                family: 'Twemoji Country Flags, Apple Color Emoji, sans-serif',
                size: 20
            }
        },
        showlegend: false,
        height: 700,
        margin: { t: 50, b: 150 }
    };
    
    const config = {
        responsive: true,
        scrollZoom: true
    };
    
    Plotly.newPlot('boxplot', traces, layout, config);
}

function linearRegression(xs, ys) {
    const n = xs.length;
    if (n === 0) return null;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
        const x = xs[i];
        const y = ys[i];
        sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
    }
    const denom = (n * sumXX - sumX * sumX);
    if (denom === 0) return null;
    const a = (n * sumXY - sumX * sumY) / denom; // slope
    const b = (sumY - a * sumX) / n; // intercept
    return { a, b };
}

// Calculate monthly medians for evolution graph
function calculateMonthlyMedians(xs, ys, minDataPoints = 3) {
    if (xs.length === 0) return { monthStarts: [], medians: [], counts: [] };
    
    const monthMap = {}; // key: "YYYY-MM" -> {values, dates}
    
    for (let i = 0; i < xs.length; i++) {
        const date = new Date(xs[i]);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const key = `${year}-${month}`;
        
        if (!monthMap[key]) monthMap[key] = { values: [], dates: [] };
        monthMap[key].values.push(ys[i]);
        monthMap[key].dates.push(xs[i]);
    }
    
    // Sort by month key
    const sortedKeys = Object.keys(monthMap).sort();
    
    // First pass: identify which months have enough data points
    const monthsWithData = {};
    sortedKeys.forEach(key => {
        const dataCount = monthMap[key].values.length;
        monthsWithData[key] = dataCount >= minDataPoints;
    });
    
    // Second pass: group months with too few data points with adjacent months
    const groupedMonths = [];
    let currentGroup = [];
    
    sortedKeys.forEach((key, idx) => {
        currentGroup.push(key);
        
        // Check if this month or the next month has enough data
        const hasEnoughData = monthsWithData[key];
        const nextKeyHasData = idx < sortedKeys.length - 1 && monthsWithData[sortedKeys[idx + 1]];
        
        if (hasEnoughData || !nextKeyHasData || idx === sortedKeys.length - 1) {
            // End of group: either this month has data, or next month doesn't have data, or it's the last month
            groupedMonths.push([...currentGroup]);
            currentGroup = [];
        }
    });
    
    // Third pass: calculate medians for each group, using the median value's actual date as x
    const monthStarts = [];
    const medians = [];
    const counts = [];
    
    groupedMonths.forEach((group, groupIdx) => {
        // Combine all values and dates from the group
        let allValues = [];
        let allDates = [];
        group.forEach(key => {
            allValues = allValues.concat(monthMap[key].values);
            allDates = allDates.concat(monthMap[key].dates);
        });
        
        if (allValues.length < minDataPoints) return;
        
        // Calculate median
        const sorted = allValues.sort((a, b) => a - b);
        const medianIdx = Math.floor(allValues.length / 2);
        const median = sorted.length % 2 === 0 
            ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
            : sorted[medianIdx];
        
        // Find the date of the median value in the original data
        let medianDate;
        if (sorted.length % 2 === 0) {
            // For even-length arrays, use the average of the two middle values' dates
            const lowerIdx = allValues.indexOf(sorted[sorted.length / 2 - 1]);
            const upperIdx = allValues.indexOf(sorted[sorted.length / 2]);
            medianDate = (allDates[lowerIdx] + allDates[upperIdx]) / 2;
        } else {
            // For odd-length arrays, use the median value's date
            const medianValueIdx = allValues.indexOf(sorted[medianIdx]);
            medianDate = allDates[medianValueIdx];
        }
        
        monthStarts.push(medianDate);
        counts.push(allValues.length);
        medians.push(median);
    });
    
    // Override first and last timestamps with earliest and latest from entire dataset
    if (monthStarts.length > 0) {
        monthStarts[0] = xs[0]; // First timestamp in entire dataset
        monthStarts[monthStarts.length - 1] = xs[xs.length - 1]; // Last timestamp in entire dataset
    }
    
    return { monthStarts, medians, counts };
}

// Catmull-Rom spline interpolation
function splineInterpolate(xs, ys, resolution = 100) {
    if (xs.length < 2) return { x: xs, y: ys, derivs: [0] };
    
    // For Catmull-Rom, we need at least 4 points, so we'll handle edge cases
    const points = xs.map((x, i) => ({ x, y: ys[i] }));
    const result = { x: [], y: [], derivs: [] };
    
    // Helper to compute Catmull-Rom derivative at parameter t
    function catmullRomDerivative(p0y, p1y, p2y, p3y, t) {
        const t2 = t * t;
        return 0.5 * (
            (-p0y + p2y) +
            2 * (2 * p0y - 5 * p1y + 4 * p2y - p3y) * t +
            3 * (-p0y + 3 * p1y - 3 * p2y + p3y) * t2
        );
    }
    
    // Store derivatives at each control point for extrapolation
    const pointDerivs = [];
    for (let i = 0; i < xs.length; i++) {
        const p0 = i === 0 ? points[0] : points[i - 1];
        const p1 = points[i];
        const p2 = i === xs.length - 1 ? points[i] : points[i + 1];
        const p3 = i < xs.length - 2 ? points[i + 2] : points[i];
        
        // Approximate derivative at this point (derivative at t=0 for the next segment)
        let deriv;
        if (i === 0) {
            // At first point, estimate from first two points
            deriv = (ys[1] - ys[0]) / (xs[1] - xs[0]);
        } else if (i === xs.length - 1) {
            // At last point, use derivative from previous segment at t=1
            const prevP0 = i < 2 ? points[0] : points[i - 2];
            const prevP1 = points[i - 1];
            const prevP2 = points[i];
            const prevP3 = points[i]; // boundary
            const dxdt = (prevP2.x - prevP1.x); // assuming unit parameter
            const dydt = catmullRomDerivative(prevP0.y, prevP1.y, prevP2.y, prevP3.y, 1.0);
            deriv = dydt / dxdt;
        } else {
            // At intermediate points, use centered difference
            deriv = (ys[i + 1] - ys[i - 1]) / (xs[i + 1] - xs[i - 1]);
        }
        pointDerivs.push(deriv);
    }
    
    // Add points along the spline with higher resolution
    for (let i = 0; i < xs.length - 1; i++) {
        // Use Catmull-Rom with extended boundaries for first/last segments
        const p0 = i === 0 ? points[0] : points[i - 1];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = i === xs.length - 2 ? points[i + 1] : points[i + 2];
        
        for (let t = 0; t < 1; t += 1 / resolution) {
            const t2 = t * t;
            const t3 = t2 * t;
            
            // Catmull-Rom basis functions
            const q = 0.5 * (
                (2 * p1.y) +
                (-p0.y + p2.y) * t +
                (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
                (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
            );
            
            // Linear interpolation for x (time)
            const x = p1.x + (p2.x - p1.x) * t;
            
            result.x.push(x);
            result.y.push(q);
        }
    }
    
    // Add the last point
    result.x.push(xs[xs.length - 1]);
    result.y.push(ys[ys.length - 1]);
    result.derivs = pointDerivs;
    
    return result;
}

// Estimate second derivative using finite differences
function estimateSecondDerivative(xs, ys, index) {
    if (index <= 0 || index >= xs.length - 1) return 0;
    const h1 = xs[index] - xs[index - 1];
    const h2 = xs[index + 1] - xs[index];
    const y_prev = ys[index - 1];
    const y_curr = ys[index];
    const y_next = ys[index + 1];
    return 2 * ((y_next - y_curr) / h2 - (y_curr - y_prev) / h1) / (h1 + h2);
}

function displayEvolutionGraph() {
    const chartEl = document.getElementById('evolutionChart');
    if (!chartEl) return;
    if (!stats || !stats[currentMode] || !stats[currentMode].rounds) {
        chartEl.innerHTML = '<p>No data available</p>';
        return;
    }

    const { rounds, games, gameIndexMap } = getFilteredGameData();
    if (!rounds.length) {
        chartEl.innerHTML = '<p>No data available</p>';
        return;
    }

    const metric = (document.getElementById('evolution-metric-select') || { value: 'scoreDiff' }).value;
    const country = selectedEvolutionCountry || 'world';

    // Build series
    const xs = [];
    const ys = [];
    const texts = [];
    for (const r of rounds) {
        if (country !== 'world' && r.countryCode !== country) continue;
        const gameIdx = gameIndexMap ? gameIndexMap[r.game] : r.game;
        const game = gameIdx !== undefined ? games[gameIdx] : null;
        const t = game?.startTime ? new Date(game.startTime).getTime() : null;
        if (!t) continue;
        xs.push(t);
        ys.push(metric === 'score' ? r.score : r.scoreDiff);
        const flag = countryCodeToFlag(r.countryCode);
        const name = getCountryName(r.countryCode);
        const dateStr = game?.startTime ? new Date(game.startTime).toLocaleDateString() : '';
        texts.push(`<span style="font-family: 'Twemoji Country Flags','Apple Color Emoji',sans-serif;">${flag}</span> ${name}<br>${metric === 'score' ? 'Score' : 'Δ Score'}: ${metric === 'score' ? r.score : (r.scoreDiff > 0 ? '+' : '') + r.scoreDiff}<br>${dateStr}`);
    }

    // Sort by time
    const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
    const xSorted = idx.map(i => xs[i]);
    const ySorted = idx.map(i => ys[i]);
    const textSorted = idx.map(i => texts[i]);

    // Calculate monthly medians
    const { monthStarts, medians } = calculateMonthlyMedians(xSorted, ySorted);
    
    let trendTrace = null;
    if (monthStarts.length > 0) {
        // Spline interpolation through monthly medians
        const splineData = splineInterpolate(monthStarts, medians, 150);
        
        // Extend spline backwards to first datapoint
        const firstDate = new Date(xSorted[0]);
        const lastDate = new Date(xSorted[xSorted.length - 1]);
        const firstMonth = new Date(monthStarts[0]);
        const lastMonth = new Date(monthStarts[monthStarts.length - 1]);
        
        // Prepend points from first datapoint to first month start
        if (firstDate < firstMonth) {
            const slope = (medians[0] - splineData.y[0]) / (monthStarts[0] - splineData.x[0]);
            const extendedX = [];
            const extendedY = [];
            const steps = 50;
            for (let i = steps - 1; i >= 0; i--) {
                const t = i / steps;
                const x = xSorted[0] + (monthStarts[0] - xSorted[0]) * t;
                const y = medians[0] - slope * (monthStarts[0] - x);
                extendedX.push(x);
                extendedY.push(y);
            }
            splineData.x = [...extendedX, ...splineData.x];
            splineData.y = [...extendedY, ...splineData.y];
        }
        
        // Append points from last month to present (last datapoint)
        if (lastDate > lastMonth) {
            const slope = (splineData.y[splineData.y.length - 1] - medians[medians.length - 1]) / 
                         (splineData.x[splineData.x.length - 1] - monthStarts[monthStarts.length - 1]);
            const steps = 50;
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                const x = lastMonth.getTime() + (lastDate.getTime() - lastMonth.getTime()) * t;
                const y = medians[medians.length - 1] + slope * (x - monthStarts[monthStarts.length - 1]);
                splineData.x.push(x);
                splineData.y.push(y);
            }
        }
        
        trendTrace = {
            x: splineData.x.map(ms => new Date(ms)),
            y: splineData.y,
            type: 'scatter',
            mode: 'lines',
            name: 'Trend', // (monthly medians)
            line: { color: '#2f7a34', width: 2 },
            hoverinfo: 'skip'
        };
    }
    if (xSorted.length > 0 && medians.length < 2) {
        // Not enough data for monthly medians, draw straight line at overall median
        const sortedValues = [...ySorted].sort((a, b) => a - b);
        const overallMedian = sortedValues.length % 2 === 0 
            ? (sortedValues[sortedValues.length / 2 - 1] + sortedValues[sortedValues.length / 2]) / 2
            : sortedValues[Math.floor(sortedValues.length / 2)];
        
        trendTrace = {
            x: [new Date(xSorted[0]), new Date(xSorted[xSorted.length - 1])],
            y: [overallMedian, overallMedian],
            type: 'scatter',
            mode: 'lines',
            name: 'Trend', // (overall median)
            line: { color: '#2f7a34', width: 2 },
            hoverinfo: 'skip'
        };
    }

    const pointTrace = {
        x: xSorted.map(ms => new Date(ms)),
        y: ySorted,
        type: 'scatter',
        mode: 'markers',
        name: 'Rounds',
        marker: { size: 5, color: '#6389db', opacity: 0.6 },
        text: textSorted,
        hoverinfo: 'text'
    };
    
    const monthMedianTrace = {
        x: monthStarts.map(ms => new Date(ms)),
        y: medians,
        type: 'scatter',
        mode: 'markers',
        name: 'Monthly medians',
        marker: { size: 8, color: '#f57c00', symbol: 'diamond' },
        hoverinfo: 'y+x'
    };

    const metricName = metric === 'score' ? 'Score' : 'Score Difference';
    const titleSuffix = country === 'world' ? 'Worldwide' : getCountryName(country);
    const layout = {
        title: `${metricName} over time — ${titleSuffix}`,
        xaxis: { title: 'Date', type: 'date' },
        yaxis: { 
            title: metricName,
            range: metric === 'score' ? [0, 5025] : [-5050, 5050],
            dtick: 1000,
            zeroline: true,
            zerolinecolor: '#666',
            zerolinewidth: 2
        },
        height: 500,
        margin: { l: 50, r: 10, t: 50, b: 50 }
    };
    const data = trendTrace ? [pointTrace, trendTrace] : [pointTrace];
    //data.push(monthMedianTrace); // for debugging
    Plotly.newPlot('evolutionChart', data, layout, { responsive: true });
}
