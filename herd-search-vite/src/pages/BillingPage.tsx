import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { FaChevronLeft, FaChartLine, FaHistory, FaCheckCircle, FaSpinner, FaTimesCircle, FaDollarSign, FaShoppingCart, FaStar, FaUser } from 'react-icons/fa';

interface Purchase {
    id: string;
    userId: string;
    userEmail: string;
    userName: string;
    tier: string;
    amount: string;
    createdAt: number;
    status: 'started' | 'completed' | 'failed';
    actualTierId?: string;
}

import { useNavigate } from 'react-router-dom';

interface BillingPageProps {
    onClose: () => void;
    isDev?: boolean;
}

const BillingPage: React.FC<BillingPageProps> = ({ onClose, isDev }) => {
    const navigate = useNavigate();
    const [purchases, setPurchases] = useState<Purchase[]>([]);
    const [loading, setLoading] = useState(true);
    const [cleaning, setCleaning] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [hideDevLogs, setHideDevLogs] = useState(() => {
        const stored = localStorage.getItem('hideDevLogs');
        return stored === null ? true : stored === 'true';
    });

    const [viewMode, setViewMode] = useState<'dashboard' | 'users'>('dashboard');
    const [users, setUsers] = useState<any[]>([]);
    const [squads, setSquads] = useState<any[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [sortBy, setSortBy] = useState<'active' | 'money'>('active');
    const [selectedUserForAction, setSelectedUserForAction] = useState<any | null>(null);
    const [actionType, setActionType] = useState<'menu' | 'history' | 'override'>('menu');

    const filteredPurchases = useMemo(() => {
        if (!hideDevLogs) return purchases;
        return purchases.filter(p => p.userEmail?.toLowerCase() !== 'z4kbrindle@gmail.com');
    }, [purchases, hideDevLogs]);

    useEffect(() => {
        const q = query(collection(db, "purchases"), orderBy("createdAt", "desc"));
        const unsub = onSnapshot(q, (snap) => {
            const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Purchase));
            setPurchases(data);
            setLoading(false);
            setError(null);
        }, (err) => {
            console.error("Firestore error in BillingPage:", err);
            setError(err.message);
            setLoading(false);
        });
        return () => unsub();
    }, []);

    useEffect(() => {
        if (viewMode !== 'users') return;
        setUsersLoading(true);
        // Fetch all users
        const usersQuery = query(collection(db, "users"));
        const unsubUsers = onSnapshot(usersQuery, (snap) => {
            const uData = snap.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
            setUsers(uData);
        }, (err) => console.error("Error fetching users:", err));

        // Fetch all squads
        const squadsQuery = query(collection(db, "squads"));
        const unsubSquads = onSnapshot(squadsQuery, (snap) => {
            const sData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setSquads(sData);
            setUsersLoading(false);
        }, (err) => {
            console.error("Error fetching squads:", err);
            setUsersLoading(false);
        });

        return () => {
            unsubUsers();
            unsubSquads();
        };
    }, [viewMode]);

    const formatDateTime = (timestamp: number) => {
        if (!timestamp) return 'Never';
        const d = new Date(timestamp);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const groupedData = useMemo(() => {
        // 1. Prepare user objects with calculated fields
        const processedUsers = users.map(u => {
            const userPurchases = purchases.filter(p => p.userId === u.uid && p.status === 'completed');
            const totalSpent = userPurchases.reduce((sum, p) => {
                const amount = parseFloat(p.amount.replace('£', '')) || 0;
                return sum + amount;
            }, 0);

            return {
                ...u,
                totalSpent,
                hasPurchased: userPurchases.length > 0,
                lastActiveTime: u.lastUpdate || 0
            };
        });

        // 2. Filter out dev user if hideDevLogs is true
        const filteredUsers = processedUsers.filter(u => {
            if (hideDevLogs && u.email?.toLowerCase() === 'z4kbrindle@gmail.com') {
                return false;
            }
            return true;
        });

        // 3. Separate into grouped and All Alone
        const aloneUsers: any[] = [];
        const squadGroupsMap: { [squadId: string]: any[] } = {};

        filteredUsers.forEach(u => {
            if (u.squadId && squads.some(s => s.id === u.squadId)) {
                if (!squadGroupsMap[u.squadId]) {
                    squadGroupsMap[u.squadId] = [];
                }
                squadGroupsMap[u.squadId].push(u);
            } else {
                aloneUsers.push(u);
            }
        });

        // 4. Map squads and calculate summary stats
        const squadList = Object.entries(squadGroupsMap).map(([squadId, members]) => {
            const maxLastActive = Math.max(...members.map(m => m.lastActiveTime));
            const totalSpent = members.reduce((sum, m) => sum + m.totalSpent, 0);

            // Sort members within squad
            const sortedMembers = [...members].sort((a, b) => {
                if (sortBy === 'money') {
                    return b.totalSpent - a.totalSpent || b.lastActiveTime - a.lastActiveTime;
                }
                return b.lastActiveTime - a.lastActiveTime;
            });

            // Get squad owner name to name the squad
            const squadDoc = squads.find(s => s.id === squadId);
            let ownerName = 'Unknown';
            if (squadDoc) {
                const ownerUser = processedUsers.find(u => u.uid === squadDoc.ownerId);
                if (ownerUser) ownerName = ownerUser.displayName || 'Unknown';
            }

            return {
                squadId,
                ownerName: `${ownerName}'s Squad`,
                members: sortedMembers,
                maxLastActive,
                totalSpent
            };
        });

        // 5. Sort squads
        squadList.sort((a, b) => {
            if (sortBy === 'money') {
                return b.totalSpent - a.totalSpent || b.maxLastActive - a.maxLastActive;
            }
            return b.maxLastActive - a.maxLastActive;
        });

        // 6. Sort alone users
        const sortedAloneUsers = [...aloneUsers].sort((a, b) => {
            if (sortBy === 'money') {
                return b.totalSpent - a.totalSpent || b.lastActiveTime - a.lastActiveTime;
            }
            return b.lastActiveTime - a.lastActiveTime;
        });

        return {
            squads: squadList,
            alone: sortedAloneUsers
        };
    }, [users, squads, purchases, hideDevLogs, sortBy]);

    const handleCleanup = async () => {
        if (!isDev) return;
        if (!window.confirm("Mark all transactions older than 2 hours as FAILED?")) return;
        
        setCleaning(true);
        const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
        const started = purchases.filter(p => p.status === 'started' && p.createdAt < twoHoursAgo);

        try {
            const { doc, updateDoc } = await import('firebase/firestore');
            for (const p of started) {
                await updateDoc(doc(db, "purchases", p.id), { status: 'failed', updatedAt: Date.now() });
            }
            alert(`Cleaned up ${started.length} transactions.`);
        } catch (e) {
            console.error("Cleanup failed:", e);
            alert("Cleanup failed. See console.");
        } finally {
            setCleaning(false);
        }
    };

    const stats = useMemo(() => {
        const completed = filteredPurchases.filter(p => p.status === 'completed');
        const totalIncome = completed.reduce((acc, p) => {
            const amount = parseFloat(p.amount.replace('£', '')) || 0;
            return acc + amount;
        }, 0);

        const tierCounts: { [key: string]: number } = {};
        completed.forEach(p => {
            // Exclude Dev tier from 'Most Purchased'
            if (p.actualTierId !== 'dev_tier_test' && p.tier !== 'dev_tier_test') {
                tierCounts[p.tier] = (tierCounts[p.tier] || 0) + 1;
            }
        });

        let mostPurchasedTier = 'N/A';
        let maxCount = 0;
        Object.entries(tierCounts).forEach(([tier, count]) => {
            if (count > maxCount) {
                maxCount = count;
                mostPurchasedTier = tier;
            }
        });

        return {
            totalIncome: totalIncome.toFixed(2),
            totalSales: completed.length,
            paymentsStarted: filteredPurchases.length,
            mostPurchasedTier
        };
    }, [filteredPurchases]);

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#121212', color: 'white' }}>
                <img src="/logo-main.png" alt="Logo" style={{ width: '120px', marginBottom: '2.5rem', animation: 'pulsate 3s infinite ease-in-out' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <FaSpinner className="spin" style={{ fontSize: '1.2rem', color: 'var(--primary)' }} />
                    <p style={{ margin: 0, fontWeight: 'bold', fontSize: '1.1rem' }}>Loading Billing Data...</p>
                </div>
            </div>
        );
    }

    if (selectedUserForAction) {
        if (actionType === 'menu') {
            return (
                <div style={{ minHeight: '100vh', background: '#121212', color: 'white', padding: '1.5rem', fontFamily: 'Inter, sans-serif' }}>
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
                        <button onClick={() => setSelectedUserForAction(null)} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: 'white', padding: '10px', borderRadius: '50%', cursor: 'pointer' }}>
                            <FaChevronLeft />
                        </button>
                        <div>
                            <h1 style={{ margin: 0, fontSize: '1.6rem', color: '#03dac6' }}>
                                Manage User: {selectedUserForAction.displayName || 'Anonymous'}
                            </h1>
                            <div style={{ fontSize: '0.85rem', color: '#888' }}>
                                {selectedUserForAction.email}
                            </div>
                        </div>
                    </div>

                    <div className="billing-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '500px', margin: '0 auto' }}>
                        <h3 style={{ margin: 0, fontSize: '1.2rem', textAlign: 'center', marginBottom: '1rem' }}>Select Action</h3>
                        
                        <button 
                            onClick={() => setActionType('history')}
                            className="btn w-full"
                            style={{
                                background: 'linear-gradient(45deg, #03dac6, #018786)',
                                color: 'black',
                                border: 'none',
                                padding: '15px',
                                borderRadius: '10px',
                                fontSize: '1rem',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                transition: 'transform 0.1s'
                            }}
                        >
                            View Billing History 📊
                        </button>

                        <button 
                            onClick={() => setActionType('override')}
                            className="btn w-full"
                            style={{
                                background: 'linear-gradient(45deg, #bb86fc, #6200ee)',
                                color: 'white',
                                border: 'none',
                                padding: '15px',
                                borderRadius: '10px',
                                fontSize: '1rem',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                transition: 'transform 0.1s'
                            }}
                        >
                            Manually Override Tier ⚙️
                        </button>

                        <button 
                            onClick={() => setSelectedUserForAction(null)}
                            className="btn btn-secondary w-full"
                            style={{
                                background: 'rgba(255,255,255,0.05)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                color: 'white',
                                padding: '12px',
                                borderRadius: '8px',
                                fontSize: '0.9rem',
                                cursor: 'pointer',
                                marginTop: '1rem'
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            );
        }

        if (actionType === 'history') {
            const userHistory = purchases.filter(p => p.userId === selectedUserForAction.uid);
            return (
                <div style={{ minHeight: '100vh', background: '#121212', color: 'white', padding: '1.5rem', fontFamily: 'Inter, sans-serif' }}>
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
                        <button onClick={() => setActionType('menu')} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: 'white', padding: '10px', borderRadius: '50%', cursor: 'pointer' }}>
                            <FaChevronLeft />
                        </button>
                        <div>
                            <h1 style={{ margin: 0, fontSize: '1.6rem', color: '#03dac6' }}>
                                Billing History: {selectedUserForAction.displayName || 'Anonymous'}
                            </h1>
                            <div style={{ fontSize: '0.85rem', color: '#888' }}>
                                {selectedUserForAction.email} &bull; Tier: <span style={{ textTransform: 'capitalize', color: '#bb86fc', fontWeight: 'bold' }}>{selectedUserForAction.tier || 'free'}</span>
                            </div>
                        </div>
                    </div>

                    {/* History Table */}
                    <div className="billing-card">
                        <h3 style={{ marginTop: 0, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <FaHistory /> Transactions ({userHistory.length})
                        </h3>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {userHistory.map(p => {
                                const isExpired = p.status === 'started' && (Date.now() - p.createdAt > 7200000);
                                const displayStatus = isExpired ? 'failed' : p.status;
                                const isPersonalisation = p.tier === 'personalise_package';

                                return (
                                    <div key={p.id} style={{ 
                                        padding: '1rem', 
                                        background: 'rgba(255,255,255,0.02)', 
                                        borderRadius: '8px',
                                        borderLeft: `4px solid ${displayStatus === 'completed' ? '#03dac6' : displayStatus === 'started' ? '#ffc107' : '#cf6679'}`,
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}>
                                        <div>
                                            <div style={{ fontWeight: 'bold', fontSize: '1rem', color: '#fff' }}>
                                                {isPersonalisation ? 'Personalisation Package' : `Tier: ${p.tier.toUpperCase()}`}
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: '#666', fontFamily: 'monospace', marginTop: '2px' }}>
                                                Transaction ID: {p.id}
                                            </div>
                                            <div style={{ fontSize: '0.9rem', color: '#ccc', marginTop: '6px' }}>
                                                Price: <strong style={{ color: '#fff' }}>{p.amount}</strong>
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '6px' }}>
                                                📅 {new Date(p.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                                            </div>
                                        </div>
                                        <div>
                                            <span className="status-badge" style={{ 
                                                backgroundColor: displayStatus === 'completed' ? 'rgba(3, 218, 198, 0.1)' : displayStatus === 'started' ? 'rgba(255, 193, 7, 0.1)' : 'rgba(207, 102, 121, 0.1)',
                                                color: displayStatus === 'completed' ? '#03dac6' : displayStatus === 'started' ? '#ffc107' : '#cf6679'
                                            }}>
                                                {displayStatus === 'completed' ? <FaCheckCircle style={{ marginRight: '4px' }} /> : displayStatus === 'started' ? <FaSpinner className="spin" style={{ marginRight: '4px' }} /> : <FaTimesCircle style={{ marginRight: '4px' }} />}
                                                {displayStatus}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                            {userHistory.length === 0 && (
                                <div style={{ textAlign: 'center', padding: '2rem', color: '#555' }}>No transactions found for this user.</div>
                            )}
                        </div>
                    </div>
                </div>
            );
        }

        if (actionType === 'override') {
            return (
                <div style={{ minHeight: '100vh', background: '#121212', color: 'white', padding: '1.5rem', fontFamily: 'Inter, sans-serif' }}>
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
                        <button onClick={() => setActionType('menu')} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: 'white', padding: '10px', borderRadius: '50%', cursor: 'pointer' }}>
                            <FaChevronLeft />
                        </button>
                        <div>
                            <h1 style={{ margin: 0, fontSize: '1.6rem', color: '#03dac6' }}>
                                Override User Tier: {selectedUserForAction.displayName || 'Anonymous'}
                            </h1>
                            <div style={{ fontSize: '0.85rem', color: '#888' }}>
                                {selectedUserForAction.email}
                            </div>
                        </div>
                    </div>

                    <div className="billing-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '500px', margin: '0 auto' }}>
                        {/* Current info */}
                        <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', border: '1px solid #333' }}>
                            <div style={{ marginBottom: '8px' }}>
                                Current Subscription: <strong style={{ color: '#03dac6', textTransform: 'capitalize' }}>{selectedUserForAction.tier || 'free'}</strong>
                            </div>
                            <div style={{ marginBottom: '8px' }}>
                                Expiry Date: <strong style={{ color: '#aaa' }}>{formatDateTime(selectedUserForAction.subscriptionExpiry)}</strong>
                            </div>
                            <div>
                                Personalisation Package: <strong style={{ color: selectedUserForAction.unlockedPersonalisePackage ? '#bb86fc' : '#555' }}>
                                    {selectedUserForAction.unlockedPersonalisePackage ? 'Unlocked' : 'No'}
                                </strong>
                            </div>
                        </div>

                        {/* Tier Select */}
                        <div>
                            <label style={{ display: 'block', marginBottom: '0.5rem', color: '#bb86fc', fontSize: '0.9rem', fontWeight: 'bold' }}>Select New Tier</label>
                            <select
                                value={selectedUserForAction.tier || 'free'}
                                onChange={async (e) => {
                                    const newTier = e.target.value;
                                    try {
                                        await updateDoc(doc(db, "users", selectedUserForAction.uid), {
                                            tier: newTier,
                                            subscriptionExpiry: newTier === 'free' ? null : Date.now() + 30 * 24 * 60 * 60 * 1000,
                                            isPaymentPending: false
                                        });
                                        setSelectedUserForAction((prev: any) => ({
                                            ...prev,
                                            tier: newTier,
                                            subscriptionExpiry: newTier === 'free' ? null : Date.now() + 30 * 24 * 60 * 60 * 1000
                                        }));
                                        alert(`Manually overridden tier to ${newTier.toUpperCase()}`);
                                    } catch (err: any) {
                                        console.error(err);
                                        alert("Failed to override tier: " + err.message);
                                    }
                                }}
                                style={{
                                    width: '100%',
                                    background: '#121212',
                                    border: '1px solid #444',
                                    color: 'white',
                                    padding: '12px',
                                    borderRadius: '8px',
                                    fontSize: '0.95rem'
                                }}
                            >
                                <option value="free">Free</option>
                                <option value="basic">Just the 2 of us (basic)</option>
                                <option value="standard">Squad of 4 (standard)</option>
                                <option value="premium">Full Squad (premium)</option>
                                <option value="festival">Festival Group (festival)</option>
                                <option value="dev_tier_test">Dev Test (dev_tier_test)</option>
                            </select>
                        </div>

                        {/* Personalisation Toggle */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '1rem', borderTop: '1px solid #333', paddingTop: '1.5rem' }}>
                            <div>
                                <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#fff' }}>Unlock Personalisation Package</h4>
                                <p style={{ margin: 0, fontSize: '0.75rem', color: '#888' }}>Grants access to premium avatar options manually.</p>
                            </div>
                            <div 
                                onClick={async () => {
                                    const currentVal = !!selectedUserForAction.unlockedPersonalisePackage;
                                    try {
                                        await updateDoc(doc(db, "users", selectedUserForAction.uid), {
                                            unlockedPersonalisePackage: !currentVal
                                        });
                                        setSelectedUserForAction((prev: any) => ({
                                            ...prev,
                                            unlockedPersonalisePackage: !currentVal
                                        }));
                                        alert(`Personalisation Package ${!currentVal ? 'Unlocked' : 'Locked'}`);
                                    } catch (err: any) {
                                        console.error(err);
                                        alert("Failed to update personalisation: " + err.message);
                                    }
                                }}
                                style={{
                                    width: '40px',
                                    height: '20px',
                                    background: selectedUserForAction.unlockedPersonalisePackage ? '#bb86fc' : '#555',
                                    borderRadius: '10px',
                                    position: 'relative',
                                    cursor: 'pointer',
                                    transition: 'background 0.3s'
                                }}
                            >
                                <div style={{
                                    width: '16px',
                                    height: '16px',
                                    background: 'white',
                                    borderRadius: '50%',
                                    position: 'absolute',
                                    top: '2px',
                                    left: selectedUserForAction.unlockedPersonalisePackage ? '22px' : '2px',
                                    transition: 'left 0.3s'
                                }} />
                            </div>
                        </div>

                        <button 
                            onClick={() => setActionType('menu')}
                            className="btn btn-secondary w-full"
                            style={{
                                background: 'rgba(255,255,255,0.05)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                color: 'white',
                                padding: '12px',
                                borderRadius: '8px',
                                fontSize: '0.9rem',
                                cursor: 'pointer',
                                marginTop: '1.5rem'
                            }}
                        >
                            Back to Actions
                        </button>
                    </div>
                </div>
            );
        }
    }

    if (viewMode === 'users') {
        return (
            <div style={{ minHeight: '100vh', background: '#121212', color: 'white', padding: '1.5rem', fontFamily: 'Inter, sans-serif' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <button onClick={() => setViewMode('dashboard')} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: 'white', padding: '10px', borderRadius: '50%', cursor: 'pointer' }}>
                            <FaChevronLeft />
                        </button>
                        <h1 style={{ margin: 0, fontSize: '1.8rem', background: 'linear-gradient(45deg, #03dac6, #bb86fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                            All Users Directory
                        </h1>
                    </div>

                    {/* Sorting & Filter Options */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {/* Sort by toggle */}
                        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', padding: '4px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                            <button 
                                onClick={() => setSortBy('active')}
                                style={{
                                    background: sortBy === 'active' ? 'var(--primary, #03dac6)' : 'transparent',
                                    border: 'none',
                                    color: sortBy === 'active' ? '#000' : '#aaa',
                                    padding: '6px 12px',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontSize: '0.8rem',
                                    fontWeight: 'bold',
                                    transition: 'all 0.2s'
                                }}
                            >
                                Last Active
                            </button>
                            <button 
                                onClick={() => setSortBy('money')}
                                style={{
                                    background: sortBy === 'money' ? 'var(--primary, #03dac6)' : 'transparent',
                                    border: 'none',
                                    color: sortBy === 'money' ? '#000' : '#aaa',
                                    padding: '6px 12px',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontSize: '0.8rem',
                                    fontWeight: 'bold',
                                    transition: 'all 0.2s'
                                }}
                            >
                                Money Spent
                            </button>
                        </div>

                        {/* Hide Dev Logs (also affects this page) */}
                        <div 
                            onClick={() => {
                                const val = !hideDevLogs;
                                setHideDevLogs(val);
                                localStorage.setItem('hideDevLogs', String(val));
                            }}
                            style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '8px', 
                                cursor: 'pointer',
                                background: 'rgba(255,255,255,0.05)',
                                padding: '8px 16px',
                                borderRadius: '8px',
                                border: '1px solid rgba(255,255,255,0.1)',
                                userSelect: 'none'
                            }}
                        >
                            <span style={{ fontSize: '0.8rem', fontWeight: '600', color: '#ccc' }}>Hide Dev Logs</span>
                            <div style={{ width: '34px', height: '18px', background: hideDevLogs ? 'var(--primary, #03dac6)' : '#555', borderRadius: '9px', position: 'relative', transition: 'background 0.3s' }}>
                                <div style={{ width: '14px', height: '14px', background: 'white', borderRadius: '50%', position: 'absolute', top: '2px', left: hideDevLogs ? '18px' : '2px', transition: 'left 0.3s' }} />
                            </div>
                        </div>
                    </div>
                </div>

                {usersLoading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
                        <FaSpinner className="spin" style={{ fontSize: '2rem', color: 'var(--primary)' }} />
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                        {/* Squads List */}
                        {groupedData.squads.map(squad => (
                            <div key={squad.squadId} className="billing-card" style={{ borderLeft: '4px solid #bb86fc' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #333', paddingBottom: '0.5rem' }}>
                                    <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#bb86fc' }}>{squad.ownerName}</h3>
                                    <div style={{ fontSize: '0.8rem', color: '#888', display: 'flex', gap: '15px' }}>
                                        <span>Total Squad Spent: <strong style={{ color: '#03dac6' }}>£{squad.totalSpent.toFixed(2)}</strong></span>
                                        <span>Most Active: <strong>{formatDateTime(squad.maxLastActive)}</strong></span>
                                    </div>
                                </div>

                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid #222', color: '#666' }}>
                                                <th style={{ padding: '8px' }}>User</th>
                                                <th style={{ padding: '8px' }}>Email</th>
                                                <th style={{ padding: '8px' }}>Friends</th>
                                                <th style={{ padding: '8px' }}>Last Active</th>
                                                <th style={{ padding: '8px' }}>Tier</th>
                                                <th style={{ padding: '8px' }}>Personalisation</th>
                                                <th style={{ padding: '8px', textAlign: 'right' }}>Total Spent</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {squad.members.map(member => (
                                                <tr 
                                                    key={member.uid} 
                                                    onClick={() => {
                                                        setSelectedUserForAction(member);
                                                        setActionType('menu');
                                                    }}
                                                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                                                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                                                    style={{ borderBottom: '1px solid #2a2a2a', height: '40px', cursor: 'pointer', transition: 'background 0.2s' }}
                                                >
                                                    <td style={{ padding: '8px', fontWeight: 'bold' }}>{member.displayName || 'Anonymous'}</td>
                                                    <td style={{ padding: '8px', color: '#aaa' }}>{member.email || 'N/A'}</td>
                                                    <td style={{ padding: '8px', color: '#ccc' }}>
                                                        <FaUser style={{ marginRight: '6px', color: '#03dac6', fontSize: '0.85rem', verticalAlign: 'middle' }} />
                                                        <span>{member.friends?.length || 0}</span>
                                                    </td>
                                                    <td style={{ padding: '8px', color: '#888' }}>{formatDateTime(member.lastActiveTime)}</td>
                                                    <td style={{ padding: '8px' }}>
                                                        <span style={{
                                                            padding: '2px 6px',
                                                            borderRadius: '4px',
                                                            fontSize: '0.75rem',
                                                            textTransform: 'capitalize',
                                                            background: member.tier === 'free' ? 'rgba(255,255,255,0.05)' : 'rgba(3, 218, 198, 0.1)',
                                                            color: member.tier === 'free' ? '#888' : '#03dac6',
                                                            fontWeight: 'bold'
                                                        }}>
                                                            {member.tier || 'free'}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '8px' }}>
                                                        <span style={{
                                                            padding: '2px 6px',
                                                            borderRadius: '4px',
                                                            fontSize: '0.75rem',
                                                            background: member.unlockedPersonalisePackage ? 'rgba(187, 134, 252, 0.15)' : 'rgba(255,255,255,0.05)',
                                                            color: member.unlockedPersonalisePackage ? '#bb86fc' : '#555',
                                                            fontWeight: 'bold'
                                                        }}>
                                                            {member.unlockedPersonalisePackage ? 'Unlocked' : 'No'}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold', color: member.hasPurchased ? '#03dac6' : '#666' }}>
                                                        {member.hasPurchased ? `£${member.totalSpent.toFixed(2)}` : 'Never Purchased'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ))}

                        {/* All Alone Section */}
                        <div className="billing-card" style={{ borderLeft: '4px solid #cf6679' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #333', paddingBottom: '0.5rem' }}>
                                <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#cf6679' }}>All Alone (Solo Users)</h3>
                                <div style={{ fontSize: '0.8rem', color: '#888' }}>
                                    Total Users: <strong>{groupedData.alone.length}</strong>
                                </div>
                            </div>

                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid #222', color: '#666' }}>
                                            <th style={{ padding: '8px' }}>User</th>
                                            <th style={{ padding: '8px' }}>Email</th>
                                            <th style={{ padding: '8px' }}>Friends</th>
                                            <th style={{ padding: '8px' }}>Last Active</th>
                                            <th style={{ padding: '8px' }}>Tier</th>
                                            <th style={{ padding: '8px' }}>Personalisation</th>
                                            <th style={{ padding: '8px', textAlign: 'right' }}>Total Spent</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {groupedData.alone.map(member => (
                                            <tr 
                                                key={member.uid} 
                                                onClick={() => {
                                                    setSelectedUserForAction(member);
                                                    setActionType('menu');
                                                }}
                                                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                                                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                                                style={{ borderBottom: '1px solid #2a2a2a', height: '40px', cursor: 'pointer', transition: 'background 0.2s' }}
                                            >
                                                <td style={{ padding: '8px', fontWeight: 'bold' }}>{member.displayName || 'Anonymous'}</td>
                                                <td style={{ padding: '8px', color: '#aaa' }}>{member.email || 'N/A'}</td>
                                                <td style={{ padding: '8px', color: '#ccc' }}>
                                                    <FaUser style={{ marginRight: '6px', color: '#03dac6', fontSize: '0.85rem', verticalAlign: 'middle' }} />
                                                    <span>{member.friends?.length || 0}</span>
                                                </td>
                                                <td style={{ padding: '8px', color: '#888' }}>{formatDateTime(member.lastActiveTime)}</td>
                                                <td style={{ padding: '8px' }}>
                                                    <span style={{
                                                        padding: '2px 6px',
                                                        borderRadius: '4px',
                                                        fontSize: '0.75rem',
                                                        textTransform: 'capitalize',
                                                        background: member.tier === 'free' ? 'rgba(255,255,255,0.05)' : 'rgba(3, 218, 198, 0.1)',
                                                        color: member.tier === 'free' ? '#888' : '#03dac6',
                                                        fontWeight: 'bold'
                                                    }}>
                                                        {member.tier || 'free'}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '8px' }}>
                                                    <span style={{
                                                        padding: '2px 6px',
                                                        borderRadius: '4px',
                                                        fontSize: '0.75rem',
                                                        background: member.unlockedPersonalisePackage ? 'rgba(187, 134, 252, 0.15)' : 'rgba(255,255,255,0.05)',
                                                        color: member.unlockedPersonalisePackage ? '#bb86fc' : '#555',
                                                        fontWeight: 'bold'
                                                    }}>
                                                        {member.unlockedPersonalisePackage ? 'Unlocked' : 'No'}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold', color: member.hasPurchased ? '#03dac6' : '#666' }}>
                                                    {member.hasPurchased ? `£${member.totalSpent.toFixed(2)}` : 'Never Purchased'}
                                                </td>
                                            </tr>
                                        ))}
                                        {groupedData.alone.length === 0 && (
                                            <tr>
                                                <td colSpan={7} style={{ padding: '1.5rem', textAlign: 'center', color: '#555' }}>
                                                    No solo users active.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100vh', background: '#121212', color: 'white', padding: '1.5rem', fontFamily: 'Inter, sans-serif' }}>
            <style>
                {`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .spin { animation: spin 1s linear infinite; }
                .billing-card {
                    background: #1e1e1e;
                    border-radius: 12px;
                    padding: 1.5rem;
                    border: 1px solid #333;
                }
                .status-badge {
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 0.7rem;
                    font-weight: bold;
                    text-transform: uppercase;
                }
                `}
            </style>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: 'white', padding: '10px', borderRadius: '50%', cursor: 'pointer' }}>
                        <FaChevronLeft />
                    </button>
                    <h1 style={{ margin: 0, fontSize: '1.8rem', background: 'linear-gradient(45deg, #03dac6, #bb86fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                        Billing Center
                    </h1>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                        onClick={() => {
                            onClose();
                            navigate('/all-users');
                        }}
                        style={{
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            color: 'white',
                            padding: '8px 16px',
                            borderRadius: '8px',
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                            fontWeight: 'bold',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                        }}
                    >
                        View All Users
                    </button>
                    <div 
                        onClick={() => {
                            const val = !hideDevLogs;
                            setHideDevLogs(val);
                            localStorage.setItem('hideDevLogs', String(val));
                        }}
                        style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '8px', 
                            cursor: 'pointer',
                            background: 'rgba(255,255,255,0.05)',
                            padding: '8px 16px',
                            borderRadius: '8px',
                            border: '1px solid rgba(255,255,255,0.1)',
                            userSelect: 'none'
                        }}
                    >
                        <span style={{ fontSize: '0.8rem', fontWeight: '600', color: '#ccc' }}>Hide Dev Logs</span>
                        <div style={{ width: '34px', height: '18px', background: hideDevLogs ? 'var(--primary, #03dac6)' : '#555', borderRadius: '9px', position: 'relative', transition: 'background 0.3s' }}>
                            <div style={{ width: '14px', height: '14px', background: 'white', borderRadius: '50%', position: 'absolute', top: '2px', left: hideDevLogs ? '18px' : '2px', transition: 'left 0.3s' }} />
                        </div>
                    </div>
                    {isDev && (
                        <button 
                            onClick={handleCleanup} 
                            disabled={cleaning}
                            style={{ 
                                background: 'rgba(207, 102, 121, 0.1)', 
                                border: '1px solid rgba(207, 102, 121, 0.3)', 
                                color: '#cf6679', 
                                padding: '8px 16px', 
                                borderRadius: '8px', 
                                fontSize: '0.8rem', 
                                cursor: cleaning ? 'not-allowed' : 'pointer',
                                fontWeight: 'bold'
                            }}
                        >
                            {cleaning ? 'Cleaning...' : 'Cleanup Old Records'}
                        </button>
                    )}
                </div>
            </div>

            {/* Stats Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                <div className="billing-card" style={{ textAlign: 'center' }}>
                    <FaDollarSign style={{ color: '#03dac6', marginBottom: '0.5rem' }} />
                    <div style={{ color: '#888', fontSize: '0.8rem' }}>Total Income</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>£{stats.totalIncome}</div>
                </div>
                <div className="billing-card" style={{ textAlign: 'center' }}>
                    <FaShoppingCart style={{ color: '#bb86fc', marginBottom: '0.5rem' }} />
                    <div style={{ color: '#888', fontSize: '0.8rem' }}>Total Sales</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{stats.totalSales}</div>
                </div>
                <div className="billing-card" style={{ textAlign: 'center' }}>
                    <FaStar style={{ color: '#ffc107', marginBottom: '0.5rem' }} />
                    <div style={{ color: '#888', fontSize: '0.8rem' }}>Most Purchased</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', textTransform: 'capitalize' }}>{stats.mostPurchasedTier}</div>
                </div>
                <div className="billing-card" style={{ textAlign: 'center' }}>
                    <FaChartLine style={{ color: '#888', marginBottom: '0.5rem' }} />
                    <div style={{ color: '#888', fontSize: '0.8rem' }}>Conversion</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
                        {stats.paymentsStarted > 0 ? Math.round((stats.totalSales / stats.paymentsStarted) * 100) : 0}%
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#555' }}>{stats.totalSales} / {stats.paymentsStarted} started</div>
                </div>
            </div>

            {/* Feed Section */}
            <div className="billing-card">
                <h3 style={{ marginTop: 0, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <FaHistory /> Payment Feed
                </h3>

                {error ? (
                    <div style={{ 
                        padding: '1.5rem', 
                        background: 'rgba(207, 102, 121, 0.1)', 
                        border: '1px solid #cf6679', 
                        borderRadius: '8px',
                        color: '#cf6679',
                        textAlign: 'center'
                    }}>
                        <FaTimesCircle style={{ fontSize: '2rem', marginBottom: '1rem' }} />
                        <h4>Access Denied or Connection Error</h4>
                        <p style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>{error}</p>
                        <p style={{ fontSize: '0.8rem', opacity: 0.8 }}>
                            Tip: Ensure your Firestore rules allow 'list' access on the 'purchases' collection for developers.
                        </p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {filteredPurchases.map(p => {
                        const isExpired = p.status === 'started' && (Date.now() - p.createdAt > 7200000); // 2 hours
                        const displayStatus = isExpired ? 'failed' : p.status;

                        return (
                        <div key={p.id} style={{ 
                            padding: '1rem', 
                            background: 'rgba(255,255,255,0.02)', 
                            borderRadius: '8px',
                            borderLeft: `4px solid ${displayStatus === 'completed' ? '#03dac6' : displayStatus === 'started' ? '#ffc107' : '#cf6679'}`,
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                        }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                                    <span>{p.userName || 'Anonymous'}</span>
                                    <span style={{ fontWeight: 'normal', color: '#666', fontSize: '0.8rem' }}>({p.userEmail})</span>
                                </div>
                                <div style={{ fontSize: '0.7rem', color: '#555', fontFamily: 'monospace', background: 'rgba(255,255,255,0.03)', padding: '2px 6px', borderRadius: '4px', display: 'inline-block', marginBottom: '4px' }}>
                                    ID: {p.id}
                                </div>
                                <div style={{ fontSize: '0.85rem', color: '#aaa' }}>
                                    Purchased <strong style={{ color: '#fff', textTransform: 'capitalize' }}>{p.tier}</strong> for <strong>{p.amount}</strong>
                                </div>
                                <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '6px', background: 'rgba(255,255,255,0.03)', padding: '4px 8px', borderRadius: '4px', display: 'inline-block' }}>
                                    📅 {new Date(p.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                                </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <span className="status-badge" style={{ 
                                    backgroundColor: displayStatus === 'completed' ? 'rgba(3, 218, 198, 0.1)' : displayStatus === 'started' ? 'rgba(255, 193, 7, 0.1)' : 'rgba(207, 102, 121, 0.1)',
                                    color: displayStatus === 'completed' ? '#03dac6' : displayStatus === 'started' ? '#ffc107' : '#cf6679'
                                }}>
                                    {displayStatus === 'completed' ? <FaCheckCircle style={{ marginRight: '4px' }} /> : displayStatus === 'started' ? <FaSpinner className="spin" style={{ marginRight: '4px' }} /> : <FaTimesCircle style={{ marginRight: '4px' }} />}
                                    {displayStatus}
                                </span>
                            </div>
                        </div>
                    )})}
                    {filteredPurchases.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '2rem', color: '#555' }}>No payment activity yet.</div>
                    )}
                </div>
                )}
            </div>
        </div>
    );
};

export default BillingPage;
