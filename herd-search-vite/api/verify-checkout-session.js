import Stripe from 'stripe';
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

const db = admin.firestore();

export default async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).end('Method Not Allowed');
    }

    const { sessionId, purchaseId, userId, sandboxMode } = req.body;

    if (!sessionId || !purchaseId || !userId) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    const apiKey = sandboxMode ? process.env.STRIPE_SANDBOX_API : process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
        console.error('Stripe API Key missing for mode:', sandboxMode ? 'Sandbox' : 'Production');
        return res.status(500).json({ error: 'Configuration Error' });
    }

    const stripe = new Stripe(apiKey);

    try {
        console.log(`Verifying Stripe session: ${sessionId} for purchase: ${purchaseId}`);
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status === 'paid') {
            const tierId = session.metadata.tierId;

            try {
                // Update user profile in Firestore
                if (tierId === 'personalise_package') {
                    await db.collection('users').doc(userId).update({
                        unlockedPersonalisePackage: true
                    });
                } else {
                    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days from now
                    const subscriptionEndDate = new Date(expiresAt).toISOString();

                    await db.collection('users').doc(userId).update({
                        tier: tierId,
                        subscriptionExpiry: expiresAt,
                        subscriptionEndDate: subscriptionEndDate,
                        tier_level: tierId,
                        tier_expires_at: expiresAt
                    });
                }

                // Update purchase record
                await db.collection('purchases').doc(purchaseId).update({
                    status: 'completed',
                    updatedAt: Date.now()
                });

                console.log(`Stripe session verified and db updated for user ${userId}, tier ${tierId}`);
            } catch (dbError) {
                console.warn(`Firestore write failed (likely missing credentials in dev): ${dbError.message}`);
                // Do not throw, return verified: true so that the client-side fallback can update Firestore instead
            }

            return res.json({ verified: true, tierId, status: 'completed' });
        } else {
            console.log(`Stripe session ${sessionId} is unpaid. Status: ${session.payment_status}`);
            return res.json({ verified: false, status: session.payment_status });
        }
    } catch (error) {
        console.error('Verification error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
