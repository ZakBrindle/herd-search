import React from 'react';

interface PaymentResultModalProps {
    paymentStatus: 'success' | 'failure' | string; // Assuming it could be a string based on loose typing in App.tsx
    onClose: () => void;
    onGoToMap: () => void;
    onRetry: () => void;
}

const PaymentResultModal: React.FC<PaymentResultModalProps> = ({ paymentStatus, onClose, onGoToMap, onRetry }) => {
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                {paymentStatus === 'success' ? (
                    <>
                        <h3 className="modal-header" style={{ color: 'var(--primary)' }}>🎉 Payment Successful!</h3>
                        <p style={{ textAlign: 'center', marginBottom: '20px', fontSize: '1.1rem' }}>
                            Your payment was successful! You can now invite friends to your squad.
                        </p>
                        <div className="modal-actions" style={{ flexDirection: 'column', gap: '12px' }}>
                            <button
                                onClick={onGoToMap}
                                className="btn btn-primary w-full"
                                style={{ background: 'linear-gradient(45deg, var(--primary), var(--secondary))', color: 'black', fontWeight: 'bold' }}
                            >
                                Go to Map
                            </button>
                            <button
                                onClick={onClose}
                                className="btn btn-secondary w-full"
                            >
                                Close
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <h3 className="modal-header" style={{ color: 'var(--error)' }}>❌ Payment Failed</h3>
                        <p style={{ textAlign: 'center', marginBottom: '20px' }}>
                            Your payment was not successful. Please try again or contact support if the problem persists.
                        </p>
                        <div className="modal-actions" style={{ flexDirection: 'column', gap: '12px' }}>
                            <button
                                onClick={onRetry}
                                className="btn btn-primary w-full"
                            >
                                Try Again
                            </button>
                            <button
                                onClick={onClose}
                                className="btn btn-secondary w-full"
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
