

import { Link } from 'react-router-dom';

const TermsOfService = () => {
    return (
        <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto', color: '#e0e0e0', lineHeight: '1.6', fontFamily: 'sans-serif' }}>
            <h1 style={{ color: '#03dac6', borderBottom: '1px solid #333', paddingBottom: '1rem' }}>Terms of Service</h1>
            <p style={{ fontStyle: 'italic', color: '#888' }}>Last Updated: {new Date().toLocaleDateString()}</p>

            <section style={{ marginBottom: '2rem', padding: '1rem', border: '1px solid #ff9800', borderRadius: '8px', background: 'rgba(255, 152, 0, 0.1)' }}>
                <h2 style={{ color: '#ff9800', marginTop: 0 }}>⚠️ Affiliation Disclaimer</h2>
                <p><strong>Herd Search</strong> is an independent fan-made application designed to enhance the festival experience.</p>
                <p>We are <strong>NOT</strong> affiliated, associated, authorized, endorsed by, or in any way officially connected with the <strong>Beat Herder Festival</strong>, or any of its subsidiaries or its affiliates. The official Beat Herder Festival website can be found at <a href="https://beatherder.co.uk" target="_blank" rel="noopener noreferrer" style={{ color: '#03dac6' }}>beatherder.co.uk</a>.</p>
            </section>

            <section style={{ marginBottom: '2rem' }}>
                <h2>1. Introduction</h2>
                <p>Welcome to Herd Search. By accessing or using our application, you agree to be bound by these Terms of Service. If you do not agree to all the terms and conditions, then you may not access the app or use any services.</p>
            </section>

            <section style={{ marginBottom: '2rem' }}>
                <h2>2. User Accounts</h2>
                <p>You must create an account to use certain features of the Service. You are responsible for maintaining the confidentiality of your account and password and for restricting access to your computer or device.</p>
                <p>We reserve the right to refuse service, terminate accounts, or remove content in our sole discretion.</p>
            </section>

            <section style={{ marginBottom: '2rem' }}>
                <h2>3. Location Services</h2>
                <p>Herd Search includes optional, experimental GPS tracking features. While location services enhance the experience by allowing you to share your position with your Squad, they are not required for the core functionality of the app. You can choose to enable or disable these permissions at any time.</p>
            </section>

            <section style={{ marginBottom: '2rem' }}>
                <h2>4. User Conduct</h2>
                <p>You agree not to use the Service for any unlawful purpose or to solicit others to perform or participate in any unlawful acts. Harassment, abuse, or harm to another person or group is strictly prohibited.</p>
            </section>

            <section style={{ marginBottom: '2rem' }}>
                <h2>5. Subscription Logic</h2>
                <p>We offer paid access tiers ("Squad Packs"). Payments are processed securely via Stripe. These are one-time payments granting access for a period of 30 days. Subscriptions do <strong>NOT</strong> automatically renew; you must manually purchase a new pass after your access expires.</p>
            </section>

            <section style={{ marginBottom: '2rem' }}>
                <h2>6. Personalisation Package (One-Time Purchase)</h2>
                <p>We offer a one-time, permanent purchase to unlock additional premium avatar customisations (the "Personalise Package"). Unlike the time-limited Squad Packs, the Personalise Package is a permanent purchase associated with your user account and does <strong>NOT</strong> expire. We grant a non-transferable, non-exclusive license to use these decorative enhancements solely within the Service. This purchase is final and non-refundable, except as required by applicable law.</p>
            </section>

            <section style={{ marginBottom: '2rem' }}>
                <h2>7. Limitation of Liability</h2>
                <p>In no event shall Herd Search, its directors, employees, or agents be liable for any direct, indirect, incidental, special, or consequential damages arising from your use of the service.</p>
            </section>

            <section style={{ marginBottom: '2rem' }}>
                <h2>8. Contact Information</h2>
                <p>Questions about the Terms of Service should be sent to us at z4kbrindle@gmail.com.</p>
            </section>

            <div style={{ marginTop: '3rem', textAlign: 'center' }}>
                <Link to="/" style={{ color: '#03dac6', textDecoration: 'none', fontWeight: 'bold' }}>&larr; Back to App</Link>
            </div>
        </div>
    );
};

export default TermsOfService;
