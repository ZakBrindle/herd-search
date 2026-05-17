import React from 'react';
import { FaGem, FaCoffee, FaCheckCircle } from 'react-icons/fa';

interface PersonaliseModalProps {
    onClose: () => void;
    onPurchase: () => void;
    onRestore: () => void;
    loading?: boolean;
}

const PersonaliseModal: React.FC<PersonaliseModalProps> = ({ onClose, onPurchase, onRestore, loading }) => {
    return (
        <div className="modal-overlay" onClick={loading ? undefined : onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{
                background: '#1a1a1a',
                border: '1px solid rgba(255,255,255,0.1)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
                padding: '0',
                overflow: 'hidden',
                maxWidth: '400px'
            }}>
                {/* Header Image/Gradient */}
                <div style={{
                    background: 'linear-gradient(135deg, #6e8efb, #a777e3)',
                    height: '120px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative'
                }}>
                    <div style={{
                        width: '70px',
                        height: '70px',
                        background: 'rgba(255,255,255,0.2)',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
                    }}>
                        <FaGem size={35} color="white" />
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            position: 'absolute',
                            top: '15px',
                            right: '15px',
                            background: 'rgba(0,0,0,0.3)',
                            border: 'none',
                            color: 'white',
                            width: '30px',
                            height: '30px',
                            borderRadius: '50%',
                            cursor: 'pointer'
                        }}
                    >✕</button>
                </div>

                <div style={{ padding: '24px', textAlign: 'center' }}>
                    <h2 style={{
                        fontSize: '1.5rem',
                        fontWeight: '800',
                        marginBottom: '8px',
                        color: 'white'
                    }}>
                        Personalise Package
                    </h2>
                    <p style={{ color: '#aaa', fontSize: '0.9rem', marginBottom: '24px' }}>
                        Buy the Dev a coffee and unlock some premium avatar customisations!
                    </p>

                    {/* Cycling Preview Row */}
                    {(() => {
                        const [cycleIndex, setCycleIndex] = React.useState(0);

                        React.useEffect(() => {
                            const interval = setInterval(() => {
                                setCycleIndex(prev => prev + 1);
                            }, 1500);
                            return () => clearInterval(interval);
                        }, []);

                        const haloSkins = ['/halo-birthday.png', '/halo-purple.png', '/halo-lightning.png'];
                        const partyhatSkins = ['/party-hat.png', '/dino-hat.png', '/princess-hat.png', '/wizard-hat.png'];
                        const coneSkins = ['/traffic-cone.png', '/traffic-cone-green.png', '/traffic-cone-purple.png', '/traffic-cone-rainbow.png'];
                        const colors = [
                            '#00d2ff', // Cyan
                            '#00f5d4', // Teal
                            '#9b5de5', // Purple
                            '#f15bb5', // Pink
                            '#fee440', // Yellow
                            'linear-gradient(45deg, #f06, #9f6)' // Rainbow representation
                        ];

                        return (
                            <div style={{
                                display: 'flex',
                                justifyContent: 'center',
                                gap: '16px',
                                marginBottom: '24px',
                                background: 'rgba(255, 255, 255, 0.02)',
                                padding: '12px',
                                borderRadius: '16px',
                                border: '1px solid rgba(255, 255, 255, 0.05)',
                                alignItems: 'center'
                            }}>
                                {/* Halo Preview */}
                                <div style={{ position: 'relative', width: '42px', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <img
                                        src={haloSkins[cycleIndex % haloSkins.length]}
                                        style={{
                                            position: 'absolute',
                                            top: '-10px',
                                            left: '50%',
                                            transform: 'translateX(-50%)',
                                            width: '20px',
                                            height: '20px',
                                            zIndex: 2,
                                            transition: 'all 0.3s ease-in-out'
                                        }}
                                        alt="Halo Preview"
                                    />
                                    <div style={{
                                        width: '36px',
                                        height: '36px',
                                        borderRadius: '50%',
                                        background: '#2a2a2a',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '1rem',
                                        color: '#666'
                                    }}>
                                        👤
                                    </div>
                                </div>

                                {/* Party Hat Preview */}
                                <div style={{ position: 'relative', width: '42px', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <img
                                        src={partyhatSkins[cycleIndex % partyhatSkins.length]}
                                        style={{
                                            position: 'absolute',
                                            top: '-12px',
                                            left: '42%',
                                            transform: 'translateX(-50%)',
                                            width: '22px',
                                            height: '22px',
                                            zIndex: 2,
                                            transition: 'all 0.3s ease-in-out'
                                        }}
                                        alt="Party Hat Preview"
                                    />
                                    <div style={{
                                        width: '36px',
                                        height: '36px',
                                        borderRadius: '50%',
                                        background: '#2a2a2a',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '1rem',
                                        color: '#666'
                                    }}>
                                        👤
                                    </div>
                                </div>

                                {/* Traffic Cone Preview */}
                                <div style={{ position: 'relative', width: '42px', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <img
                                        src={coneSkins[cycleIndex % coneSkins.length]}
                                        style={{
                                            position: 'absolute',
                                            top: '-12px',
                                            left: '50%',
                                            transform: 'translateX(-50%)',
                                            width: '22px',
                                            height: '22px',
                                            zIndex: 2,
                                            transition: 'all 0.3s ease-in-out'
                                        }}
                                        alt="Traffic Cone Preview"
                                    />
                                    <div style={{
                                        width: '36px',
                                        height: '36px',
                                        borderRadius: '50%',
                                        background: '#2a2a2a',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '1rem',
                                        color: '#666'
                                    }}>
                                        👤
                                    </div>
                                </div>

                                {/* Color Ring Preview */}
                                <div style={{ position: 'relative', width: '42px', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <div
                                        className={cycleIndex % colors.length === colors.length - 1 ? 'rainbow-animate' : ''}
                                        style={{
                                            width: '36px',
                                            height: '36px',
                                            borderRadius: '50%',
                                            background: '#2a2a2a',
                                            border: '2px solid',
                                            borderColor: cycleIndex % colors.length === colors.length - 1 ? 'transparent' : colors[cycleIndex % colors.length] as any,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '1rem',
                                            color: '#666',
                                            transition: 'border-color 0.4s ease'
                                        }}
                                    >
                                        👤
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {/* Features List */}
                    <div style={{ textAlign: 'left', marginBottom: '30px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                            <FaCheckCircle color="#03dac6" />
                            <span style={{ fontSize: '0.9rem' }}>8 Exclusive Ring Colours</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                            <FaCheckCircle color="#03dac6" />
                            <span style={{ fontSize: '0.9rem' }}>Animated Rainbow Effect</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                            <FaCheckCircle color="#03dac6" />
                            <span style={{ fontSize: '0.9rem' }}>Glow, Spin, Halo, Party Hat & Traffic Cone</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <FaCheckCircle color="#03dac6" />
                            <span style={{ fontSize: '0.9rem' }}>Permanent One-Time Purchase</span>
                        </div>
                    </div>

                    <div style={{
                        fontSize: '2rem',
                        fontWeight: 'bold',
                        marginBottom: '24px',
                        color: 'var(--primary)'
                    }}>
                        £3.99
                    </div>

                    <button
                        onClick={onPurchase}
                        disabled={loading}
                        className="btn btn-primary w-full"
                        style={{
                            background: 'linear-gradient(45deg, var(--primary), var(--secondary))',
                            color: 'black',
                            fontWeight: 'bold',
                            padding: '16px',
                            borderRadius: '12px',
                            fontSize: '1rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '10px',
                            border: 'none',
                            marginBottom: '16px',
                            cursor: loading ? 'not-allowed' : 'pointer'
                        }}
                    >
                        {loading ? 'Processing...' : (
                            <>
                                <FaCoffee /> Unlock Now
                            </>
                        )}
                    </button>

                    <div style={{
                        fontSize: '0.75rem',
                        color: '#666',
                        marginTop: '8px',
                        marginBottom: '16px',
                        lineHeight: '1.4'
                    }}>
                        By purchasing this package you agree<br />to our{' '}
                        <a 
                            href="/terms" 
                            style={{ 
                                color: 'var(--primary)', 
                                textDecoration: 'underline',
                                cursor: 'pointer'
                            }}
                        >
                            Terms & Conditions
                        </a>
                    </div>

                    <button
                        onClick={onRestore}
                        disabled={loading}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#666',
                            fontSize: '0.8rem',
                            textDecoration: 'underline',
                            cursor: 'pointer'
                        }}
                    >
                        Already purchased? Restore session
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PersonaliseModal;
