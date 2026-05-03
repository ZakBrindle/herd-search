import React from 'react';

interface InstallModalProps {
    onClose: () => void;
}

const InstallModal: React.FC<InstallModalProps> = ({ onClose }) => {
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <h3 className="modal-header">Install App</h3>

                <p style={{ textAlign: 'center', marginBottom: '30px', color: '#ccc' }}>
                    Install Herd Search to your home screen for the best experience, including full-screen map and easier access.
                </p>

                <div style={{ marginBottom: '30px' }}>
                    <h4 style={{ display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid #333', paddingBottom: '10px', marginBottom: '15px' }}>
                        <span style={{ fontSize: '1.5rem' }}>🍎</span> iOS (iPhone/iPad)
                    </h4>
                    <ol style={{ lineHeight: '1.8', paddingLeft: '20px' }}>
                        <li>Tap the <strong>Share</strong> button 📤 in Safari's toolbar.</li>
                        <li>Scroll down the share sheet.</li>
                        <li>Tap <strong>Add to Home Screen</strong>.</li>
                        <li>Tap <strong>Add</strong> in the top right corner.</li>
                    </ol>
                </div>

                <div style={{ marginBottom: '20px' }}>
                    <h4 style={{ display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid #333', paddingBottom: '10px', marginBottom: '15px' }}>
                        <span style={{ fontSize: '1.5rem', color: '#3ddc84' }}>🤖</span> Android (Chrome)
                    </h4>
                    <ol style={{ lineHeight: '1.8', paddingLeft: '20px' }}>
                        <li>Tap the <strong>Menu</strong> button ⋮ (three dots) in Chrome.</li>
                        <li>Tap <strong>Install App</strong> or <strong>Add to Home screen</strong>.</li>
                        <li>Follow the on-screen prompts to install.</li>
                    </ol>
                </div>

                <div className="modal-actions">
                    <button onClick={onClose} className="btn btn-primary">Done</button>
                </div>
            </div>
        </div>
    );
};

export default InstallModal;
