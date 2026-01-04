const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));


// Proxy endpoint for fetching game data
app.get('/api/duels/:token', async (req, res) => {
    const { token } = req.params;
    const BASE_URL_GAME_SERVER = "https://game-server.geoguessr.com/api";
    
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
        res.json(data);
    } catch (error) {
        console.error('Error fetching game data:', error);
        res.status(500).json({ error: 'Internal server error', message: error.message });
    }
});

// Proxy endpoint for fetching feed/private
app.get('/api/feed/private', async (req, res) => {
    const BASE_URL_V4 = "https://www.geoguessr.com/api/v4";
    const paginationToken = req.query.paginationToken;
    
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

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
