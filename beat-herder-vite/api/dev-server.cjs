const http = require('http');
const path = require('path');
const fs = require('fs');

// Try to load .env manually if dotenv isn't available
function loadEnv() {
    const envFiles = ['.env', '.env.local'];
    envFiles.forEach(file => {
        const envPath = path.resolve(__dirname, `../${file}`);
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf8');
            content.split('\n').forEach(line => {
                const match = line.match(/^([^=]+)=(.*)$/);
                if (match) {
                    const key = match[1].trim();
                    const value = match[2].trim().replace(/^["']|["']$/g, '');
                    if (!process.env[key]) {
                        process.env[key] = value;
                    }
                }
            });
            console.log(`Loaded environment variables from ${file}`);
        }
    });
}

loadEnv();

// Import handlers
const createCheckout = require('./create-checkout-session.js');
const stripeWebhook = require('./webhooks/stripe.js');

const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, stripe-signature, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    console.log(`${req.method} ${pathname}`);

    if (pathname === '/api/create-checkout-session') {
        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', async () => {
                try {
                    req.body = body ? JSON.parse(body) : {};
                    enhanceRes(res);
                    await createCheckout(req, res);
                } catch (e) {
                    console.error(e);
                    res.statusCode = 400;
                    res.end('Invalid JSON');
                }
            });
        } else {
            res.statusCode = 405;
            res.end('Method Not Allowed');
        }
    } else if (pathname === '/api/webhooks/stripe') {
        enhanceRes(res);
        await stripeWebhook(req, res);
    } else {
        res.statusCode = 404;
        res.end('Not Found');
    }
});

function enhanceRes(res) {
    res.status = function (code) {
        res.statusCode = code;
        return res;
    };
    res.json = function (data) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(data));
        return res;
    };
    res.send = function (data) {
        res.end(data);
        return res;
    };
}

const PORT = 3001;
server.listen(PORT, () => {
    console.log(`API Dev Server running on http://localhost:${PORT}`);
});
