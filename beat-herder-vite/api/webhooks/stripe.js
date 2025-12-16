import { buffer } from 'micro';
import Stripe from 'stripe';
import admin from 'firebase-admin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

if (!admin.apps.length) {
    // Initialize Firebase Admin. 
    // Expects environment variables for credentials in production (e.g. FIREBASE_SERVICE_ACCOUNT_KEY)
    // or default credentials on Cloud platforms.
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

const db = admin.firestore();

// Disable Vercel's default body parsing so we can verify the signature
export const config = {
    api: {
        bodyParser: false,
    },
};

export default async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).end('Method Not Allowed');
    }

    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        const buf = await buffer(req);
        event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
    } catch (err) {
        console.error(`Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const { userId, tierId } = session.metadata;

        if (userId && tierId) {
            try {
                const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days from now

                await db.collection('users').doc(userId).update({
                    tier: tierId, // Used by Frontend
                    subscriptionExpiry: expiresAt, // Used by Frontend
                    tier_level: tierId, // Requested by User
                    tier_expires_at: expiresAt // Requested by User
                });
                console.log(`Updated user ${userId} to tier ${tierId}`);
            } catch (error) {
                console.error('Error updating user in Firestore:', error);
                return res.status(500).json({ error: 'Firestore update failed' });
            }
        }
    }

    res.status(200).json({ received: true });
};
