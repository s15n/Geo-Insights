const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = 3000;

const BACKUPS_DUELS_DIR = path.join(__dirname, 'backups', 'duels');

// Ensure backups directory exists at startup to avoid mkdir on every request
fs.mkdir(BACKUPS_DUELS_DIR, { recursive: true }).catch(err => {
    console.error('Failed to ensure backups directory exists:', err);
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));


// Proxy endpoint for fetching game data
app.get('/api/duels/:token', async (req, res) => {
    const { token } = req.params;
    const ncfa_cookie = req.headers['x-ncfa-cookie'];
    const backupHeader = req.headers['x-backup'];
    const BASE_URL_GAME_SERVER = "https://game-server.geoguessr.com/api";
    
    if (!ncfa_cookie) {
        return res.status(400).json({ error: 'Missing ncfa cookie' });
    }

    /*
    The backups are done to
    a) reduce load on the GeoGuessr servers
    b) be able to serve data even if GeoGuessr is down
    c) be able to analyze historical data (> 1 year old games are not available on GeoGuessr)
    */

    // Prefer local backup if available to avoid unnecessary API calls
    try {
        const safeToken = token.replace(/[^a-zA-Z0-9_-]/g, '_');
        const backupPath = path.join(BACKUPS_DUELS_DIR, `${safeToken}.json`);
        const contents = await fs.readFile(backupPath, 'utf8');
        try {
            const parsed = JSON.parse(contents);
            return res.json(parsed);
        } catch (parseErr) {
            console.error('Failed to parse backup JSON for token', token, parseErr);
            // fall through to fetch fresh copy
        }
    } catch (readErr) {
        if (readErr.code !== 'ENOENT') {
            console.error('Error reading backup file for token', token, readErr);
        }
        // If file doesn't exist, continue to fetch from API
    }
    
    try {
        const response = await fetch(`${BASE_URL_GAME_SERVER}/duels/${token}`, {
            headers: {
                'Cookie': `_ncfa=${ncfa_cookie}`
            }
        });
        
        if (!response.ok) {
            return res.status(response.status).json({ error: 'Failed to fetch game data' });
        }
        
        const data = await response.json();
        if (backupHeader) {
            try {
                const safeToken = token.replace(/[^a-zA-Z0-9_-]/g, '_');
                const filePath = path.join(BACKUPS_DUELS_DIR, `${safeToken}.json`);
                await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
            } catch (err) {
                console.error('Failed to write duel backup for token', token, err);
            }
        }
        res.json(data);
    } catch (error) {
        console.error('Error fetching game data:', error);
        res.status(500).json({ error: 'Internal server error', message: error.message });
    }
});

// Proxy endpoint for fetching feed/private
app.get('/api/feed/private', async (req, res) => {
    const ncfa_cookie = req.headers['x-ncfa-cookie'];
    const BASE_URL_V4 = "https://www.geoguessr.com/api/v4";
    const paginationToken = req.query.paginationToken;
    
    if (!ncfa_cookie) {
        return res.status(400).json({ error: 'Missing ncfa cookie' });
    }
    
    try {
        const url = new URL(`${BASE_URL_V4}/feed/private`);
        if (paginationToken) {
            url.searchParams.append('paginationToken', paginationToken);
        }
        
        const response = await fetch(url, {
            headers: {
                'Cookie': `_ncfa=${ncfa_cookie}`
            }
        });
        
        if (!response.ok) {
            return res.status(response.status).json({ error: 'Failed to fetch feed data' });
        }
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Error fetching feed data:', error);
        res.status(500).json({ error: 'Internal server error', message: error.message });
    }
});

// Serve login page
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
