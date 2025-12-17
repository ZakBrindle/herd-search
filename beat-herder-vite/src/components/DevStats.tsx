import { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, type DocumentData } from 'firebase/firestore';
import { db } from '../firebase';
import { FaMapMarkerAlt, FaChartBar, FaGlobe, FaTimes, FaCalendarAlt } from 'react-icons/fa';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell, LineChart, Line
} from 'recharts';

type Tier = 'free' | 'basic' | 'standard' | 'premium' | 'festival' | 'dev_tier_test';

type UserData = {
    uid: string;
    tier?: Tier;
    lastUpdate?: number; // timestamp
    currentArea?: string;
    squadId?: string;
    squadOwnerId?: string;
    // ... other fields
};

type Props = {
    onClose: () => void;
    currentMapFilter: '5m' | '30m' | '1h' | '24h' | null;
    onSetMapFilter: (filter: '5m' | '30m' | '1h' | '24h' | null) => void;
};

const COLORS = ['#03dac6', '#bb86fc', '#cf6679', '#018786', '#3700b3', '#ffc107', '#ff6b6b'];

export default function DevStats({ onClose, currentMapFilter, onSetMapFilter }: Props) {
    const [users, setUsers] = useState<UserData[]>([]);
    const [squads, setSquads] = useState<DocumentData[]>([]);
    const [loading, setLoading] = useState(true);
    const [timeFrame, setTimeFrame] = useState<'1h' | '24h' | '7d' | '30d'>('24h');

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);
                const usersSnap = await getDocs(collection(db, 'users'));
                const squadsSnap = await getDocs(collection(db, 'squads'));

                setUsers(usersSnap.docs.map(d => d.data() as UserData));
                setSquads(squadsSnap.docs.map(d => d.data()));
            } catch (error) {
                console.error("Error fetching stats data:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    // --- Computed Stats based on TimeFrame ---
    const stats = useMemo(() => {
        const now = Date.now();
        let ms = 0;
        switch (timeFrame) {
            case '1h': ms = 3600 * 1000; break;
            case '24h': ms = 24 * 3600 * 1000; break;
            case '7d': ms = 7 * 24 * 3600 * 1000; break;
            case '30d': ms = 30 * 24 * 3600 * 1000; break;
        }

        const activeUsers = users.filter(u => u.lastUpdate && (now - u.lastUpdate < ms));

        // 1. Tiers Distribution (Among Active Users)
        const tierCounts: { [key: string]: number } = {};
        activeUsers.forEach(u => {
            const t = u.tier || 'free';
            tierCounts[t] = (tierCounts[t] || 0) + 1;
        });
        const tierData = Object.entries(tierCounts).map(([name, value]) => ({ name, value }));

        // 2. Top Areas (Among Active Users)
        const areaCounts: { [key: string]: number } = {};
        activeUsers.forEach(u => {
            if (u.currentArea && u.currentArea !== 'Out of bounds' && u.currentArea !== 'unknown') {
                areaCounts[u.currentArea] = (areaCounts[u.currentArea] || 0) + 1;
            }
        });
        const topAreasData = Object.entries(areaCounts)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10); // Top 10

        // 3. Activity Over Time (Histogram-ish) - Bucketize active users by when they were last seen
        // This is a bit tricky with just 'lastUpdate', as it's a snapshot. 
        // We can show "Last Seen Distribution" within the timeframe.
        const timeBuckets: { [key: string]: number } = {};
        // Determine bucket size
        let bucketSize = ms / 12; // 12 points
        let dateFormat: (ts: number) => string = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (timeFrame === '7d' || timeFrame === '30d') {
            dateFormat = (ts) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
        }

        // Initialize buckets
        for (let i = 11; i >= 0; i--) {
            const t = now - (i * bucketSize);
            const label = dateFormat(t);
            timeBuckets[label] = 0;
        }



        // Simpler approach: Just map users to closest bucket point
        const timelineDataArray: { time: string; count: number, sortKey: number }[] = [];
        for (let i = 11; i >= 0; i--) {
            const tStart = now - ((i + 1) * bucketSize);
            const tEnd = now - (i * bucketSize);
            const count = activeUsers.filter(u => u.lastUpdate && u.lastUpdate > tStart && u.lastUpdate <= tEnd).length;
            timelineDataArray.push({
                time: dateFormat(tEnd),
                count,
                sortKey: tEnd
            });
        }

        // 4. Squad Metrics (General, not just active users, usually) based on active users presence?
        // Let's stick to showing stats for the filtered users + general context.
        const multiPersonSquads = squads.filter(s => s.members && s.members.length > 1).length;
        const totalSquads = squads.length;

        return {
            totalActive: activeUsers.length,
            tierData,
            topAreasData,
            timelineData: timelineDataArray,
            multiPersonSquads,
            totalSquads
        };

    }, [users, squads, timeFrame]);

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'white' }}>
                <div className="spinner" style={{ width: 40, height: 40, border: '4px solid #333', borderTopColor: '#03dac6', borderRadius: '50%', animation: 'spin 1s infinite' }} />
                <p style={{ marginTop: '1rem' }}>Loading Analytics...</p>
            </div>
        );
    }

    return (
        <div style={{ padding: '2rem', color: '#e0e0e0', minHeight: '100vh', background: '#121212', fontFamily: 'Inter, sans-serif' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <h1 style={{ margin: 0, fontSize: '2rem', background: 'linear-gradient(45deg, #03dac6, #bb86fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                        Mission Control
                    </h1>
                    <span style={{ background: '#333', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', color: '#888' }}>BETA</span>
                </div>
                <button onClick={onClose} className="btn" style={{ background: 'transparent', border: '1px solid #444', color: '#fff', fontSize: '1.5rem', cursor: 'pointer', padding: '8px' }}>
                    <FaTimes />
                </button>
            </div>

            {/* Controls Bar */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap', alignItems: 'center', background: '#1e1e1e', padding: '1rem', borderRadius: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginRight: 'auto' }}>
                    <FaCalendarAlt color="#888" />
                    <span style={{ color: '#888', marginRight: '0.5rem' }}>Timeframe:</span>
                    {['1h', '24h', '7d', '30d'].map(tf => (
                        <button
                            key={tf}
                            onClick={() => setTimeFrame(tf as any)}
                            style={{
                                background: timeFrame === tf ? 'rgba(187, 134, 252, 0.2)' : 'transparent',
                                border: timeFrame === tf ? '1px solid #bb86fc' : '1px solid #444',
                                color: timeFrame === tf ? '#bb86fc' : '#aaa',
                                padding: '6px 12px',
                                borderRadius: '20px',
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                            }}
                        >
                            {tf}
                        </button>
                    ))}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span style={{ color: '#888' }}>Global Map Overlay:</span>
                    <button
                        onClick={() => onSetMapFilter(currentMapFilter ? null : '1h')}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            background: currentMapFilter ? 'rgba(3, 218, 198, 0.2)' : 'transparent',
                            border: currentMapFilter ? '1px solid #03dac6' : '1px solid #444',
                            color: currentMapFilter ? '#03dac6' : '#aaa',
                            padding: '8px 16px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontWeight: 'bold'
                        }}
                    >
                        <FaGlobe />
                        {currentMapFilter ? 'Showing Active Users (ON)' : 'Show Active Users on Map'}
                    </button>
                    {currentMapFilter && (
                        <span style={{ fontSize: '0.8rem', color: '#ff6b6b' }}>
                            (Close stats to view map)
                        </span>
                    )}
                </div>
            </div>

            {/* Content Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>

                {/* 1. Key Metrics Cards */}
                <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                    <div className="card" style={{ background: '#1e1e1e', padding: '1.5rem', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <span style={{ color: '#888', marginBottom: '0.5rem' }}>Active Users ({timeFrame})</span>
                        <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#03dac6' }}>{stats.totalActive}</div>
                    </div>
                    <div className="card" style={{ background: '#1e1e1e', padding: '1.5rem', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <span style={{ color: '#888', marginBottom: '0.5rem' }}>Total Squads</span>
                        <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#bb86fc' }}>{stats.totalSquads}</div>
                        <span style={{ fontSize: '0.8rem', color: '#666' }}>{stats.multiPersonSquads} have {'>'}1 member</span>
                    </div>
                </div>

                {/* 2. Top Areas Chart */}
                <div style={{ background: '#1e1e1e', padding: '1.5rem', borderRadius: '12px', minHeight: '400px', gridColumn: 'span 2' }}>
                    <h3 style={{ marginTop: 0, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FaMapMarkerAlt color="#03dac6" /> Top 10 Busiest Areas
                    </h3>
                    <div style={{ width: '100%', height: '300px' }}>
                        {stats.topAreasData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={stats.topAreasData} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#333" horizontal={false} />
                                    <XAxis type="number" stroke="#666" />
                                    <YAxis type="category" dataKey="name" stroke="#ccc" width={100} tick={{ fontSize: 12 }} />
                                    <Tooltip contentStyle={{ backgroundColor: '#333', borderColor: '#555' }} />
                                    <Bar dataKey="count" fill="#bb86fc" radius={[0, 4, 4, 0]}>
                                        {stats.topAreasData.map((_entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}>
                                No location data for this timeframe.
                            </div>
                        )}
                    </div>
                </div>

                {/* 3. Tiers Pie Chart */}
                <div style={{ background: '#1e1e1e', padding: '1.5rem', borderRadius: '12px', minHeight: '400px' }}>
                    <h3 style={{ marginTop: 0, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FaChartBar color="#ffc107" /> Plan Distribution
                    </h3>
                    <div style={{ width: '100%', height: '300px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={stats.tierData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={100}
                                    fill="#8884d8"
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {stats.tierData.map((_entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="none" />
                                    ))}
                                </Pie>
                                <Tooltip contentStyle={{ backgroundColor: '#333', borderColor: '#555' }} />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* 4. Activity Over Time */}
                <div style={{ background: '#1e1e1e', padding: '1.5rem', borderRadius: '12px', minHeight: '400px', gridColumn: '1 / -1' }}>
                    <h3 style={{ marginTop: 0, marginBottom: '1.5rem' }}>Activity Trend</h3>
                    <div style={{ width: '100%', height: '300px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={stats.timelineData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                                <XAxis dataKey="time" stroke="#666" />
                                <YAxis stroke="#666" />
                                <Tooltip contentStyle={{ backgroundColor: '#333', borderColor: '#555' }} />
                                <Line type="monotone" dataKey="count" stroke="#03dac6" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 8 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

            </div>
        </div>
    );
}
