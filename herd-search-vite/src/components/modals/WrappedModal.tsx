import { useState } from 'react';
import type { UserData } from '../../contexts/AuthContext';
import { FaMapMarkerAlt, FaUserFriends, FaTimes } from 'react-icons/fa';
import { getAvatarUrl } from '../../utils/userUtils';

interface DailyStats {
    date: string;
    topAreas: { name: string; timeMs: number }[];
    topFriends: { uid: string; timeMs: number }[];
    totalTimeActiveMs: number;
    dailyData?: {
        dayName: string;
        date: string;
        areasVisited: Record<string, number>;
        friendsProximity: Record<string, number>;
        totalTimeActiveMs: number;
    }[];
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
    // Filter out days with 0 active time
    const activeDays = (stats.dailyData || []).filter(day => day.totalTimeActiveMs > 0);

    // Calculate total slides based on mode
    const totalSlides = isFestival ? (4 + activeDays.length) : 4;

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

    // Get top 5 spots for festival
    const top5Spots = stats.topAreas.slice(0, 5);

    const getBackground = () => {
        if (!isFestival) {
            return 'linear-gradient(135deg, #1a2a6c, #b21f1f, #fdbb2d)';
        }

        // Festival mode gradients
        if (slideIndex === 0) return 'linear-gradient(135deg, #FF0080, #7928CA)'; // Intro: Vibrant Pink/Purple
        if (slideIndex === 1) return 'linear-gradient(135deg, #40E0D0, #FF8C00, #FF0080)'; // Top 5: Multi-color vibe

        const dailyDataLength = activeDays.length;
        
        // Daily slides
        if (slideIndex >= 2 && slideIndex < 2 + dailyDataLength) {
            const dayGradients = [
                'linear-gradient(135deg, #00d2ff, #3a7bd5)', // Thursday: Cool Blue
                'linear-gradient(135deg, #12c2e9, #c471ed, #f64f59)', // Friday: Sunset
                'linear-gradient(135deg, #f7971e, #ffd200)', // Saturday: Gold/Sun
                'linear-gradient(135deg, #FC466B, #3F5EFB)', // Sunday: Pink/Blue
            ];
            // Match gradient to the actual day of the festival if possible, 
            // but for now we'll just cycle through them for the active days.
            return dayGradients[(slideIndex - 2) % dayGradients.length];
        }

        // Bestie slide
        if (slideIndex === 2 + dailyDataLength) return 'linear-gradient(135deg, #ee0979, #ff6a00)'; // Bestie: Hot Pink/Orange
        
        // Final Recap
        return 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)'; // Recap: Deep Space
    };

    return (
        <div className="modal-overlay" style={{ zIndex: 10000, background: 'black' }} onClick={nextSlide}>
            <div className="wrapped-container" style={{
                maxWidth: '500px',
                width: '90%',
                height: 'auto',
                maxHeight: '90vh',
                margin: 'auto',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                padding: '40px 20px',
                background: getBackground(),
                position: 'relative',
                color: 'white',
                textAlign: 'center',
                borderRadius: '20px',
                transition: 'background 0.8s ease'
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

                {/* FESTIVAL WRAPPED SLIDES */}
                {isFestival ? (
                    <>
                        {/* Slide 0: Intro */}
                        {slideIndex === 0 && (
                            <div className="slide-content animate-slide-up">
                                <h1 style={{ fontSize: '3rem', fontWeight: 900, marginBottom: '20px' }}>FESTIVAL<br />WRAPPED</h1>
                                <p style={{ fontSize: '1.2rem' }}>What a weekend!</p>
                                <div style={{ fontSize: '4rem', margin: '40px 0' }}>🎉</div>
                                <p>Tap to see your epic festival story</p>
                            </div>
                        )}

                        {/* Slide 1: Top 5 Places */}
                        {slideIndex === 1 && (
                            <div className="slide-content animate-slide-up">
                                <h2 style={{ fontSize: '1.5rem', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '30px' }}>Your Top 5 Spots</h2>
                                {top5Spots.length > 0 ? (
                                    top5Spots.map((area, index) => (
                                        <div key={area.name} style={{
                                            background: 'rgba(255,255,255,0.1)',
                                            padding: '15px 20px',
                                            borderRadius: '12px',
                                            marginBottom: '10px',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                                <div style={{
                                                    fontSize: '1.5rem',
                                                    fontWeight: 'bold',
                                                    width: '30px',
                                                    opacity: index === 0 ? 1 : 0.7
                                                }}>
                                                    {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`}
                                                </div>
                                                <div style={{ textAlign: 'left' }}>
                                                    <div style={{ fontWeight: 'bold', fontSize: index === 0 ? '1.2rem' : '1rem' }}>{area.name}</div>
                                                </div>
                                            </div>
                                            <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{formatDuration(area.timeMs)}</div>
                                        </div>
                                    ))
                                ) : (
                                    <div style={{ marginTop: '40px' }}>
                                        <div style={{ fontSize: '4rem', marginBottom: '20px' }}>🏃‍♂️</div>
                                        <p style={{ fontSize: '1.2rem' }}>You were a true wanderer!<br />You explored the Wilds all weekend.</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Slides 2-5: Daily Highlights */}
                        {activeDays.map((day, dayIndex) => {
                            if (slideIndex === 2 + dayIndex) {
                                const dayTopAreas = Object.entries(day.areasVisited)
                                    .map(([name, timeMs]) => ({ name: name.replace(/_/g, '.'), timeMs }))
                                    .sort((a, b) => b.timeMs - a.timeMs)
                                    .slice(0, 3);

                                const dayTopFriend = Object.entries(day.friendsProximity)
                                    .map(([uid, timeMs]) => ({ uid, timeMs }))
                                    .sort((a, b) => b.timeMs - a.timeMs)[0];

                                const dayTopFriendData = dayTopFriend ? friendsData.find(f => f.uid === dayTopFriend.uid) : null;

                                return (
                                    <div key={day.dayName} className="slide-content animate-slide-up">
                                        <h2 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '10px' }}>{day.dayName}</h2>
                                        <div style={{ fontSize: '0.9rem', opacity: 0.8, marginBottom: '30px' }}>
                                            {formatDuration(day.totalTimeActiveMs)} active
                                        </div>

                                        {dayTopAreas.length > 0 && (
                                            <>
                                                <div style={{ fontSize: '0.9rem', textTransform: 'uppercase', opacity: 0.7, marginBottom: '15px' }}>Top Spots</div>
                                                {dayTopAreas.map((area, i) => (
                                                    <div key={area.name} style={{
                                                        background: 'rgba(255,255,255,0.1)',
                                                        padding: '12px 15px',
                                                        borderRadius: '10px',
                                                        marginBottom: '8px',
                                                        display: 'flex',
                                                        justifyContent: 'space-between'
                                                    }}>
                                                        <span>{i === 0 ? '🎯 ' : ''}{area.name}</span>
                                                        <span style={{ opacity: 0.8 }}>{formatDuration(area.timeMs)}</span>
                                                    </div>
                                                ))}
                                            </>
                                        )}

                                        {dayTopFriendData && (
                                            <div style={{ marginTop: '20px', padding: '15px', background: 'rgba(255,255,255,0.1)', borderRadius: '10px' }}>
                                                <div style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: '8px' }}>With</div>
                                                <div style={{ fontWeight: 'bold' }}>{dayTopFriendData.displayName} 👯‍♀️</div>
                                                <div style={{ fontSize: '0.9rem', marginTop: '5px' }}>{formatDuration(dayTopFriend.timeMs)}</div>
                                            </div>
                                        )}
                                    </div>
                                );
                            }
                            return null;
                        })}

                        {/* Slide after days: Squad Bestie */}
                        {slideIndex === 2 + activeDays.length && (
                            <div className="slide-content animate-slide-up">
                                <h2 style={{ fontSize: '1.5rem', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '40px' }}>Festival Bestie</h2>

                                {topFriend ? (
                                    <>
                                        <div style={{
                                            position: 'relative',
                                            margin: '0 auto 30px',
                                            width: '150px'
                                        }}>
                                            <img src={getAvatarUrl(topFriend.photoURL, topFriend.displayName)} style={{ width: '150px', height: '150px', borderRadius: '50%', border: '4px solid #fdbb2d' }} />
                                            <div style={{ position: 'absolute', bottom: 0, right: 0, fontSize: '40px' }}>👯‍♀️</div>
                                        </div>

                                        <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold' }}>{topFriendName}</h1>
                                        <p style={{ fontSize: '1.2rem', marginTop: '20px' }}>Together for<br /><strong>{formatDuration(topFriendTime)}</strong></p>
                                        <p style={{ fontSize: '0.9rem', opacity: 0.8, marginTop: '20px' }}>Inseparable all weekend! 🎊</p>
                                    </>
                                ) : (
                                    <>
                                        <FaUserFriends size={100} style={{ margin: '40px 0' }} />
                                        <p>You were a free spirit this weekend!</p>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Slide after bestie: Final Recap */}
                        {slideIndex === 3 + activeDays.length && (
                            <div className="slide-content animate-slide-up">
                                <h2 style={{ fontSize: '2rem', marginBottom: '30px' }}>The Recap</h2>

                                <div className="stat-card" style={{ background: 'rgba(255,255,255,0.1)', padding: '20px', borderRadius: '15px', width: '100%', marginBottom: '15px' }}>
                                    <div style={{ fontSize: '0.9rem', textTransform: 'uppercase', opacity: 0.7 }}>Total Festival Time</div>
                                    <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{formatDuration(stats.totalTimeActiveMs)}</div>
                                </div>

                                <div className="stat-card" style={{ background: 'rgba(255,255,255,0.1)', padding: '20px', borderRadius: '15px', width: '100%', marginBottom: '15px' }}>
                                    <div style={{ fontSize: '0.9rem', textTransform: 'uppercase', opacity: 0.7 }}>Top Spot</div>
                                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{topSpot?.name || "The Wilds"}</div>
                                    {topSpot && <div style={{ fontSize: '1rem', marginTop: '5px' }}>{formatDuration(topSpot.timeMs)}</div>}
                                </div>

                                <div className="stat-card" style={{ background: 'rgba(255,255,255,0.1)', padding: '20px', borderRadius: '15px', width: '100%', marginBottom: '15px' }}>
                                    <div style={{ fontSize: '0.9rem', textTransform: 'uppercase', opacity: 0.7 }}>Festival Bestie</div>
                                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{topFriendName}</div>
                                </div>

                                <p style={{ marginTop: '20px', fontSize: '1.1rem', fontStyle: 'italic' }}>What a legendary weekend! 🎉</p>
                            </div>
                        )}
                    </>
                ) : (
                    // DAILY WRAPPED SLIDES (original 4 slides)
                    <>
                        {/* Slide 0: Intro */}
                        {slideIndex === 0 && (
                            <div className="slide-content animate-slide-up">
                                <h1 style={{ fontSize: '3rem', fontWeight: 900, marginBottom: '20px' }}>{dayName}<br />WRAPPED</h1>
                                <p style={{ fontSize: '1.2rem' }}>You had a wild one!</p>
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
                                            <img src={getAvatarUrl(topFriend.photoURL, topFriend.displayName)} style={{ width: '150px', height: '150px', borderRadius: '50%', border: '4px solid #fdbb2d' }} />
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
                    </>
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
