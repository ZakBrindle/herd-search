import { useState } from 'react';
import type { UserData } from '../../contexts/AuthContext';
import { FaMapMarkerAlt, FaUserFriends, FaTimes } from 'react-icons/fa';

interface DailyStats {
    date: string;
    topAreas: { name: string; timeMs: number }[];
    topFriends: { uid: string; timeMs: number }[];
    totalTimeActiveMs: number;
}

interface WrappedModalProps {
    stats: DailyStats;
    friendsData: UserData[];
    onClose: () => void;
    isFestival?: boolean;
}

// Helper for formatting duration
const formatDuration = (ms: number) => {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
};

export default function WrappedModal({ stats, friendsData, onClose, isFestival }: WrappedModalProps) {
    const [slideIndex, setSlideIndex] = useState(0);
    const totalSlides = 4;

    const nextSlide = () => {
        if (slideIndex < totalSlides - 1) {
            setSlideIndex(prev => prev + 1);
        } else {
            onClose();
        }
    };

    const dayName = new Date(stats.date).toLocaleDateString(undefined, { weekday: 'long' });

    // Get friend details
    const topFriendId = stats.topFriends[0]?.uid;
    const topFriend = friendsData.find(f => f.uid === topFriendId);
    const topFriendName = topFriend?.displayName || 'Unknown';
    const topFriendTime = stats.topFriends[0]?.timeMs || 0;

    // Get top spot
    const topSpot = stats.topAreas[0];

    return (
        <div className="modal-overlay" style={{ zIndex: 10000, background: 'black' }} onClick={nextSlide}>
            <div className="wrapped-container" style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                padding: '20px',
                background: 'linear-gradient(135deg, #1a2a6c, #b21f1f, #fdbb2d)',
                position: 'relative',
                color: 'white',
                textAlign: 'center'
            }}>

                {/* Progress Bar */}
                <div style={{ position: 'absolute', top: 10, left: 10, right: 10, display: 'flex', gap: '5px' }}>
                    {Array.from({ length: totalSlides }).map((_, i) => (
                        <div key={i} style={{
                            flex: 1,
                            height: '4px',
                            background: 'rgba(255,255,255,0.3)',
                            borderRadius: '2px',
                            overflow: 'hidden'
                        }}>
                            <div style={{
                                width: i < slideIndex ? '100%' : (i === slideIndex ? '100%' : '0%'),
                                height: '100%',
                                background: 'white',
                                transition: i === slideIndex ? 'width 5s linear' : 'none',
                                animation: i === slideIndex ? 'fillBar 5s linear' : 'none'
                            }} />
                        </div>
                    ))}
                </div>

                <button onClick={(e) => { e.stopPropagation(); onClose(); }} style={{ position: 'absolute', top: 20, right: 20, background: 'none', border: 'none', color: 'white', fontSize: '24px', zIndex: 20 }}>
                    <FaTimes />
                </button>

                {/* Slide 0: Intro */}
                {slideIndex === 0 && (
                    <div className="slide-content animate-slide-up">
                        <h1 style={{ fontSize: '3rem', fontWeight: 900, marginBottom: '20px' }}>{isFestival ? 'FESTIVAL' : dayName}<br />WRAPPED</h1>
                        <p style={{ fontSize: '1.2rem' }}>{isFestival ? 'What a weekend!' : 'You had a wild one!'}</p>
                        <div style={{ fontSize: '4rem', margin: '40px 0' }}>🎉</div>
                        <p>Tap to see your stats</p>
                    </div>
                )}

                {/* Slide 1: Top Spot */}
                {slideIndex === 1 && (
                    <div className="slide-content animate-slide-up">
                        <h2 style={{ fontSize: '1.5rem', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '40px' }}>Your Vibe Place</h2>
                        <div style={{
                            width: '200px',
                            height: '200px',
                            background: 'rgba(255,255,255,0.1)',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto 30px'
                        }}>
                            <FaMapMarkerAlt size={80} color="#fdbb2d" />
                        </div>

                        {topSpot ? (
                            <>
                                <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold' }}>{topSpot.name}</h1>
                                <p style={{ fontSize: '1.2rem', marginTop: '10px' }}>You spent <strong>{formatDuration(topSpot.timeMs)}</strong> here.</p>
                            </>
                        ) : (
                            <p>You wandered the Wilds mostly!</p>
                        )}

                        <div style={{ marginTop: '30px' }}>
                            {stats.topAreas.slice(1, 3).map(area => (
                                <div key={area.name} style={{ margin: '10px 0', opacity: 0.8 }}>
                                    {area.name}: {formatDuration(area.timeMs)}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Slide 2: Squad Bestie */}
                {slideIndex === 2 && (
                    <div className="slide-content animate-slide-up">
                        <h2 style={{ fontSize: '1.5rem', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '40px' }}>Squad Bestie</h2>

                        {topFriend ? (
                            <>
                                <div style={{
                                    position: 'relative',
                                    margin: '0 auto 30px',
                                    width: '150px'
                                }}>
                                    <img src={topFriend.photoURL || "/default-avatar.png"} style={{ width: '150px', height: '150px', borderRadius: '50%', border: '4px solid #fdbb2d' }} />
                                    <div style={{ position: 'absolute', bottom: 0, right: 0, fontSize: '40px' }}>👯‍♀️</div>
                                </div>

                                <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold' }}>{topFriendName}</h1>
                                <p style={{ fontSize: '1.2rem', marginTop: '20px' }}>Stuck together like glue for<br /><strong>{formatDuration(topFriendTime)}</strong></p>
                            </>
                        ) : (
                            <>
                                <FaUserFriends size={100} style={{ margin: '40px 0' }} />
                                <p>You were a lone wolf today!</p>
                            </>
                        )}
                    </div>
                )}

                {/* Slide 3: Summary */}
                {slideIndex === 3 && (
                    <div className="slide-content animate-slide-up">
                        <h2 style={{ fontSize: '2rem', marginBottom: '30px' }}>The Recap</h2>

                        <div className="stat-card" style={{ background: 'rgba(255,255,255,0.1)', padding: '20px', borderRadius: '15px', width: '100%', marginBottom: '15px' }}>
                            <div style={{ fontSize: '0.9rem', textTransform: 'uppercase', opacity: 0.7 }}>Total Time Active</div>
                            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{formatDuration(stats.totalTimeActiveMs)}</div>
                        </div>

                        <div className="stat-card" style={{ background: 'rgba(255,255,255,0.1)', padding: '20px', borderRadius: '15px', width: '100%', marginBottom: '15px' }}>
                            <div style={{ fontSize: '0.9rem', textTransform: 'uppercase', opacity: 0.7 }}>Favorite Spot</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{topSpot?.name || "The Wilds"}</div>
                        </div>

                        <div className="stat-card" style={{ background: 'rgba(255,255,255,0.1)', padding: '20px', borderRadius: '15px', width: '100%', marginBottom: '15px' }}>
                            <div style={{ fontSize: '0.9rem', textTransform: 'uppercase', opacity: 0.7 }}>Bestie</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{topFriendName}</div>
                        </div>

                        <p style={{ marginTop: '20px', fontSize: '0.9rem', fontStyle: 'italic' }}>See you tomorrow!</p>
                    </div>
                )}

            </div>
            <style>{`
        .animate-slide-up {
          animation: slideUp 0.5s ease-out;
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fillBar {
          from { width: 0%; }
          to { width: 100%; }
        }
      `}</style>
        </div>
    );
}
