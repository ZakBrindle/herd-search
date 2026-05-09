import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth, type Tier } from '../contexts/AuthContext';
import { 
    doc, onSnapshot, getDoc, updateDoc, addDoc, collection, query, where, getDocs, deleteDoc 
} from 'firebase/firestore';
import { db } from '../firebase';
import { PLANS, TIER_LIMITS } from '../constants/plans';
import { FaChevronLeft } from 'react-icons/fa';

const UpgradePage = () => {
    const { currentUser, userData } = useAuth();
    const navigate = useNavigate();
    const [upgradesEnabled, setUpgradesEnabled] = useState(true);
    const [useSandboxStripe] = useState(() => localStorage.getItem('useSandboxStripe') === 'true');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const unsub = onSnapshot(doc(db, 'config', 'payments'), (doc) => {
            if (doc.exists() && doc.data().upgradesEnabled !== undefined) {
                setUpgradesEnabled(doc.data().upgradesEnabled);
            }
        });
        return () => unsub();
    }, []);

    const getUserDocRef = (uid: string) => doc(db, 'users', uid);

    const handleUpgrade = async (planId: Tier, forceOverride = false) => {
        if (!upgradesEnabled && !userData?.isDev) {
            alert("Upgrades are currently paused by the developer.");
            return;
        }

        if (!currentUser) return;
        setLoading(true);

        try {
            if ((useSandboxStripe || forceOverride) && userData?.isDev) {
                // Direct upgrade for devs
                if (planId === 'free') {
                    if (userData?.squadId) {
                        const squadRef = doc(db, "squads", userData.squadId);
                        const snap = await getDoc(squadRef);
                        if (snap.exists()) {
                            const members = snap.data().members || [];
                            for (const memberUid of members) {
                                await updateDoc(getUserDocRef(memberUid), { squadId: null, squadOwnerId: null });
                            }
                            await deleteDoc(squadRef);
                        }
                        const invitesQ = query(collection(db, "squadInvites"), where("from", "==", currentUser.uid));
                        const invSnap = await getDocs(invitesQ);
                        invSnap.forEach(async (d) => await deleteDoc(d.ref));
                    }
                    await updateDoc(getUserDocRef(currentUser.uid), {
                        tier: 'free',
                        subscriptionExpiry: null,
                        squadId: null,
                        squadOwnerId: null
                    });
                } else {
                    const planDetails = PLANS.find(p => p.id === planId);
                    const finalTier = planId === 'dev_tier_test' ? 'basic' : planId;
                    await updateDoc(getUserDocRef(currentUser.uid), {
                        tier: finalTier,
                        subscriptionExpiry: Date.now() + 30 * 24 * 60 * 60 * 1000
                    });
                    await addDoc(collection(db, "purchases"), {
                        userId: currentUser.uid,
                        userEmail: currentUser.email || 'Unknown',
                        userName: userData?.displayName || 'Unknown',
                        tier: finalTier,
                        actualTierId: planId,
                        amount: planDetails?.price || 'Unknown',
                        createdAt: Date.now(),
                        status: 'completed'
                    });
                }
                alert(`Plan updated to ${planId.toUpperCase()}!`);
                navigate('/');
            } else {
                // Stripe Checkout Flow
                const planDetails = PLANS.find(p => p.id === planId);
                
                // 1. Create the purchase doc FIRST to get the ID
                const purchaseDoc = await addDoc(collection(db, "purchases"), {
                    userId: currentUser.uid,
                    userEmail: currentUser.email || 'Unknown',
                    userName: userData?.displayName || 'Unknown',
                    tier: planId === 'dev_tier_test' ? 'basic' : planId,
                    actualTierId: planId,
                    amount: planDetails?.price || 'Unknown',
                    createdAt: Date.now(),
                    status: 'started'
                });

                localStorage.setItem('pendingPlan', planId);
                localStorage.setItem('pendingPurchaseId', purchaseDoc.id);
                await updateDoc(getUserDocRef(currentUser.uid), { isPaymentPending: true });

                // 2. Now call the API with the ID
                const res = await fetch('/api/create-checkout-session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tierId: planId,
                        userId: currentUser.uid,
                        purchaseId: purchaseDoc.id,
                        sandboxMode: useSandboxStripe,
                        successUrl: window.location.origin + '?checkout_success=true',
                        cancelUrl: window.location.origin + '?checkout_cancel=true',
                    })
                });

                const data = await res.json();
                if (data.url) {
                    window.location.href = data.url;
                } else {
                    console.error("No URL returned from checkout session creation", data);
                    alert("Failed to initiate checkout. Please try again.");
                }
            }
        } catch (error) {
            console.error("Upgrade failed:", error);
            alert("Something went wrong. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleRestorePurchase = async () => {
        if (!currentUser) return;
        setLoading(true);
        try {
            console.log("Starting manual purchase restoration...");
            // Try by UID first
            let q = query(
                collection(db, "purchases"),
                where("userId", "==", currentUser.uid),
                where("status", "==", "completed")
            );
            let snap = await getDocs(q);

            // If not found by UID, try by Email
            if (snap.empty && currentUser.email) {
                console.log("No purchases found by UID, trying by email...");
                q = query(
                    collection(db, "purchases"),
                    where("userEmail", "==", currentUser.email.toLowerCase()),
                    where("status", "==", "completed")
                );
                snap = await getDocs(q);
            }

            if (snap.empty) {
                alert("No recent completed purchases found for your account.");
                return;
            }

            // Find the most recent one
            const sorted = snap.docs
                .map(d => d.data())
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            
            const latest = sorted[0];
            const purchaseDate = latest.createdAt;
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

            if (purchaseDate > thirtyDaysAgo) {
                console.log("Valid purchase found! Updating profile...");
                await updateDoc(getUserDocRef(currentUser.uid), {
                    tier: latest.tier,
                    subscriptionExpiry: purchaseDate + (30 * 24 * 60 * 60 * 1000),
                    isPaymentPending: false
                });
                alert(`Successfully restored ${latest.tier.toUpperCase()} plan!`);
                navigate('/');
            } else {
                alert("Your last purchase was more than 30 days ago and has expired.");
            }
        } catch (error) {
            console.error("Restore failed:", error);
            alert("Something went wrong while restoring. Please try again later.");
        } finally {
            setLoading(false);
        }
    };

    const hasActiveSubscription = (user: any) => {
        if (!user) return false;
        if (user.isDev) return true;
        if (!user.subscriptionExpiry) return false;
        return user.subscriptionExpiry > Date.now();
    };

    const currentTier = hasActiveSubscription(userData) ? (userData?.tier || 'free') : 'free';

    return (
        <div style={{ 
            minHeight: '100vh', 
            background: '#121212', 
            color: 'white', 
            padding: '1.5rem',
            fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
        }}>
            <style>
                {`
                    @keyframes spin {
                        from { transform: rotate(0deg); }
                        to { transform: rotate(360deg); }
                    }
                    .spin { animation: spin 1s linear infinite; }
                `}
            </style>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
                <button 
                    onClick={() => navigate(-1)} 
                    style={{ 
                        background: 'rgba(255,255,255,0.1)', 
                        border: 'none', 
                        color: 'white', 
                        padding: '12px', 
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer'
                    }}
                >
                    <FaChevronLeft />
                </button>
                <img src="/logo-main.png" alt="Herd Search Logo" style={{ height: '65px' }} />
                <div style={{ width: '65px' }} /> {/* Spacer for centering */}
            </div>

            <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
                <h1 style={{ 
                    fontSize: '2rem', 
                    fontWeight: '800', 
                    marginBottom: '0.5rem',
                    background: 'linear-gradient(45deg, var(--primary, #03dac6), var(--secondary, #bb86fc))',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent'
                }}>
                    Upgrade Plan ⚡
                </h1>
                <p style={{ color: '#888', fontSize: '1rem' }}>
                    Expand your squad and never lose your friends.
                </p>
            </div>

            {/* Current Plan Badge */}
            <div style={{ 
                background: 'rgba(255,255,255,0.05)', 
                borderRadius: '12px', 
                padding: '1rem', 
                marginBottom: '2rem',
                border: '1px solid #333',
                textAlign: 'center'
            }}>
                <span style={{ color: '#888', fontSize: '0.9rem' }}>Current Plan: </span>
                <strong style={{ color: 'var(--primary, #03dac6)', textTransform: 'capitalize' }}>{currentTier}</strong>
            </div>

            {/* Pricing Grid */}
            <div className="pricing-grid" style={{ marginBottom: '3rem' }}>
                {useSandboxStripe && (
                    <div 
                        className="pricing-card"
                        onClick={() => !loading && handleUpgrade('free' as Tier)}
                        style={{ 
                            cursor: loading ? 'not-allowed' : 'pointer',
                            opacity: loading ? 0.7 : 1,
                        }}
                    >
                        <h3>Free</h3>
                        <p className="pricing-price">£0.00</p>
                        <p style={{ fontSize: '0.8rem', color: '#888', textAlign: 'center', marginBottom: '1.5rem' }}>Solo Mode</p>
                        <button className="btn btn-secondary w-full" style={{ pointerEvents: 'none' }}>Select</button>
                    </div>
                )}

                {PLANS.filter(p => (p.id !== 'dev_tier_test' || userData?.isDev) && (useSandboxStripe || p.limit > TIER_LIMITS[currentTier])).map(plan => (
                    <div 
                        key={plan.id} 
                        className="pricing-card"
                        onClick={() => !loading && handleUpgrade(plan.id as Tier)}
                        style={{ 
                            cursor: (loading || !upgradesEnabled) ? 'not-allowed' : 'pointer',
                            opacity: (loading || !upgradesEnabled) ? 0.7 : 1,
                        }}
                    >
                        <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', textAlign: 'center' }}>{plan.name}</h3>
                        
                        <div style={{ width: '100%', marginBottom: '1rem' }}>
                            {plan.id === 'basic' && <img src="/tier_2_people.png" alt="2 People" style={{ width: '100%', height: 'auto', borderRadius: '8px' }} />}
                            {plan.id === 'standard' && <img src="/tier_4_people.png" alt="Squad of 4" style={{ width: '100%', height: 'auto', borderRadius: '8px' }} />}
                            {plan.id === 'premium' && <img src="/tier_9_people.png" alt="Full Squad" style={{ width: '100%', height: 'auto', borderRadius: '8px' }} />}
                            {plan.id === 'festival' && <img src="/tier_21_people.png" alt="Festival Group" style={{ width: '100%', height: 'auto', borderRadius: '8px' }} />}
                        </div>

                        <p className="pricing-price">{plan.price}</p>
                        <p style={{ fontSize: '0.75rem', color: '#888', textAlign: 'center', marginBottom: '1rem' }}>Up to {plan.limit} Friends</p>
                        
                        <button 
                            className="btn btn-primary w-full" 
                            disabled={loading || !upgradesEnabled}
                            style={{ 
                                pointerEvents: loading ? 'none' : 'auto',
                                background: 'linear-gradient(45deg, var(--primary, #bb86fc), var(--secondary, #03dac6))',
                                border: 'none',
                                color: 'black',
                                fontWeight: 'bold',
                                padding: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px'
                            }}
                        >
                            {loading ? (
                                <>
                                    <span className="spin" style={{ 
                                        width: '14px', 
                                        height: '14px', 
                                        border: '2px solid rgba(0,0,0,0.2)', 
                                        borderTop: '2px solid black', 
                                        borderRadius: '50%',
                                        display: 'inline-block',
                                        animation: 'spin 1s linear infinite'
                                    }}></span>
                                    Redirecting...
                                </>
                            ) : (
                                !upgradesEnabled ? "Paused" : "Select"
                            )}
                        </button>
                    </div>
                ))}
            </div>

            <div style={{ textAlign: 'center', padding: '0 1rem', marginBottom: '2rem' }}>
                <p style={{ color: '#666', fontSize: '0.85rem', lineHeight: '1.4' }}>
                    By purchasing a plan, you agree to our <Link to="/terms" style={{ color: 'var(--primary, #03dac6)', textDecoration: 'underline' }}>Terms of Service</Link>.
                </p>
                <p style={{ color: '#555', fontSize: '0.75rem', marginTop: '1rem' }}>
                    All plans are one-time payments for 30 days of access.
                </p>

                <div style={{ marginTop: '2rem', borderTop: '1px solid #333', paddingTop: '2rem' }}>
                    <p style={{ color: '#888', fontSize: '0.8rem', marginBottom: '1rem' }}>Already paid but still on Free?</p>
                    <button 
                        onClick={handleRestorePurchase}
                        disabled={loading}
                        style={{ 
                            background: 'transparent',
                            border: '1px solid #444',
                            color: '#aaa',
                            padding: '10px 20px',
                            borderRadius: '8px',
                            cursor: loading ? 'not-allowed' : 'pointer',
                            fontSize: '0.9rem'
                        }}
                    >
                        {loading ? 'Checking...' : 'Restore Purchase'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default UpgradePage;
