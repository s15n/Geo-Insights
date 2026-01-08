const BASE_URL = "http://localhost:3000"

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

// Current mode state
let currentMode = 'moving';

let game_tokens = [];
let stats = null;

let countryData = {}; // Maps CLDR country code to {name, iso3166Alpha3}
let profileSummary = null;
let overviewStats = null;
let selectedCategory = 'teamDuels';
let selectedTeamId = null;
let duelsScope = 'ranked'; // ranked | all

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
    metric_countrylist: 'ls_metric_countrylist'
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

    createMetricSelector('.stats-container:nth-of-type(1)', 'map-metric-select', true);
    createMetricSelector('.stats-container:nth-of-type(2)', 'guesses-metric-select', false, 'score');
    createMetricSelector('.stats-container:nth-of-type(3)', 'boxplot-metric-select', false);
    createMetricSelector('.stats-container:nth-of-type(4)', 'countrylist-metric-select', true);
});

function refreshDisplays() {
    // Update title
    const listTitle = document.getElementById('listTitle');
    const boxplotTitle = document.getElementById('boxplotTitle');

    const metric = (document.getElementById('countrylist-metric-select') || { value: 'scoreDiff' }).value;
    let metricName = 'Score Difference';
    if (metric === 'guessedFirstRate') 
        metricName = 'Guessed-First Rate';
    else if (metric === 'score') 
        metricName = 'Score';
    else if (metric === 'distance') 
        metricName = 'Distance';

    if (listTitle) {
        listTitle.textContent = `${metric !== "guessedFirstRate" ? "Median " : ""}${metricName} Per Country`;
    }
    if (boxplotTitle) {
        boxplotTitle.textContent = `${metricName} by Country (Boxplot)`;
    }
    
    displayPerformanceMap();
    displayGuessesMap();
    displayBoxplot();
    displayStatsAsList();
}

async function fetchGameTokens() {
    console.log("Fetching game tokens...");
    
    const tokens = {
        "singlePlayer": [],
        "soloDuels": [],
        "teamDuels": [],
        "otherGames": [],
    };

    try {
        let paginationToken = null;
        
        while (true) {
            // TODO: Can see statistics of friends as well, using /friends instead of /private
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
                        tokens.singlePlayer.push({
                            token: payload.gameToken,
                            type: entryType,
                            mode: payload.gameMode,
                        });
                    } else if (entryType === 2) { // Challenge
                        // mapSlug, mapName, points, challengeToken, gameMode, isDailyChallenge
                        tokens.singlePlayer.push({
                            token: payload.challengeToken,
                            type: entryType,
                            mode: payload.gameMode,
                            dailyChallenge: payload.isDailyChallenge || false,
                        });
                    } else if (entryType === 6) { // Team duel
                        // gameId, gameMode, competitiveGameMode
                        tokens.teamDuels.push(payload.gameId);
                    } else {
                        // 4 = Achievement Unlocked
                        // 9 = Party Game: gameId, partyId, gameMode
                        // 11 = Unranked Duel: gameId, gameMode, competitiveGameMode
                        tokens.otherGames.push({
                            type: entryType,
                            payload: payload,
                        });
                    }
                }
            }
            addEntries(data.entries);
            
            paginationToken = data.paginationToken;
            if (!paginationToken)
                break;
        }
        
        console.log(`Fetched ${tokens.length} game tokens`);
    } catch (error) {
        console.error('Error fetching game tokens:', error);
    }
    try {
        backupFetchedGameTokens(tokens);
    } catch (e) {
        console.warn('Error backing up tokens:', e);
    }
    return tokens;
}

// Backup fetched game tokens in browser localStorage for recovery
function backupFetchedGameTokens(tokens) {
    try {
        localStorage.setItem('backup_game_tokens', JSON.stringify(tokens));
    } catch (err) {
        console.warn('Failed to backup fetched game tokens to localStorage', err);
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
            
            const duelHeaders = {
                'x-ncfa-cookie': ncfaCookie
            };
            if (isBackupEnabled()) duelHeaders['x-backup'] = '1';
            const response = await fetch(`${BASE_URL}/api/duels/${token}`, {
                headers: duelHeaders
            });
            const game = await response.json();
            console.log(game);
            
            const gameMode = getGameMode(game);
            const modeStats = stats[gameMode];
            
            /*
            Not needed for now
            const ranked = game.options.isRated; // should always be true
            const isTeamDuels = game.options.isTeamDuels; // should always be true
            const initialHealth = game.options.initialHealth; // should always be 6000
            */

            // TODO: select by team instead of player ID
            const ownTeamIndex = game.teams.findIndex(team => team.players.some(player => player.playerId === ownPlayerId));

            if (ownTeamIndex !== 0 && ownTeamIndex !== 1) {
                console.warn(`Own player not found in game ${token}`);
                continue;
            }

            const ownTeam = game.teams[ownTeamIndex];
            const opponentTeam = game.teams[1 - ownTeamIndex];

            const hasSelectedTeamMate = ownTeam.players.findIndex(player => player.playerId === teamMateId) !== -1;
            if (!hasSelectedTeamMate) {
                console.warn(`Team mate not found in own team for game ${token}`);
                continue;
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

(async () => {
    if (loadSavedTokens) {
        game_tokens = await fetch('tokens.json').then(res => res.json());
        game_tokens = game_tokens.teamDuels; // TODO
        console.log(game_tokens.length, "game tokens loaded");
    } else {
        game_tokens = await fetchGameTokens();
        game_tokens = game_tokens.teamDuels; // TODO
        console.log('Game tokens fetched:', game_tokens);
    }

    countryData = await fetch('countries.json').then(res => res.json());
    await loadMenuData();

    if (loadSavedStats) {
        stats = await fetch('stats.json').then(res => res.json());
        console.log('Data loaded from save:', stats);
    } else {
        stats = await processGameTokens(game_tokens);
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
    try {
        const [profile, overview] = await Promise.all([
            fetch('/api/mock/profile').then(r => r.json()),
            fetch('/api/mock/overview').then(r => r.json())
        ]);
        profileSummary = profile;
        overviewStats = overview;
        if (profileSummary?.userId) {
            ownPlayerId = profileSummary.userId;
            persistValue(LS_KEYS.ownPlayerId, ownPlayerId);
        }

        selectedTeamId = overviewStats?.teamDuels?.defaultTeamId || overviewStats?.teamDuels?.teams?.[0]?.id || selectedTeamId;
        if (selectedTeamId) persistValue(LS_KEYS.selectedTeamId, selectedTeamId);
        if (!teamMateId && selectedTeamId) {
            const t = overviewStats?.teamDuels?.teams?.find(team => team.id === selectedTeamId);
            if (t?.mateId) {
                teamMateId = t.mateId;
                persistValue(LS_KEYS.teamMateId, teamMateId);
            }
        }
        renderMenuBar();
    } catch (e) {
        console.warn('Failed to load menu data', e);
    }
}

function formatWinRate(rate) {
    if (rate === null || rate === undefined || Number.isNaN(rate)) return '—';
    return `${Math.round(rate * 1000) / 10}%`;
}

function renderMenuBar() {
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

    cardsEl.innerHTML = '';
    const cardData = [];
    if (overviewStats?.duels) {
        const d = overviewStats.duels;
        cardData.push({
            id: 'duels',
            title: 'Duels',
            rows: [
                ['Division', d.division || '—'],
                ['Rating', d.rating != null ? d.rating : '—'],
                ['Best', d.bestRating != null ? d.bestRating : '—'],
                ['Games', d.games != null ? d.games : '—'],
                ['Win rate', formatWinRate(d.winRate)]
            ],
            controls: (card) => {
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

    if (overviewStats?.teamDuels) {
        const t = overviewStats.teamDuels;
        const selectedTeam = t.teams?.find(team => team.id === selectedTeamId) || t.teams?.[0];
        cardData.push({
            id: 'teamDuels',
            title: 'Team Duels',
            rows: [
                ['Division', selectedTeam?.division || '—'],
                ['Rating', selectedTeam?.rating != null ? selectedTeam.rating : '—'],
                ['Best', selectedTeam?.bestRating != null ? selectedTeam.bestRating : '—'],
                ['Games', selectedTeam?.games != null ? selectedTeam.games : '—'],
                ['Win rate', formatWinRate(selectedTeam?.winRate)]
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
    }

    if (overviewStats?.singleplayer) {
        const s = overviewStats.singleplayer;
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
            selectedCategory = card.id;
            persistValue(LS_KEYS.selectedCategory, selectedCategory);
            renderMenuBar();
            if (card.id === 'teamDuels') {
                // Already handled via dropdown change if needed
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
    
    const rounds = stats[currentMode].rounds;
    
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
    
    const rounds = stats[currentMode].rounds;
    
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
            `${metricTitle}: %{customdata.value}<br>` +
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
    
    const rounds = stats[currentMode].rounds;
    
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
        hoverTexts.push(`<span style="font-family: 'Twemoji Country Flags', 'Apple Color Emoji', sans-serif;">${countryFlag}</span> ${countryName}<br>Score: ${round.score}<br>Δ Score: ${round.scoreDiff > 0 ? '+' : ''}${round.scoreDiff}<br>${new Date(stats[currentMode].games[round.game]?.startTime).toLocaleDateString()}`);
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
    
    const rounds = stats[currentMode].rounds;
    
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

    const countriesWithMedian = Object.keys(valuesByCountry).map(cc => {
        const values = valuesByCountry[cc];
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 === 0 
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
        return { country: cc, median: median, values: values };
    });
    
    // Sort by median (descending)
    countriesWithMedian.sort((a, b) => b.median - a.median);
    
    // Prepare data for boxplot
    const traces = countriesWithMedian.map(item => {
        const countryFlag = countryCodeToFlag(item.country);
        const countryName = getCountryName(item.country);
        return {
            y: item.values,
            type: 'box',
            name: countryFlag,
            customdata: item.values.map(() => ({
                country: item.country,
                countryFlag: countryFlag,
                countryName: countryName,
                median: item.median,
                count: item.values.length
            })),
            hovertemplate: 
                '<b style="font-family: \'Twemoji Country Flags\', \'Apple Color Emoji\', sans-serif;">%{customdata.countryFlag}</b>&nbsp;' +
                '<b>%{customdata.countryName}</b><br>' +
                'Score Difference: %{y}<br>' +
                '<extra></extra>',
            boxmean: false,
            marker: {
                color: '#4caf50'
            }
        };
    });
    // TODO: better labels for the boxes, not just the outliers
    
    // Show only a subset of countries at once (20 countries)
    const visibleCountries = 20;
    const totalCountries = traces.length;
    
    const layout = {
        title: 'Score Difference Distribution by Country (Sorted by Median)',
        yaxis: {
            title: 'Score Difference',
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
