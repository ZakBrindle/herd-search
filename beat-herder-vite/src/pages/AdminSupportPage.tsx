import { useEffect, useState } from 'react';
import SupportSystem from '../components/SupportSystem';
import { getAuth } from 'firebase/auth';

const AdminSupportPage = () => {
    const auth = getAuth();
    const [currentUser, setCurrentUser] = useState(auth.currentUser);

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(user => {
            setCurrentUser(user);
        });
        return () => unsubscribe();
    }, [auth]);

    if (!currentUser) return <div style={{ padding: '2rem', color: '#fff' }}>Loading or Unauthorized...</div>;

    // Optional: Add logic here to verify if user is actually admin/dev
    // For now we assume the button to get here is hidden for non-admins

    return (
        <SupportSystem
            currentUser={{
                uid: currentUser.uid,
                email: currentUser.email || undefined,
                displayName: currentUser.displayName || undefined
            }}
            visible={true}
            isDev={true}
            isModal={false}
        />
    );
};

export default AdminSupportPage;
