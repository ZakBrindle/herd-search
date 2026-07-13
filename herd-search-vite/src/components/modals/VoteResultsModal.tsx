import React from 'react';
import { FaTimes, FaCheck, FaTimesCircle } from 'react-icons/fa';
import { getAvatarUrl } from '../../utils/userUtils';

interface VoteResultsModalProps {
    onClose: () => void;
    content: string;
    votes: Array<{
        uid: string;
        vote: 'yes' | 'no';
        displayName: string;
        photoURL?: string;
    }>;
}

const VoteResultsModal: React.FC<VoteResultsModalProps> = ({ onClose, content, votes }) => {
    const yesVoters = votes.filter(v => v.vote === 'yes');
    const noVoters = votes.filter(v => v.vote === 'no');

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', padding: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid #333', paddingBottom: '10px' }}>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--primary)' }}>Vote Results</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '1.2rem', display: 'flex', alignItems: 'center' }}>
                        <FaTimes />
                    </button>
                </div>

                <div style={{ textAlign: 'center', background: 'rgba(255, 255, 255, 0.05)', padding: '12px', borderRadius: '8px', marginBottom: '20px', fontWeight: '600', color: 'white', fontSize: '0.95rem', lineHeight: '1.4' }}>
                    {content}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxHeight: '50vh', overflowY: 'auto', paddingRight: '4px' }}>
                    {/* Lets Go Section */}
                    <div>
                        <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--primary)', borderBottom: '1px solid rgba(0, 230, 118, 0.2)', paddingBottom: '6px', marginBottom: '10px', fontSize: '0.95rem' }}>
                            <FaCheck /> Lets Go ({yesVoters.length})
                        </h4>
                        {yesVoters.length === 0 ? (
                            <div style={{ color: '#666', fontSize: '0.85rem', fontStyle: 'italic', paddingLeft: '10px' }}>No votes</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {yesVoters.map(v => (
                                    <div key={v.uid} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,255,255,0.02)', padding: '6px 12px', borderRadius: '8px' }}>
                                        <img 
                                            src={getAvatarUrl(v.photoURL, v.displayName)} 
                                            alt={v.displayName} 
                                            style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }}
                                        />
                                        <span style={{ fontSize: '0.9rem', color: '#e0e0e0' }}>{v.displayName}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* F*** That Section */}
                    <div>
                        <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--error)', borderBottom: '1px solid rgba(255, 23, 68, 0.2)', paddingBottom: '6px', marginBottom: '10px', fontSize: '0.95rem' }}>
                            <FaTimesCircle /> F*** That ({noVoters.length})
                        </h4>
                        {noVoters.length === 0 ? (
                            <div style={{ color: '#666', fontSize: '0.85rem', fontStyle: 'italic', paddingLeft: '10px' }}>No votes</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {noVoters.map(v => (
                                    <div key={v.uid} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,255,255,0.02)', padding: '6px 12px', borderRadius: '8px' }}>
                                        <img 
                                            src={getAvatarUrl(v.photoURL, v.displayName)} 
                                            alt={v.displayName} 
                                            style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }}
                                        />
                                        <span style={{ fontSize: '0.9rem', color: '#e0e0e0' }}>{v.displayName}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="modal-actions" style={{ marginTop: '24px' }}>
                    <button onClick={onClose} className="btn btn-primary" style={{ width: '100%' }}>Close</button>
                </div>
            </div>
        </div>
    );
};

export default VoteResultsModal;
