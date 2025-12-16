
import { useNavigate } from 'react-router-dom';
import { FaMap, FaUserFriends, FaGhost, FaMapMarkerAlt, FaChevronLeft, FaCloudDownloadAlt } from 'react-icons/fa';

export default function AboutPage() {
    const navigate = useNavigate();

    return (
        <div className="app-container" style={{ padding: '20px', overflowY: 'auto' }}>
            <header style={{ display: 'flex', alignItems: 'center', marginBottom: '20px' }}>
                <button
                    onClick={() => navigate('/')}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: 'white',
                        fontSize: '1.2rem',
                        cursor: 'pointer',
                        padding: '10px'
                    }}
                >
                    <FaChevronLeft />
                </button>
                <h1 className="logo" style={{ fontSize: '1.5rem', margin: 0, marginLeft: '10px' }}>About Herd Search</h1>
            </header>

            <div style={{ maxWidth: '600px', margin: '0 auto' }}>

                <div className="card" style={{ flexDirection: 'column', alignItems: 'flex-start', marginBottom: '1rem', background: '#333' }}>
                    <h2 style={{ color: 'var(--primary)', marginTop: 0 }}>What is Herd Search?</h2>
                    <p>
                        Herd Search is the ultimate festival and event companion. Keep track of your friends (your "Herd"), create temporary squads, and never lose your group in the crowd again.
                    </p>
                </div>

                <h3 style={{ marginTop: '2rem', marginBottom: '1rem' }}>How to Use</h3>

                <div className="card" style={{ flexDirection: 'row', alignItems: 'center', marginBottom: '1rem' }}>
                    <div style={{ marginRight: '1rem', fontSize: '1.5rem', color: '#03dac6' }}><FaMap /></div>
                    <div>
                        <h4 style={{ margin: 0 }}>The Map</h4>
                        <p style={{ margin: '5px 0 0', fontSize: '0.9rem', color: '#ccc' }}>
                            See where your friends are in real-time. Long press on a location to start a Squad Vote.
                        </p>
                    </div>
                </div>

                <div className="card" style={{ flexDirection: 'row', alignItems: 'center', marginBottom: '1rem' }}>
                    <div style={{ marginRight: '1rem', fontSize: '1.5rem', color: '#bb86fc' }}><FaUserFriends /></div>
                    <div>
                        <h4 style={{ margin: 0 }}>Squads</h4>
                        <p style={{ margin: '5px 0 0', fontSize: '0.9rem', color: '#ccc' }}>
                            Create a Squad and share your live location with each other.
                        </p>
                    </div>
                </div>

                <div className="card" style={{ flexDirection: 'row', alignItems: 'center', marginBottom: '1rem' }}>
                    <div style={{ marginRight: '1rem', fontSize: '1.5rem', color: '#cf6679' }}><FaGhost /></div>
                    <div>
                        <h4 style={{ margin: 0 }}>Ghost Mode</h4>
                        <p style={{ margin: '5px 0 0', fontSize: '0.9rem', color: '#ccc' }}>
                            Want some privacy? Enable Ghost Mode in your profile to hide your location.
                        </p>
                    </div>
                </div>

                <div className="card" style={{ flexDirection: 'row', alignItems: 'center', marginBottom: '1rem' }}>
                    <div style={{ marginRight: '1rem', fontSize: '1.5rem', color: '#ffc107' }}><FaMapMarkerAlt /></div>
                    <div>
                        <h4 style={{ margin: 0 }}>Check In</h4>
                        <p style={{ margin: '5px 0 0', fontSize: '0.9rem', color: '#ccc' }}>
                            GPS Acting up? Manually Check In to a festival area to update your location.
                        </p>
                    </div>
                </div>

                <div style={{ marginTop: '3rem', textAlign: 'center', color: '#666', fontSize: '0.8rem' }}>
                    <p>Herd Search &copy; 2025</p>
                    <p>Version 1.0.1 (Beta)</p>
                </div>

                <button
                    onClick={() => navigate('/install')}
                    className="btn btn-secondary w-full"
                    style={{ marginTop: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                    How to Install <FaCloudDownloadAlt />
                </button>

                <button
                    onClick={() => navigate('/')}
                    className="btn btn-primary w-full"
                    style={{ marginTop: '1rem' }}
                >
                    Back to App
                </button>
            </div>
        </div>
    );
}
