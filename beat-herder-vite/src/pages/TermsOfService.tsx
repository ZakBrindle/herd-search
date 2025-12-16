import React from 'react';

const TermsOfService = () => {
    return (
        <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto', color: '#e0e0e0', lineHeight: '1.6', fontFamily: 'sans-serif' }}>
            <h1 style={{ color: '#03dac6', borderBottom: '1px solid #333', paddingBottom: '1rem' }}>Terms of Service</h1>
            <p style={{ fontStyle: 'italic', color: '#888' }}>Last Updated: {new Date().toLocaleDateString()}</p>

            <section style={{ marginBottom: '2rem' }}>
                <h2>1. Introduction</h2>
                <p>Welcome to Beat Herder. By accessing or using our application, you agree to be bound by these Terms of Service. If you do not agree to all the terms and conditions, then you may not access the app or use any services.</p>
            </section>

            <section style={{ marginBottom: '2rem' }}>
                <h2>2. User Accounts</h2>
                <p>You must create an account to use certain features of the Service. You are responsible for maintaining the confidentiality of your account and password and for restricting access to your computer or device.</p>
                <p>We reserve the right to refuse service, terminate accounts, or remove content in our sole discretion.</p>
            </section>

            <section style={{ marginBottom: '2rem' }}>
                <h2>3. Location Services</h2>
                <p>Beat Herder relies on location services to function. By using the app, you grant us permission to access your location data to share it with your Squad according to your privacy settings.</p>
            </section>

            <section style={{ marginBottom: '2rem' }}>
                <h2>4. User Conduct</h2>
                <p>You agree not to use the Service for any unlawful purpose or to solicit others to perform or participate in any unlawful acts. Harassment, abuse, or harm to another person or group is strictly prohibited.</p>
            </section>

            <section style={{ marginBottom: '2rem' }}>
                <h2>5. Subscription Logic</h2>
                <p>We offer paid subscription tiers ("Squad Packs"). Payments are processed securely via Stripe. Subscriptions automatically renew unless cancelled at least 24 hours before the end of the current period.</p>
            </section>

            <section style={{ marginBottom: '2rem' }}>
                <h2>6. Limitation of Liability</h2>
                <p>In no event shall Beat Herder, its directors, employees, or agents be liable for any direct, indirect, incidental, special, or consequential damages arising from your use of the service.</p>
            </section>

            <section style={{ marginBottom: '2rem' }}>
                <h2>7. Contact Information</h2>
                <p>Questions about the Terms of Service should be sent to us at support@beatherder.app.</p>
            </section>

            <div style={{ marginTop: '3rem', textAlign: 'center' }}>
                <a href="/" style={{ color: '#03dac6', textDecoration: 'none', fontWeight: 'bold' }}>&larr; Back to App</a>
            </div>
        </div>
    );
};

export default TermsOfService;
