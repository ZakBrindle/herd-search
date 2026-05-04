import { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, onSnapshot, query, where, type DocumentData } from 'firebase/firestore';
import { db } from '../firebase';
import { 
    FaChevronLeft, FaSearch, FaFilter, FaUser, FaUserFriends, 
    FaMapMarkerAlt, FaClock, FaCheckCircle, FaTimesCircle, 
    FaDollarSign, FaCrown, FaUsers, FaSatellite 
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
}

interface AllUsersPageProps {
    onClose: () => void;
}

const AllUsersPage: React.FC<AllUsersPageProps> = ({ onClose }) => {
    const [users, setUsers] = useState<DocumentData[]>([]);
    const [squads, setSquads] = useState<DocumentData[]>([]);
    const [purchases, setPurchases] = useState<DocumentData[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filter, setFilter] = useState<'all' | 'free' | 'paid'>('all');

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Initial fetch
                const usersSnap = await getDocs(collection(db, 'users'));
                const squadsSnap = await getDocs(collection(db, 'squads'));
                const purchasesSnap = await getDocs(query(collection(db, 'purchases'), where('status', '==', 'completed')));

                setUsers(usersSnap.docs.map(d => ({ uid: d.id, ...d.data() })));
                setSquads(squadsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
                setPurchases(purchasesSnap.docs.map(d => d.data()));
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
            // Calculate Total Spent
            const userPurchases = purchases.filter(p => p.userId === u.uid || (p.userEmail && p.userEmail.toLowerCase() === u.email?.toLowerCase()));
            const totalSpent = userPurchases.reduce((acc, p) => {
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

            return {
                ...u,
                totalSpent,
                purchaseCount: userPurchases.length,
                squadSize
            } as UserAuditData;
        });
    }, [users, squads, purchases]);

    const filteredUsers = useMemo(() => {
        return processedUsers.filter(u => {
            const matchesSearch = 
                (u.displayName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (u.email || '').toLowerCase().includes(searchTerm.toLowerCase());
            
            const matchesFilter = 
                filter === 'all' ||
                (filter === 'free' && u.tier === 'free') ||
                (filter === 'paid' && u.tier !== 'free');

            return matchesSearch && matchesFilter;
        }).sort((a, b) => (b.lastUpdate || 0) - (a.lastUpdate || 0));
    }, [processedUsers, searchTerm, filter]);

    const formatTime = (ts?: number) => {
        if (!ts) return 'Never';
        const now = Date.now();
        const diff = now - ts;
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        return new Date(ts).toLocaleDateString();
    };

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
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {['all', 'free', 'paid'].map(t => (
                        <button
                            key={t}
                            onClick={() => setFilter(t as any)}
                            style={{
                                flex: 1,
                                padding: '10px',
                                borderRadius: '10px',
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
            </div>

            {/* User List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {filteredUsers.map(user => (
                        <div key={user.uid} style={{
                            background: 'rgba(255,255,255,0.03)',
                            borderRadius: '16px',
                            padding: '1.25rem',
                            border: '1px solid rgba(255,255,255,0.05)',
                            position: 'relative',
                            overflow: 'hidden'
                        }}>
                            {/* Tier Badge */}
                            <div style={{
                                position: 'absolute',
                                top: 0, right: 0,
                                background: user.tier === 'free' ? '#444' : 'linear-gradient(135deg, #fdbb2d, #b21f1f)',
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
                                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#666' }}>{user.email}</p>
                                </div>
                            </div>

                            {/* Info Grid */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.8rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#aaa' }}>
                                    <FaClock size={12} /> {formatTime(user.lastUpdate)}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#aaa' }}>
                                    <FaMapMarkerAlt size={12} /> {user.currentArea || 'Unknown'}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: user.useGps ? '#03dac6' : '#ff6b6b' }}>
                                    {user.useGps ? <FaCheckCircle size={12} /> : <FaTimesCircle size={12} />} GPS {user.useGps ? 'ON' : 'OFF'}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#aaa' }}>
                                    <FaUserFriends size={12} /> {user.friends?.length || 0} Friends
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: user.squadId ? '#bb86fc' : '#444' }}>
                                    <FaUsers size={12} /> {user.squadId ? `${user.squadSize} in Squad` : 'No Squad'}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: user.totalSpent > 0 ? '#fdbb2d' : '#666', fontWeight: user.totalSpent > 0 ? 'bold' : 'normal' }}>
                                    <FaDollarSign size={12} /> £{user.totalSpent.toFixed(2)} ({user.purchaseCount})
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default AllUsersPage;
