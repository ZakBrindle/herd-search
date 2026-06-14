import { Link } from 'react-router-dom';
import htmlContent from './policy.html?raw';

export default function PrivacyPolicy() {
  return (
    <div style={{
      padding: '1.5rem',
      maxWidth: '900px',
      margin: 'auto',
      fontFamily: "'Inter', sans-serif",
      backgroundColor: '#242436', // Dark background
      color: '#f3f4f6', // Light text
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box'
    }}>
      {/* --- HEADER --- */}
      <header style={{
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '2rem',
        padding: '1rem 1.5rem',
        backgroundColor: '#35354d', // Darker header background
        borderRadius: '0.75rem',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
        width: '100%',
        boxSizing: 'border-box'
      }}>
        <div style={{
          fontSize: '2rem',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          letterSpacing: '1px',
          fontWeight: 'bold'
        }}>
          <img src="/logo-main.png" alt="Logo" style={{ width: '40px', height: '40px', borderRadius: '8px' }} />
          <span>
            <span style={{ color: '#a855f7' }}>Herd</span> <span style={{ color: '#22d3ee' }}>Search</span>
          </span>
        </div>
        <Link to="/" style={{
          backgroundColor: '#494e61',
          color: '#fff',
          fontWeight: 600,
          padding: '0.6rem 1.25rem',
          borderRadius: '1.5rem',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          cursor: 'pointer',
          transition: 'all 0.2s ease-in-out',
          fontSize: '0.875rem',
          textDecoration: 'none',
          display: 'inline-flex',
          alignItems: 'center'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = '#7c5dfa';
          e.currentTarget.style.transform = 'translateY(-1px)';
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(124, 93, 250, 0.3)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = '#494e61';
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = 'none';
        }}
        >
          Back to App
        </Link>
      </header>

      {/* --- CONTENT CONTAINER --- */}
      <main className="policy-document-wrapper" style={{
        backgroundColor: '#ffffff',
        color: '#333333',
        padding: '3rem 2.5rem',
        borderRadius: '1rem',
        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.35)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        marginTop: '1rem',
        overflowX: 'auto',
        lineHeight: '1.6'
      }}>
        {/* Injecting CSS specifically for links in policy content */}
        <style dangerouslySetInnerHTML={{ __html: `
          .policy-document-wrapper a {
            color: #3b82f6 !important;
            text-decoration: underline !important;
          }
          .policy-document-wrapper a:hover {
            color: #1d4ed8 !important;
          }
        ` }} />
        <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
      </main>

      <footer style={{
        marginTop: '3rem',
        paddingTop: '1.5rem',
        borderTop: '1px solid rgba(255, 255, 255, 0.05)',
        textAlign: 'center',
        color: '#6b7280',
        fontSize: '0.875rem'
      }}>
        &copy; {new Date().getFullYear()} Herd Search. All rights reserved.
      </footer>
    </div>
  );
}
