import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { FaChevronLeft, FaChartLine, FaHistory, FaCheckCircle, FaSpinner, FaTimesCircle, FaDollarSign, FaShoppingCart, FaStar } from 'react-icons/fa';

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

interface BillingPageProps {
    onClose: () => void;
}

const BillingPage: React.FC<BillingPageProps> = ({ onClose }) => {
    const [purchases, setPurchases] = useState<Purchase[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

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

    const stats = useMemo(() => {
        const completed = purchases.filter(p => p.status === 'completed');
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
            paymentsStarted: purchases.length,
            mostPurchasedTier
        };
    }, [purchases]);

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
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
                <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: 'white', padding: '10px', borderRadius: '50%', cursor: 'pointer' }}>
                    <FaChevronLeft />
                </button>
                <h1 style={{ margin: 0, fontSize: '1.8rem', background: 'linear-gradient(45deg, #03dac6, #bb86fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    Billing Center
                </h1>
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
                    {purchases.map(p => {
                        const isExpired = p.status === 'started' && (Date.now() - p.createdAt > 3600000);
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
                            <div>
                                <div style={{ fontWeight: 'bold', fontSize: '1rem' }}>
                                    {p.userName} <span style={{ fontWeight: 'normal', color: '#666', fontSize: '0.8rem' }}>({p.userEmail})</span>
                                </div>
                                <div style={{ fontSize: '0.85rem', color: '#aaa', marginTop: '4px' }}>
                                    Purchased <strong style={{ color: '#fff', textTransform: 'capitalize' }}>{p.tier}</strong> for <strong>{p.amount}</strong>
                                </div>
                                <div style={{ fontSize: '0.75rem', color: '#555', marginTop: '4px' }}>
                                    {new Date(p.createdAt).toLocaleString()}
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
                    {purchases.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '2rem', color: '#555' }}>No payment activity yet.</div>
                    )}
                </div>
                )}
            </div>
        </div>
    );
};

export default BillingPage;
