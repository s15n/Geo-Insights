async function relayGetJSON(url, ncfaCookie) {
    if (!ncfaCookie) {
        const err = new Error('Missing ncfa cookie');
        err.status = 400;
        throw err;
    }

    const response = await fetch(url, {
        headers: {
            'Cookie': `_ncfa=${ncfaCookie}`
        }
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        const err = new Error('Upstream request failed');
        err.status = response.status;
        err.body = text;
        throw err;
    }

    return response.json();
}

module.exports = {
    relayGetJSON
};
