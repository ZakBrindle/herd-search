import type { Tier } from "../contexts/AuthContext";

export const TIER_LIMITS: Record<Tier, number> = {
    free: 0,
    basic: 1,
    standard: 3,
    premium: 8,
    festival: 20,
    dev_tier_test: 3
};

export const PLANS = [
    { id: 'basic', name: 'Just the 2 of us', price: '£2.99', limit: 1 },
    { id: 'standard', name: 'Squad of 4', price: '£4.99', limit: 3 },
    { id: 'premium', name: 'Full Squad', price: '£9.99', limit: 8 },
    { id: 'festival', name: 'Festival Group', price: '£15.99', limit: 20 },
    { id: 'dev_tier_test', name: 'Dev Test', price: '£0.50', limit: 3 } // Added for dev testing
];
