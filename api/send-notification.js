import admin from 'firebase-admin';

if (!admin.apps.length) {
    try {
        if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        } else {
            admin.initializeApp();
        }
    } catch (e) {
        console.error('Firebase Admin Init Error:', e);
    }
}

const messaging = admin.messaging();

export default async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).end('Method Not Allowed');
    }

    const { tokens, title, body, data } = req.body;

    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
        return res.status(400).json({ error: 'Missing or invalid tokens' });
    }

    if (!title || !body) {
        return res.status(400).json({ error: 'Missing title or body' });
    }

    try {
        const message = {
            notification: {
                title,
                body,
            },
            tokens: tokens.filter(t => !!t), // Filter out null/undefined
            data: data || {},
            android: {
                notification: {
                    clickAction: 'FLUTTER_NOTIFICATION_CLICK', // Common for cross-platform
                }
            },
            apns: {
                payload: {
                    aps: {
                        sound: 'default',
                    },
                },
            },
        };

        const response = await messaging.sendMulticast(message);
        console.log(`Successfully sent ${response.successCount} messages; ${response.failureCount} errors.`);

        res.json({
            success: true,
            successCount: response.successCount,
            failureCount: response.failureCount
        });
    } catch (error) {
        console.error('Error sending notification:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
