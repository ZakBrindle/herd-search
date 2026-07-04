import Stripe from 'stripe';

const PRICES = {
    'basic': { amount: 299, name: 'Just the 2 of us (Tier 1)' },
    'standard': { amount: 499, name: 'Squad of 4 (Tier 2)' },
    'premium': { amount: 999, name: 'Full Squad (Tier 3)' },
    'festival': { amount: 1599, name: 'Festival Group (Tier 4)' },
    'personalise_package': { amount: 399, name: 'Personalise Package' },
    'dev_tier_test': { amount: 50, name: 'Dev Test (Tier 2)' },
};

export default async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).end('Method Not Allowed');
    }

    const { tierId, userId, purchaseId, successUrl, cancelUrl, sandboxMode } = req.body;

    if (!tierId || !userId || !PRICES[tierId]) {
        return res.status(400).json({ error: 'Invalid parameters' });
    }

    // Use Sandbox key if requested, otherwise Production key
    const apiKey = sandboxMode ? process.env.STRIPE_SANDBOX_API : process.env.STRIPE_SECRET_KEY;

    if (!apiKey) {
        console.error('Stripe API Key missing for mode:', sandboxMode ? 'Sandbox' : 'Production');
        return res.status(500).json({ error: 'Configuration Error' });
    }

    const stripe = new Stripe(apiKey);
    const priceInfo = PRICES[tierId];

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'gbp',
                        product_data: {
                            name: priceInfo.name,
                            description: tierId === 'personalise_package' 
                                ? 'Permanent access to premium avatar customization features' 
                                : '30-day access to higher squad limits',
                        },
                        unit_amount: priceInfo.amount,
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            metadata: {
                userId,
                tierId,
                purchaseId
            },
            success_url: `${successUrl}?checkout_success=true&payment_intent={CHECKOUT_SESSION_ID}&redirect_status=succeeded`,
            cancel_url: `${cancelUrl}?checkout_cancel=true&redirect_status=canceled`,
        });

        res.json({ url: session.url });
    } catch (error) {
        console.error('Stripe error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
