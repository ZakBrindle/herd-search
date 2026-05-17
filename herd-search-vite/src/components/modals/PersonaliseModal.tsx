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
                            <span style={{ fontSize: '0.9rem' }}>Special Effects: Glow & Spin</span>
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
