import React from 'react';
import { FaApple, FaAndroid, FaChevronLeft, FaShareSquare, FaEllipsisV } from 'react-icons/fa';
import { Link } from 'react-router-dom';

const InstallInstructionsPage: React.FC = () => {
    return (
        <div className="page-container" style={{ padding: '20px', maxWidth: '600px', margin: '0 auto', color: 'var(--text-color)' }}>
            <Link to="/about" className="back-link" style={{ display: 'flex', alignItems: 'center', marginBottom: '20px', color: 'var(--primary)', textDecoration: 'none' }}>
                <FaChevronLeft style={{ marginRight: '8px' }} /> Back to About
            </Link>

            <h1 className="page-title" style={{ textAlign: 'center', marginBottom: '30px' }}>Install App</h1>

            <p style={{ textAlign: 'center', marginBottom: '40px', color: '#ccc' }}>
                Install Herd Search to your home screen for the best experience, including full-screen map and easier access.
            </p>

            <div className="install-section" style={{ marginBottom: '40px' }}>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid #333', paddingBottom: '10px' }}>
                    <FaApple style={{ fontSize: '1.5rem' }} /> iOS (iPhone/iPad)
                </h2>
                <ol style={{ lineHeight: '1.8', paddingLeft: '20px', marginTop: '15px' }}>
                    <li>Tap the <strong>Share</strong> button <FaShareSquare style={{ verticalAlign: 'middle', margin: '0 4px' }} /> in Safari's toolbar.</li>
                    <li>Scroll down the share sheet.</li>
                    <li>Tap <strong>Add to Home Screen</strong>.</li>
                    <li>Tap <strong>Add</strong> in the top right corner.</li>
                </ol>
            </div>

            <div className="install-section">
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid #333', paddingBottom: '10px' }}>
                    <FaAndroid style={{ fontSize: '1.5rem', color: '#3ddc84' }} /> Android (Chrome)
                </h2>
                <ol style={{ lineHeight: '1.8', paddingLeft: '20px', marginTop: '15px' }}>
                    <li>Tap the <strong>Menu</strong> button <FaEllipsisV style={{ verticalAlign: 'middle', margin: '0 4px' }} /> (three dots) in Chrome.</li>
                    <li>Tap <strong>Install App</strong> or <strong>Add to Home screen</strong>.</li>
                    <li>Follow the on-screen prompts to install.</li>
                </ol>
            </div>
        </div>
    );
};

export default InstallInstructionsPage;
