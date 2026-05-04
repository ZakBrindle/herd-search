import { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, type DocumentData } from 'firebase/firestore';
import { db } from '../firebase';
import { 
    FaMapMarkerAlt, FaChartBar, FaGlobe, FaTimes, 
    FaCalendarAlt, FaFileInvoiceDollar, FaUsers 
} from 'react-icons/fa';
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
};

type Props = {
    onClose: () => void;
    currentMapFilter: '5m' | '30m' | '1h' | '24h' | null;
    onSetMapFilter: (filter: '5m' | '30m' | '1h' | '24h' | null) => void;
    onOpenBilling: () => void;
    onOpenAllUsers: () => void;
};

const COLORS = ['#03dac6', '#bb86fc', '#cf6679', '#018786', '#3700b3', '#ffc107', '#ff6b6b'];

export default function DevStats({ onClose, currentMapFilter, onSetMapFilter, onOpenBilling, onOpenAllUsers }: Props) {
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

        const tierCounts: { [key: string]: number } = {};
        activeUsers.forEach(u => {
            const t = u.tier || 'free';
            tierCounts[t] = (tierCounts[t] || 0) + 1;
        });
        const tierData = Object.entries(tierCounts).map(([name, value]) => ({ name, value }));

        const areaCounts: { [key: string]: number } = {};
        activeUsers.forEach(u => {
            if (u.currentArea && u.currentArea !== 'Out of bounds' && u.currentArea !== 'unknown') {
                areaCounts[u.currentArea] = (areaCounts[u.currentArea] || 0) + 1;
            }
        });
        const topAreasData = Object.entries(areaCounts)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        let bucketSize = ms / 12;
        let dateFormat: (ts: number) => string = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (timeFrame === '7d' || timeFrame === '30d') {
            dateFormat = (ts) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
        }

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

        const activeSquads = squads.filter(s => s.members && s.members.length > 1);
        const squadsInTimeframe = squads.filter(s => s.createdAt && (now - s.createdAt < ms));

        return {
            totalActive: activeUsers.length,
            tierData,
            topAreasData,
            timelineData: timelineDataArray,
            activeSquadsCount: activeSquads.length,
            newSquadsInTimeframe: squadsInTimeframe.length
        };
    }, [users, squads, timeFrame]);

    if (loading) {
        return (
            <div style={{ position: 'fixed', inset: 0, background: '#0f0f1a', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
                <div style={{ textAlign: 'center' }}>
                    <div className="spinner" style={{ width: 40, height: 40, border: '4px solid #333', borderTopColor: '#03dac6', borderRadius: '50%', animation: 'spin 1s infinite' }} />
                    <p style={{ marginTop: '1rem', color: '#03dac6' }}>Loading Analytics...</p>
                </div>
            </div>
        );
    }

    return (
        <div style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'radial-gradient(circle at top right, #1a1a2e, #0f0f1a)',
            color: 'white',
            zIndex: 10000,
            padding: '1rem',
            overflowY: 'auto',
            fontFamily: 'Outfit, Inter, system-ui, sans-serif'
        }}>
            {/* Header Area */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '1.5rem',
                padding: '0.5rem 0'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{
                        background: 'linear-gradient(135deg, #03dac6, #bb86fc)',
                        width: '40px',
                        height: '40px',
                        borderRadius: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 0 20px rgba(3, 218, 198, 0.3)'
                    }}>
                        <FaChartBar color="black" />
                    </div>
                    <div>
                        <h1 style={{
                            margin: 0,
                            fontSize: '1.5rem',
                            fontWeight: '800',
                            letterSpacing: '-0.5px'
                        }}>
                            Mission Control
                        </h1>
                        <span style={{ fontSize: '0.7rem', color: '#666', textTransform: 'uppercase', letterSpacing: '1px' }}>Developer Access</span>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: '#fff',
                        width: '40px',
                        height: '40px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                    }}
                >
                    <FaTimes />
                </button>
            </div>

            {/* Quick Actions & Filters Bar */}
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                marginBottom: '2rem',
                background: 'rgba(255,255,255,0.03)',
                padding: '1.25rem',
                borderRadius: '20px',
                border: '1px solid rgba(255,255,255,0.05)',
                backdropFilter: 'blur(10px)'
            }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#888', fontSize: '0.9rem', marginRight: '0.5rem' }}>
                        <FaCalendarAlt /> Time:
                    </div>
                    {['1h', '24h', '7d', '30d'].map(tf => (
                        <button
                            key={tf}
                            onClick={() => setTimeFrame(tf as any)}
                            style={{
                                background: timeFrame === tf ? '#bb86fc' : 'rgba(255,255,255,0.05)',
                                border: 'none',
                                color: timeFrame === tf ? 'black' : '#aaa',
                                padding: '6px 16px',
                                borderRadius: '12px',
                                fontSize: '0.85rem',
                                fontWeight: '600',
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                            }}
                        >
                            {tf}
                        </button>
                    ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                    <button
                        onClick={onOpenBilling}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            background: 'linear-gradient(135deg, #1a2a6c, #b21f1f)',
                            border: 'none',
                            color: 'white',
                            padding: '12px',
                            borderRadius: '14px',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: 'bold'
                        }}
                    >
                        <FaFileInvoiceDollar /> Billing
                    </button>

                    <button
                        onClick={onOpenAllUsers}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            background: 'rgba(187, 134, 252, 0.1)',
                            border: '1px solid #bb86fc',
                            color: '#bb86fc',
                            padding: '12px',
                            borderRadius: '14px',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: 'bold'
                        }}
                    >
                        <FaUsers /> Users
                    </button>

                    <button
                        onClick={() => onSetMapFilter(currentMapFilter ? null : '1h')}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            background: currentMapFilter ? 'rgba(3, 218, 198, 0.2)' : 'rgba(255,255,255,0.05)',
                            border: currentMapFilter ? '1px solid #03dac6' : '1px solid rgba(255,255,255,0.1)',
                            color: currentMapFilter ? '#03dac6' : '#aaa',
                            padding: '12px',
                            borderRadius: '14px',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: 'bold'
                        }}
                    >
                        <FaGlobe /> Overlay
                    </button>
                </div>
                {currentMapFilter && (
                    <div style={{ textAlign: 'center', fontSize: '0.75rem', color: '#ff6b6b', fontWeight: '500' }}>
                        Overlay is Active. Close stats to view on map.
                    </div>
                )}
            </div>

            {/* Metrics Grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '1rem',
                marginBottom: '1.5rem'
            }}>
                <div style={{
                    background: 'rgba(3, 218, 198, 0.05)',
                    padding: '1.25rem',
                    borderRadius: '24px',
                    border: '1px solid rgba(3, 218, 198, 0.1)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center'
                }}>
                    <span style={{ color: '#03dac6', fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Users ({timeFrame})</span>
                    <div style={{ fontSize: '2.5rem', fontWeight: '900', color: 'white', textShadow: '0 0 20px rgba(3, 218, 198, 0.3)' }}>{stats.totalActive}</div>
                </div>

                <div style={{
                    background: 'rgba(187, 134, 252, 0.05)',
                    padding: '1.25rem',
                    borderRadius: '24px',
                    border: '1px solid rgba(187, 134, 252, 0.1)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center'
                }}>
                    <span style={{ color: '#bb86fc', fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Squads</span>
                    <div style={{ fontSize: '2.5rem', fontWeight: '900', color: 'white', textShadow: '0 0 20px rgba(187, 134, 252, 0.3)' }}>{stats.activeSquadsCount}</div>
                    <span style={{ fontSize: '0.65rem', color: '#666', marginTop: '4px' }}>+{stats.newSquadsInTimeframe} new</span>
                </div>
            </div>

            {/* Charts Section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                
                {/* Activity Trend */}
                <div style={{
                    background: 'rgba(255,255,255,0.02)',
                    padding: '1.5rem',
                    borderRadius: '28px',
                    border: '1px solid rgba(255,255,255,0.05)'
                }}>
                    <h3 style={{ margin: '0 0 1.5rem 0', fontSize: '1.1rem', fontWeight: '700' }}>Activity Trend</h3>
                    <div style={{ width: '100%', height: '220px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={stats.timelineData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                <XAxis dataKey="time" stroke="#444" fontSize={10} tickLine={false} axisLine={false} />
                                <YAxis stroke="#444" fontSize={10} tickLine={false} axisLine={false} />
                                <Tooltip 
                                    contentStyle={{ backgroundColor: '#121212', border: '1px solid #333', borderRadius: '12px' }}
                                    itemStyle={{ color: '#03dac6' }}
                                />
                                <Line 
                                    type="monotone" 
                                    dataKey="count" 
                                    stroke="#03dac6" 
                                    strokeWidth={4} 
                                    dot={false}
                                    activeDot={{ r: 6, fill: '#03dac6' }} 
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Busiest Areas */}
                <div style={{
                    background: 'rgba(255,255,255,0.02)',
                    padding: '1.5rem',
                    borderRadius: '28px',
                    border: '1px solid rgba(255,255,255,0.05)'
                }}>
                    <h3 style={{ margin: '0 0 1.5rem 0', fontSize: '1.1rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <FaMapMarkerAlt color="#03dac6" size={14} /> Busiest Areas
                    </h3>
                    <div style={{ width: '100%', height: '250px' }}>
                        {stats.topAreasData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={stats.topAreasData} layout="vertical">
                                    <XAxis type="number" hide />
                                    <YAxis type="category" dataKey="name" stroke="#ccc" width={80} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                                    <Tooltip contentStyle={{ backgroundColor: '#121212', border: '1px solid #333', borderRadius: '12px' }} />
                                    <Bar dataKey="count" fill="#bb86fc" radius={[0, 10, 10, 0]} barSize={20}>
                                        {stats.topAreasData.map((_entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: '0.9rem' }}>
                                No activity records found.
                            </div>
                        )}
                    </div>
                </div>

                {/* Plan Distribution */}
                <div style={{
                    background: 'rgba(255,255,255,0.02)',
                    padding: '1.5rem',
                    borderRadius: '28px',
                    border: '1px solid rgba(255,255,255,0.05)',
                    marginBottom: '2rem'
                }}>
                    <h3 style={{ margin: '0 0 1.5rem 0', fontSize: '1.1rem', fontWeight: '700' }}>Plan Distribution</h3>
                    <div style={{ width: '100%', height: '220px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={stats.tierData}
                                    cx="50%" cy="50%"
                                    innerRadius={50}
                                    outerRadius={80}
                                    paddingAngle={8}
                                    dataKey="value"
                                >
                                    {stats.tierData.map((_entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="none" />
                                    ))}
                                </Pie>
                                <Tooltip contentStyle={{ backgroundColor: '#121212', border: '1px solid #333', borderRadius: '12px' }} />
                                <Legend iconType="circle" />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

            </div>
        </div>
    );
}
