import { Link } from 'react-router-dom';

export default function DeleteAccountPage() {
  return (
    <div style={{
      padding: '1.5rem',
      maxWidth: '600px',
      margin: 'auto',
      fontFamily: "'Inter', sans-serif",
      backgroundColor: '#242436', // Dark background matching the theme
      color: '#f3f4f6', // Light text
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      boxSizing: 'border-box'
    }}>
      <div>
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
            fontSize: '1.5rem',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            letterSpacing: '1px',
            fontWeight: 'bold'
          }}>
            <img src="/logo-main.png" alt="Logo" style={{ width: '32px', height: '32px', borderRadius: '6px' }} />
            <span>
              <span style={{ color: '#a855f7' }}>Herd</span> <span style={{ color: '#22d3ee' }}>Search</span>
            </span>
          </div>
          <Link to="/" style={{
            backgroundColor: '#494e61',
            color: '#fff',
            fontWeight: 600,
            padding: '0.5rem 1rem',
            borderRadius: '1.5rem',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            cursor: 'pointer',
            transition: 'all 0.2s ease-in-out',
            fontSize: '0.8rem',
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

        {/* --- CONTENT CARD --- */}
        <main style={{
          backgroundColor: '#33334d',
          color: '#f3f4f6',
          padding: '2.5rem 2rem',
          borderRadius: '1rem',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.25)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          marginTop: '1rem',
          lineHeight: '1.6'
        }}>
          <h2 style={{
            color: '#ff4b4b',
            marginTop: 0,
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '1.5rem'
          }}>
            ⚠️ Delete Your Account & Data
          </h2>
          
          <p style={{ fontSize: '1rem', color: '#e0e0e0', margin: '0 0 1.5rem 0' }}>
            We are sorry to see you go. If you would like to permanently delete your account and remove all associated data, please follow the steps below:
          </p>

          <div style={{
            backgroundColor: 'rgba(255, 75, 75, 0.1)',
            borderLeft: '4px solid #ff4b4b',
            padding: '1rem',
            borderRadius: '4px',
            marginBottom: '1.5rem'
          }}>
            <h4 style={{ margin: '0 0 0.5rem 0', color: '#ff4b4b' }}>How to request deletion:</h4>
            <p style={{ margin: 0, fontSize: '0.95rem', color: '#e0e0e0' }}>
              Email us at <a href="mailto:z4kbrindle@gmail.com" style={{ color: '#22d3ee', fontWeight: 'bold', textDecoration: 'underline' }}>z4kbrindle@gmail.com</a> with the subject line <strong>"Account Deletion Request"</strong>.
            </p>
          </div>

          <p style={{ fontSize: '0.9rem', color: '#aaa', margin: 0 }}>
            <strong>Note:</strong> Please send the email from the address associated with your Herd Search account. Once processed, all of your data—including your profile, location history, and squad memberships—will be permanently deleted and cannot be recovered.
          </p>
        </main>
      </div>

      <footer style={{
        marginTop: '3rem',
        paddingTop: '1.5rem',
        borderTop: '1px solid rgba(255, 255, 255, 0.05)',
        textAlign: 'center',
        color: '#6b7280',
        fontSize: '0.8rem'
      }}>
        &copy; {new Date().getFullYear()} Herd Search. All rights reserved.
      </footer>
    </div>
  );
}
