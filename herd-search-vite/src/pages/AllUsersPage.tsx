import { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, type DocumentData, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { 
    FaChevronLeft, FaSearch, FaUser, FaUserFriends, 
    FaMapMarkerAlt, FaClock, FaCheckCircle, FaTimesCircle, 
    FaDollarSign, FaSatellite, FaHistory,
    FaUsers, FaPaperPlane, FaUserPlus
} from 'react-icons/fa';

interface UserAuditData {
    uid: string;
    email?: string;
    displayName?: string;
    photoURL?: string;
    tier: string;
    lastUpdate?: number;
    currentArea?: string;
    useGps?: boolean;
    friends?: string[];
    squadId?: string;
    totalSpent: number;
    purchaseCount: number;
    squadSize: number;
    subscriptionExpiry?: number;
    sentSquadInvites?: number;
    sentFriendRequests?: number;
}

import { useNavigate } from 'react-router-dom';

const AllUsersPage: React.FC = () => {
    const navigate = useNavigate();
    const onClose = () => navigate('/');
    const [users, setUsers] = useState<DocumentData[]>([]);
    const [squads, setSquads] = useState<DocumentData[]>([]);
    const [purchases, setPurchases] = useState<DocumentData[]>([]);
    const [squadInvites, setSquadInvites] = useState<DocumentData[]>([]);
    const [friendRequests, setFriendRequests] = useState<DocumentData[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filter, setFilter] = useState<'all' | 'free' | 'paid'>('all');
    const [sortBy, setSortBy] = useState<'active' | 'money'>('active');
    const [selectedUserForAction, setSelectedUserForAction] = useState<any | null>(null);
    const [actionType, setActionType] = useState<'menu' | 'history' | 'override'>('menu');

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Initial fetch
                const usersSnap = await getDocs(collection(db, 'users'));
                const squadsSnap = await getDocs(collection(db, 'squads'));
                const purchasesSnap = await getDocs(collection(db, 'purchases'));
                const squadInvitesSnap = await getDocs(collection(db, 'squadInvites'));
                const friendRequestsSnap = await getDocs(collection(db, 'friendRequests'));

                setUsers(usersSnap.docs.map(d => ({ uid: d.id, ...d.data() })));
                setSquads(squadsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
                setPurchases(purchasesSnap.docs.map(d => d.data()));
                setSquadInvites(squadInvitesSnap.docs.map(d => d.data()));
                setFriendRequests(friendRequestsSnap.docs.map(d => d.data()));
                setLoading(false);
            } catch (err) {
                console.error("Error fetching audit data:", err);
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    const processedUsers = useMemo(() => {
        return users.map(u => {
            const userPurchases = purchases.filter(p => p.userId === u.uid || (p.userEmail && p.userEmail.toLowerCase() === u.email?.toLowerCase()));
            const completedPurchases = userPurchases.filter(p => p.status === 'completed');
            const totalSpent = completedPurchases.reduce((acc, p) => {
                const amount = parseFloat(p.amount?.replace('£', '')) || 0;
                return acc + amount;
            }, 0);

            // Calculate Squad Size
            let squadSize = 0;
            if (u.squadId) {
                const squad = squads.find(s => s.id === u.squadId);
                if (squad) {
                    squadSize = (squad.members || []).length;
                }
            }

            // Calculate Outgoing Squad Invites (pending)
            const sentSquadInvites = squadInvites.filter(inv => inv.from === u.uid && inv.status === 'pending').length;

            // Calculate Outgoing Friend Requests (pending)
            const sentFriendRequests = friendRequests.filter(req => req.from === u.uid && req.status === 'pending').length;

            return {
                ...u,
                totalSpent,
                purchaseCount: completedPurchases.length,
                squadSize,
                sentSquadInvites,
                sentFriendRequests
            } as UserAuditData;
        });
    }, [users, squads, purchases, squadInvites, friendRequests]);

    const formatDateTime = (timestamp?: number) => {
        if (!timestamp) return 'Never';
        const d = new Date(timestamp);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const groupedData = useMemo(() => {
        // 1. Filter processed users
        const processed = processedUsers.filter(u => {
            const matchesSearch = 
                (u.displayName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (u.email || '').toLowerCase().includes(searchTerm.toLowerCase());
            
            const matchesFilter = 
                filter === 'all' ||
                (filter === 'free' && u.tier === 'free') ||
                (filter === 'paid' && u.tier !== 'free');

            return matchesSearch && matchesFilter;
        });

        // 2. Separate users into Squads and Alone
        const squadGroups: Record<string, any> = {};
        const aloneUsers: any[] = [];

        processed.forEach(user => {
            if (user.squadId) {
                if (!squadGroups[user.squadId]) {
                    // Try to find the squad document
                    const sqDoc = squads.find(s => s.id === user.squadId);
                    const ownerName = sqDoc?.ownerName || `${user.displayName || 'Squad'}'s Squad`;
                    squadGroups[user.squadId] = {
                        squadId: user.squadId,
                        ownerName,
                        members: [],
                        totalSpent: 0,
                        maxLastActive: 0
                    };
                }
                squadGroups[user.squadId].members.push(user);
                squadGroups[user.squadId].totalSpent += user.totalSpent;
                if ((user.lastUpdate || 0) > squadGroups[user.squadId].maxLastActive) {
                    squadGroups[user.squadId].maxLastActive = user.lastUpdate || 0;
                }
            } else {
                aloneUsers.push(user);
            }
        });

        // Convert squad groups to array
        const squadsList = Object.values(squadGroups);

        // 3. Sort squads and solo users
        if (sortBy === 'money') {
            squadsList.sort((a: any, b: any) => b.totalSpent - a.totalSpent);
            aloneUsers.sort((a, b) => b.totalSpent - a.totalSpent);
        } else {
            squadsList.sort((a: any, b: any) => b.maxLastActive - a.maxLastActive);
            aloneUsers.sort((a, b) => (b.lastUpdate || 0) - (a.lastUpdate || 0));
        }

        // Sort members within squads
        squadsList.forEach((sq: any) => {
            if (sortBy === 'money') {
                sq.members.sort((a: any, b: any) => b.totalSpent - a.totalSpent);
            } else {
                sq.members.sort((a: any, b: any) => (b.lastUpdate || 0) - (a.lastUpdate || 0));
            }
        });

        return {
            squads: squadsList,
            alone: aloneUsers
        };
    }, [processedUsers, squads, sortBy, searchTerm, filter]);



    if (loading) {
        return (
            <div style={{ position: 'fixed', inset: 0, background: '#0f0f1a', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10001 }}>
                <div style={{ textAlign: 'center' }}>
                    <div className="spin" style={{ fontSize: '3rem', color: '#03dac6', marginBottom: '1rem' }}><FaSatellite /></div>
                    <p>Scanning Network...</p>
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

                    <div style={{ background: '#1e1e1e', borderRadius: '12px', padding: '1.5rem', border: '1px solid #333', display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '500px', margin: '0 auto' }}>
                        <h3 style={{ margin: 0, fontSize: '1.2rem', textAlign: 'center', marginBottom: '1rem' }}>Select Action</h3>
                        
                        <button 
                            onClick={() => setActionType('history')}
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
            const userHistory = purchases.filter(p => p.userId === selectedUserForAction.uid || (p.userEmail && p.userEmail.toLowerCase() === selectedUserForAction.email?.toLowerCase()));
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
                    <div style={{ background: '#1e1e1e', borderRadius: '12px', padding: '1.5rem', border: '1px solid #333' }}>
                        <h3 style={{ marginTop: 0, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <FaHistory /> Transactions ({userHistory.length})
                        </h3>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {userHistory.map((p: any, idx: number) => {
                                const isExpired = p.status === 'started' && (Date.now() - p.createdAt > 7200000);
                                const displayStatus = isExpired ? 'failed' : p.status;
                                const isPersonalisation = p.tier === 'personalise_package';

                                return (
                                    <div key={p.id || idx} style={{ 
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
                                                {isPersonalisation ? 'Personalisation Package' : `Tier: ${p.tier?.toUpperCase()}`}
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: '#666', fontFamily: 'monospace', marginTop: '2px' }}>
                                                Transaction ID: {p.id || 'N/A'}
                                            </div>
                                            <div style={{ fontSize: '0.9rem', color: '#ccc', marginTop: '6px' }}>
                                                Price: <strong style={{ color: '#fff' }}>{p.amount}</strong>
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '6px' }}>
                                                📅 {p.createdAt ? new Date(p.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown Date'}
                                            </div>
                                        </div>
                                        <div>
                                            <span style={{ 
                                                padding: '4px 8px',
                                                borderRadius: '4px',
                                                fontSize: '0.7rem',
                                                fontWeight: 'bold',
                                                textTransform: 'uppercase',
                                                backgroundColor: displayStatus === 'completed' ? 'rgba(3, 218, 198, 0.1)' : displayStatus === 'started' ? 'rgba(255, 193, 7, 0.1)' : 'rgba(207, 102, 121, 0.1)',
                                                color: displayStatus === 'completed' ? '#03dac6' : displayStatus === 'started' ? '#ffc107' : '#cf6679',
                                                display: 'inline-flex',
                                                alignItems: 'center'
                                            }}>
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

                    <div style={{ background: '#1e1e1e', borderRadius: '12px', padding: '1.5rem', border: '1px solid #333', display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '500px', margin: '0 auto' }}>
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
                                            isPaymentPending: false,
                                            lastOverrideTime: Date.now()
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

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            background: 'radial-gradient(circle at bottom left, #121212, #000000)',
            color: 'white',
            zIndex: 10001,
            display: 'flex',
            flexDirection: 'column',
            fontFamily: 'Inter, system-ui, sans-serif'
        }}>
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
                `}
            </style>

            {/* Header */}
            <div style={{
                padding: '1.5rem',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                display: 'flex',
                alignItems: 'center',
                gap: '1rem'
            }}>
                <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: 'white', padding: '12px', borderRadius: '50%', cursor: 'pointer' }}>
                    <FaChevronLeft />
                </button>
                <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 'bold' }}>All Active Users</h1>
                <div style={{ marginLeft: 'auto', background: 'rgba(3, 218, 198, 0.1)', color: '#03dac6', padding: '4px 12px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 'bold' }}>
                    {processedUsers.length} TOTAL
                </div>
            </div>

            {/* Controls */}
            <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem', background: 'rgba(255,255,255,0.02)' }}>
                <div style={{ position: 'relative' }}>
                    <FaSearch style={{ position: 'absolute', left: '15px', top: '50%', transform: 'translateY(-50%)', color: '#666' }} />
                    <input 
                        type="text" 
                        placeholder="Search name or email..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '12px 12px 12px 45px',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '12px',
                            color: 'white',
                            fontSize: '0.9rem'
                        }}
                    />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'space-between' }}>
                    {/* Filter Segmented Control */}
                    <div style={{ display: 'flex', gap: '0.3rem', flex: 1 }}>
                        {['all', 'free', 'paid'].map(t => (
                            <button
                                key={t}
                                onClick={() => setFilter(t as any)}
                                style={{
                                    flex: 1,
                                    padding: '8px 12px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: filter === t ? '#bb86fc' : 'rgba(255,255,255,0.05)',
                                    color: filter === t ? 'black' : '#aaa',
                                    fontWeight: 'bold',
                                    fontSize: '0.8rem',
                                    textTransform: 'capitalize',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                            >
                                {t}
                            </button>
                        ))}
                    </div>

                    {/* Sorting Segmented Control */}
                    <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', padding: '3px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <button 
                            onClick={() => setSortBy('active')}
                            style={{
                                background: sortBy === 'active' ? 'var(--primary, #03dac6)' : 'transparent',
                                border: 'none',
                                color: sortBy === 'active' ? '#000' : '#aaa',
                                padding: '6px 12px',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontSize: '0.75rem',
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
                                fontSize: '0.75rem',
                                fontWeight: 'bold',
                                transition: 'all 0.2s'
                            }}
                        >
                            Money Spent
                        </button>
                    </div>
                </div>
            </div>

            {/* Grouped User Directory List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                
                {/* Squads */}
                {groupedData.squads.map((squad: any) => (
                    <div key={squad.squadId} className="billing-card" style={{ borderLeft: '4px solid #bb86fc' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #333', paddingBottom: '0.5rem' }}>
                            <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#bb86fc' }}>{squad.ownerName}</h3>
                            <div style={{ fontSize: '0.8rem', color: '#888', display: 'flex', gap: '15px' }}>
                                <span>Total Squad Spent: <strong style={{ color: '#03dac6' }}>£{squad.totalSpent.toFixed(2)}</strong></span>
                                <span>Most Active: <strong>{formatDateTime(squad.maxLastActive)}</strong></span>
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {squad.members.map((user: any) => (
                                <div 
                                    key={user.uid} 
                                    onClick={() => {
                                        setSelectedUserForAction(user);
                                        setActionType('menu');
                                    }}
                                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                                    style={{
                                        background: 'rgba(255,255,255,0.03)',
                                        borderRadius: '16px',
                                        padding: '1.25rem',
                                        border: '1px solid rgba(255,255,255,0.05)',
                                        position: 'relative',
                                        cursor: 'pointer',
                                        transition: 'background 0.2s'
                                    }}
                                >
                                    {/* Tier Badge */}
                                    <div style={{
                                        position: 'absolute',
                                        top: 0, right: 0,
                                        background: user.tier === 'free' ? '#444' : 'linear-gradient(135deg, #03dac6, #018786)',
                                        padding: '4px 12px',
                                        borderBottomLeftRadius: '12px',
                                        fontSize: '0.7rem',
                                        fontWeight: 'bold',
                                        textTransform: 'uppercase'
                                    }}>
                                        {user.tier}
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                                        <div style={{ position: 'relative' }}>
                                            {user.photoURL ? (
                                                <img src={user.photoURL} alt="" style={{ width: '50px', height: '50px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.1)' }} />
                                            ) : (
                                                <div style={{ width: '50px', height: '50px', borderRadius: '50%', background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <FaUser color="#666" />
                                                </div>
                                            )}
                                            {user.lastUpdate && (Date.now() - user.lastUpdate < 300000) && (
                                                <div style={{ position: 'absolute', bottom: 0, right: 0, width: '12px', height: '12px', borderRadius: '50%', background: '#03dac6', border: '2px solid #121212' }} />
                                            )}
                                        </div>
                                        <div>
                                            <h3 style={{ margin: 0, fontSize: '1rem' }}>{user.displayName || 'Anonymous'}</h3>
                                            <p style={{ margin: 0, fontSize: '0.8rem', color: '#aaa' }}>{user.email}</p>
                                        </div>
                                    </div>

                                    {/* Info Grid */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.8rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#aaa' }}>
                                            <FaClock size={12} /> {formatDateTime(user.lastUpdate)}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#aaa' }}>
                                            <FaMapMarkerAlt size={12} /> {user.currentArea || 'Unknown'}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: user.useGps ? '#03dac6' : '#ff6b6b' }}>
                                            {user.useGps ? <FaCheckCircle size={12} /> : <FaTimesCircle size={12} />} GPS {user.useGps ? 'ON' : 'OFF'}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ccc' }}>
                                            <FaUserFriends size={12} style={{ color: '#03dac6' }} /> {user.friends?.length || 0} Friends
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ccc' }}>
                                            <FaUsers size={12} style={{ color: '#bb86fc' }} /> Squad Size: {user.squadSize || 0}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ccc' }}>
                                            <FaPaperPlane size={12} style={{ color: '#03dac6' }} /> Sent Invites: {user.sentSquadInvites || 0}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ccc' }}>
                                            <FaUserPlus size={12} style={{ color: '#03dac6' }} /> Friend Requests Out: {user.sentFriendRequests || 0}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: user.unlockedPersonalisePackage ? '#bb86fc' : '#555', fontWeight: 'bold' }}>
                                            Personalisation: {user.unlockedPersonalisePackage ? 'Unlocked' : 'No'}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: user.totalSpent > 0 ? '#03dac6' : '#666', fontWeight: user.totalSpent > 0 ? 'bold' : 'normal' }}>
                                            <FaDollarSign size={12} /> £{user.totalSpent.toFixed(2)} spent
                                        </div>
                                    </div>
                                    {user.tier !== 'free' && (
                                        <div style={{ marginTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.75rem', fontSize: '0.8rem', color: '#ffb74d', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <span>⏳ Tier Expires: <strong>{formatDateTime(user.subscriptionExpiry)}</strong></span>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                ))}

                {/* Solo Users ("All Alone") */}
                <div className="billing-card" style={{ borderLeft: '4px solid #cf6679' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #333', paddingBottom: '0.5rem' }}>
                        <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#cf6679' }}>All Alone (Solo Users)</h3>
                        <div style={{ fontSize: '0.8rem', color: '#888' }}>
                            Total Users: <strong>{groupedData.alone.length}</strong>
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {groupedData.alone.map((user: any) => (
                            <div 
                                key={user.uid} 
                                onClick={() => {
                                    setSelectedUserForAction(user);
                                    setActionType('menu');
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                                style={{
                                    background: 'rgba(255,255,255,0.03)',
                                    borderRadius: '16px',
                                    padding: '1.25rem',
                                    border: '1px solid rgba(255,255,255,0.05)',
                                    position: 'relative',
                                    cursor: 'pointer',
                                    transition: 'background 0.2s'
                                }}
                            >
                                {/* Tier Badge */}
                                <div style={{
                                    position: 'absolute',
                                    top: 0, right: 0,
                                    background: user.tier === 'free' ? '#444' : 'linear-gradient(135deg, #03dac6, #018786)',
                                    padding: '4px 12px',
                                    borderBottomLeftRadius: '12px',
                                    fontSize: '0.7rem',
                                    fontWeight: 'bold',
                                    textTransform: 'uppercase'
                                }}>
                                    {user.tier}
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                                    <div style={{ position: 'relative' }}>
                                        {user.photoURL ? (
                                            <img src={user.photoURL} alt="" style={{ width: '50px', height: '50px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.1)' }} />
                                        ) : (
                                            <div style={{ width: '50px', height: '50px', borderRadius: '50%', background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <FaUser color="#666" />
                                            </div>
                                        )}
                                        {user.lastUpdate && (Date.now() - user.lastUpdate < 300000) && (
                                            <div style={{ position: 'absolute', bottom: 0, right: 0, width: '12px', height: '12px', borderRadius: '50%', background: '#03dac6', border: '2px solid #121212' }} />
                                        )}
                                    </div>
                                    <div>
                                        <h3 style={{ margin: 0, fontSize: '1rem' }}>{user.displayName || 'Anonymous'}</h3>
                                        <p style={{ margin: 0, fontSize: '0.8rem', color: '#aaa' }}>{user.email}</p>
                                    </div>
                                </div>

                                {/* Info Grid */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.8rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#aaa' }}>
                                        <FaClock size={12} /> {formatDateTime(user.lastUpdate)}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#aaa' }}>
                                        <FaMapMarkerAlt size={12} /> {user.currentArea || 'Unknown'}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: user.useGps ? '#03dac6' : '#ff6b6b' }}>
                                        {user.useGps ? <FaCheckCircle size={12} /> : <FaTimesCircle size={12} />} GPS {user.useGps ? 'ON' : 'OFF'}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ccc' }}>
                                        <FaUserFriends size={12} style={{ color: '#03dac6' }} /> {user.friends?.length || 0} Friends
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ccc' }}>
                                        <FaUsers size={12} style={{ color: '#bb86fc' }} /> Squad Size: {user.squadSize || 0}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ccc' }}>
                                        <FaPaperPlane size={12} style={{ color: '#03dac6' }} /> Sent Invites: {user.sentSquadInvites || 0}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ccc' }}>
                                        <FaUserPlus size={12} style={{ color: '#03dac6' }} /> Friend Requests Out: {user.sentFriendRequests || 0}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: user.unlockedPersonalisePackage ? '#bb86fc' : '#555', fontWeight: 'bold' }}>
                                        Personalisation: {user.unlockedPersonalisePackage ? 'Unlocked' : 'No'}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: user.totalSpent > 0 ? '#03dac6' : '#666', fontWeight: user.totalSpent > 0 ? 'bold' : 'normal' }}>
                                        <FaDollarSign size={12} /> £{user.totalSpent.toFixed(2)} spent
                                    </div>
                                </div>
                                {user.tier !== 'free' && (
                                    <div style={{ marginTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.75rem', fontSize: '0.8rem', color: '#ffb74d', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span>⏳ Tier Expires: <strong>{formatDateTime(user.subscriptionExpiry)}</strong></span>
                                    </div>
                                )}
                            </div>
                        ))}
                        {groupedData.alone.length === 0 && (
                            <div style={{ textAlign: 'center', padding: '2rem', color: '#555' }}>No solo users active.</div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
};

export default AllUsersPage;
