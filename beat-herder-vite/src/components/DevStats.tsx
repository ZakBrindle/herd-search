import { useState, useEffect } from 'react';
import { collection, getDocs, type DocumentData } from 'firebase/firestore';
import { db } from '../firebase';
import { FaUserFriends, FaMapMarkerAlt } from 'react-icons/fa';

type StatData = {
    activeUsers1h: number;
    activeUsers24h: number;
    activeUsers1w: number;
    usersPerTier: { [key: string]: number };
    freeUsersInOtherSquads: number;
    multiPersonSquads: number;
    top3Places: { name: string; count: number }[];
};

export default function DevStats({ onClose }: { onClose: () => void }) {
    const [stats, setStats] = useState<StatData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                setLoading(true);

                // Fetch all users (WARNING: potentially expensive in production)
                const usersSnapshot = await getDocs(collection(db, 'users'));
                const users = usersSnapshot.docs.map(doc => doc.data() as DocumentData);

                // Fetch all squads
                const squadsSnapshot = await getDocs(collection(db, 'squads'));
                const squads = squadsSnapshot.docs.map(doc => doc.data() as DocumentData);

                const now = Date.now();
                const oneHour = 60 * 60 * 1000;
                const oneDay = 24 * 60 * 60 * 1000;
                const oneWeek = 7 * 24 * 60 * 60 * 1000;

                // Active Users
                const activeUsers1h = users.filter(u => u.lastUpdate && (now - u.lastUpdate < oneHour)).length;
                const activeUsers24h = users.filter(u => u.lastUpdate && (now - u.lastUpdate < oneDay)).length;
                const activeUsers1w = users.filter(u => u.lastUpdate && (now - u.lastUpdate < oneWeek)).length;

                // Users Per Tier
                const usersPerTier: { [key: string]: number } = {};
                users.forEach(u => {
                    const tier = u.tier || 'free';
                    usersPerTier[tier] = (usersPerTier[tier] || 0) + 1;
                });

                // Free users in other squads
                // Criteria: Tier is free, has a squadId, and they are NOT the owner of that squad
                const freeUsersInOtherSquads = users.filter(u =>
                    (u.tier === 'free' || !u.tier) &&
                    u.squadId &&
                    u.squadOwnerId !== u.uid
                ).length;

                // Squads with > 1 person
                const multiPersonSquads = squads.filter(s => s.members && s.members.length > 1).length;

                // Top 3 Places (based on users active in last hour)
                const activeUsers = users.filter(u => u.lastUpdate && (now - u.lastUpdate < oneHour));
                const placeCounts: { [key: string]: number } = {};
                activeUsers.forEach(u => {
                    if (u.currentArea && u.currentArea !== 'Out of bounds' && u.currentArea !== 'unknown') {
                        placeCounts[u.currentArea] = (placeCounts[u.currentArea] || 0) + 1;
                    }
                });

                const top3Places = Object.entries(placeCounts)
                    .map(([name, count]) => ({ name, count }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 3);

                setStats({
                    activeUsers1h,
                    activeUsers24h,
                    activeUsers1w,
                    usersPerTier,
                    freeUsersInOtherSquads,
                    multiPersonSquads,
                    top3Places
                });
            } catch (e) {
                console.error("Error fetching stats:", e);
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, []);

    if (loading) {
        return (
            <div style={{ padding: '2rem', textAlign: 'center' }}>
                <div className="spinner" style={{
                    width: '30px',
                    height: '30px',
                    border: '4px solid rgba(255,255,255,0.1)',
                    borderTop: '4px solid var(--primary)',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                    margin: '0 auto 1rem auto'
                }}></div>
                <p>Crunching the numbers...</p>
            </div>
        );
    }

    if (!stats) return <div style={{ padding: '2rem' }}>Failed to load stats.</div>;

    return (
        <div style={{ padding: '1rem', color: 'white' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h2 style={{ margin: 0, color: 'var(--primary)' }}>Developer Stats</h2>
                <button onClick={onClose} className="btn" style={{ background: 'transparent', border: '1px solid #444' }}>Close</button>
            </div>

            <div className="card" style={{ flexDirection: 'column', alignItems: 'flex-start', marginBottom: '1rem', background: '#222' }}>
                <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}><FaUserFriends /> Active Users</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', width: '100%', marginTop: '0.5rem' }}>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#03dac6' }}>{stats.activeUsers1h}</div>
                        <div style={{ fontSize: '0.8rem', color: '#aaa' }}>Last Hour</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#bb86fc' }}>{stats.activeUsers24h}</div>
                        <div style={{ fontSize: '0.8rem', color: '#aaa' }}>24h</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{stats.activeUsers1w}</div>
                        <div style={{ fontSize: '0.8rem', color: '#aaa' }}>7 Days</div>
                    </div>
                </div>
            </div>

            <div className="card" style={{ flexDirection: 'column', alignItems: 'flex-start', marginBottom: '1rem', background: '#222' }}>
                <h3 style={{ marginTop: 0 }}>👥 Squad & Tier Metrics</h3>
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Multi-person Squads:</span>
                        <strong>{stats.multiPersonSquads}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Free Users in Others' Squads:</span>
                        <strong>{stats.freeUsersInOtherSquads}</strong>
                    </div>
                    <div style={{ marginTop: '8px', borderTop: '1px solid #444', paddingTop: '8px' }}>
                        <strong>Users per Tier:</strong>
                        {Object.entries(stats.usersPerTier).map(([tier, count]) => (
                            <div key={tier} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginTop: '4px' }}>
                                <span style={{ textTransform: 'capitalize' }}>{tier}</span>
                                <span>{count}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="card" style={{ flexDirection: 'column', alignItems: 'flex-start', background: '#222' }}>
                <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}><FaMapMarkerAlt /> Top Busiest Areas (1h)</h3>
                {stats.top3Places.length === 0 ? (
                    <p style={{ color: '#aaa', fontStyle: 'italic' }}>No activity in known areas recently.</p>
                ) : (
                    <div style={{ width: '100%' }}>
                        {stats.top3Places.map((place, index) => (
                            <div key={place.name} style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                padding: '8px',
                                background: index === 0 ? 'rgba(187, 134, 252, 0.1)' : 'transparent',
                                borderBottom: index < 2 ? '1px solid #333' : 'none'
                            }}>
                                <span>#{index + 1} {place.name}</span>
                                <strong>{place.count} users</strong>
                            </div>
                        ))}
                    </div>
                )}
            </div>

        </div>
    );
}
