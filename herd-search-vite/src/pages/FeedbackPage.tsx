import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, orderBy, onSnapshot, type DocumentData } from 'firebase/firestore';
import { FaStar, FaChevronLeft } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';

export default function FeedbackPage() {
    const [feedback, setFeedback] = useState<DocumentData[]>([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        const q = query(collection(db, "feedback"), orderBy("timestamp", "desc"));
        const unsub = onSnapshot(q, (snap) => {
            setFeedback(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            setLoading(false);
        });
        return () => unsub();
    }, []);

    const formatDate = (ts: number) => {
        return new Date(ts).toLocaleString();
    };

    return (
        <div className="app-container" style={{ padding: '20px', maxWidth: '800px', margin: '0 auto', color: 'white' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '2rem' }}>
                <button onClick={() => navigate('/')} className="icon-button" style={{ fontSize: '1.2rem' }}>
                    <FaChevronLeft />
                </button>
                <h1 style={{ margin: 0, fontSize: '1.5rem' }}>User Feedback Logs</h1>
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', marginTop: '50px' }}>Loading feedback...</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    {feedback.length === 0 ? (
                        <div style={{ textAlign: 'center', opacity: 0.5 }}>No feedback logged yet.</div>
                    ) : (
                        feedback.map(item => (
                            <div key={item.id} className="card" style={{ 
                                padding: '15px', 
                                background: 'rgba(255,255,255,0.05)',
                                borderLeft: `4px solid ${item.rating <= 3 ? '#ff4d4d' : '#03dac6'}`,
                                display: 'block'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                                    <div>
                                        <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{item.displayName}</div>
                                        <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>
                                            {item.tier?.toUpperCase()} • {item.weekKey}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '2px' }}>
                                        {[1, 2, 3, 4, 5].map(s => (
                                            <FaStar key={s} size={14} color={s <= item.rating ? '#FFD700' : '#333'} />
                                        ))}
                                    </div>
                                </div>
                                
                                {item.note && (
                                    <div style={{ 
                                        padding: '10px', 
                                        background: 'rgba(0,0,0,0.2)', 
                                        borderRadius: '8px',
                                        fontSize: '0.9rem',
                                        marginBottom: '10px',
                                        fontStyle: 'italic'
                                    }}>
                                        "{item.note}"
                                    </div>
                                )}
                                
                                <div style={{ fontSize: '0.7rem', opacity: 0.5, textAlign: 'right' }}>
                                    {formatDate(item.timestamp)}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
