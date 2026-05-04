import React from 'react';

interface PaymentResultModalProps {
    paymentStatus: 'pending' | 'success' | 'failure' | string;
    onClose: () => void;
    onGoToMap: () => void;
    onRetry: () => void;
}

const PaymentResultModal: React.FC<PaymentResultModalProps> = ({ paymentStatus, onClose, onGoToMap, onRetry }) => {
    return (
        <div className="modal-overlay" onClick={paymentStatus === 'pending' ? undefined : onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{
                background: '#1a1a1a', 
                border: '1px solid rgba(255,255,255,0.1)', 
                boxShadow: '0 8px 32px rgba(0,0,0,0.8)'
            }}>
                <style>
                    {`
                    .checkmark__circle {
                      stroke-dasharray: 166;
                      stroke-dashoffset: 166;
                      stroke-width: 2;
                      stroke-miterlimit: 10;
                      stroke: var(--primary, #03dac6);
                      fill: none;
                      animation: stroke 0.6s cubic-bezier(0.65, 0, 0.45, 1) forwards;
                    }
                    .checkmark {
                      width: 65px;
                      height: 65px;
                      border-radius: 50%;
                      display: block;
                      stroke-width: 3;
                      stroke: var(--primary, #03dac6);
                      stroke-miterlimit: 10;
                      margin: 0 auto 20px;
                      box-shadow: inset 0px 0px 0px var(--primary, #03dac6);
                      animation: fill .4s ease-in-out .4s forwards, scale .3s ease-in-out .9s both;
                    }
                    .checkmark__check {
                      transform-origin: 50% 50%;
                      stroke-dasharray: 48;
                      stroke-dashoffset: 48;
                      animation: stroke 0.3s cubic-bezier(0.65, 0, 0.45, 1) 0.8s forwards;
                    }
                    @keyframes stroke {
                      100% { stroke-dashoffset: 0; }
                    }
                    @keyframes scale {
                      0%, 100% { transform: none; }
                      50% { transform: scale3d(1.1, 1.1, 1); }
                    }
                    @keyframes fill {
                      100% { box-shadow: inset 0px 0px 0px 35px rgba(3,218,198,0.1); }
                    }
                    .spin-fast {
                        animation: spin 1s linear infinite;
                    }
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                    `}
                </style>

                {paymentStatus === 'pending' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1rem 0' }}>
                        <div className="spin-fast" style={{ 
                            width: '40px', 
                            height: '40px', 
                            border: '3px solid rgba(255,255,255,0.1)', 
                            borderTop: '3px solid var(--primary, #03dac6)', 
                            borderRadius: '50%',
                            marginBottom: '20px'
                        }}></div>
                        <h3 style={{ 
                            fontSize: '1.4rem', 
                            fontWeight: '800', 
                            marginBottom: '0.5rem',
                            background: 'linear-gradient(45deg, var(--primary, #03dac6), var(--secondary, #bb86fc))',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent'
                        }}>
                            Checking Payment...
                        </h3>
                        <p style={{ color: '#888', fontSize: '0.9rem', textAlign: 'center', marginBottom: '25px' }}>
                            Waiting for confirmation from Stripe. This usually takes just a few seconds.
                        </p>
                        <button 
                            onClick={onClose} 
                            className="btn btn-secondary w-full"
                            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                        >
                            Cancel / Close
                        </button>
                    </div>
                ) : paymentStatus === 'success' ? (
                    <>
                        <svg className="checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
                            <circle className="checkmark__circle" cx="26" cy="26" r="25" fill="none" />
                            <path className="checkmark__check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
                        </svg>
                        <h3 className="modal-header" style={{ 
                            background: 'linear-gradient(45deg, var(--primary, #03dac6), var(--secondary, #bb86fc))',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            marginBottom: '10px'
                        }}>
                            Payment Successful!
                        </h3>
                        <p style={{ textAlign: 'center', marginBottom: '25px', fontSize: '1rem', color: '#ccc' }}>
                            Your account has been upgraded successfully. You can now invite friends to your squad!
                        </p>
                        <div className="modal-actions" style={{ flexDirection: 'column', gap: '12px' }}>
                            <button
                                onClick={onGoToMap}
                                className="btn btn-primary w-full"
                                style={{ background: 'linear-gradient(45deg, var(--primary, #03dac6), var(--secondary, #bb86fc))', color: 'black', fontWeight: 'bold', border: 'none' }}
                            >
                                Go to Map
                            </button>
                            <button
                                onClick={onClose}
                                className="btn btn-secondary w-full"
                                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                            >
                                Close
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <div style={{ fontSize: '3rem', textAlign: 'center', marginBottom: '10px' }}>❌</div>
                        <h3 className="modal-header" style={{ color: 'var(--error, #cf6679)' }}>Payment Failed</h3>
                        <p style={{ textAlign: 'center', marginBottom: '25px', color: '#ccc' }}>
                            Your payment was not successful. Please try again or contact support if the problem persists.
                        </p>
                        <div className="modal-actions" style={{ flexDirection: 'column', gap: '12px' }}>
                            <button
                                onClick={onRetry}
                                className="btn btn-primary w-full"
                                style={{ background: 'linear-gradient(45deg, var(--primary, #03dac6), var(--secondary, #bb86fc))', color: 'black', fontWeight: 'bold', border: 'none' }}
                            >
                                Try Again
                            </button>
                            <button
                                onClick={onClose}
                                className="btn btn-secondary w-full"
                                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                            >
                                Close
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default PaymentResultModal;
