import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { type User, onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, onSnapshot, getDoc, setDoc, updateDoc, collection, addDoc, type DocumentData } from 'firebase/firestore';
import { auth, db } from '../firebase';

// --- Types (Copied from App.tsx for consistency) ---
export type Point = { x: number; y: number };
export type Tier = 'free' | 'basic' | 'standard' | 'premium' | 'festival' | 'dev_tier_test';

export type UserData = DocumentData & {
    uid: string;
    location?: Point;
    photoURL?: string;
    displayName?: string;
    currentArea?: string;
    lastKnownArea?: string;
    friends?: string[];
    useGps?: boolean;
    lastUpdate?: number;
    squadId?: string;
    squadOwnerId?: string;
    tier?: Tier;
    subscriptionExpiry?: number;
    email?: string;
    ghostMode?: boolean;
    ghostModeExpiry?: number;
    isDev?: boolean;
    statusMessage?: string;
    statusTimestamp?: number;
    isPaymentPending?: boolean;
    fcmToken?: string;
    ghostModeCooldown?: number;
    hasSeenWelcome?: boolean;
    searchingFor?: { uid: string; timestamp: number };
    mapPreference?: 'cartoon_light' | 'cartoon_dark' | 'satellite' | 'dynamic' | 'cartoon';
    hasRated?: boolean;
};

interface AuthContextType {
    currentUser: User | null;
    userData: UserData | null;
    loading: boolean;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [userData, setUserData] = useState<UserData | null>(null);
    const [loading, setLoading] = useState(true);

    // Auth Listener
    useEffect(() => {
        const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
            try {
                if (user) {
                    setCurrentUser(user);
                    const userRef = doc(db, 'users', user.uid);
                    const publicProfileRef = doc(db, 'public/user_profiles/users', user.uid);

                    let userDoc;
                    try {
                        userDoc = await getDoc(userRef);
                    } catch (e) {
                        console.error("Error fetching user doc during init:", e);
                        throw e;
                    }

                    const envEmail = import.meta.env.VITE_ZAKS_PERSONAL_EMAIL_ADDRESS?.toLowerCase();
                    // Ensure isDev is explicitly boolean true or false. NEVER undefined.
                    const isDev = !!(user.email?.toLowerCase() === 'z4kbrindle@gmail.com' || (envEmail && user.email?.toLowerCase() === envEmail));

                    if (!userDoc.exists()) {
                        console.log("Creating new user profile...");
                        const profileData = {
                            uid: user.uid,
                            displayName: user.displayName,
                            email: user.email?.toLowerCase(),
                            photoURL: user.photoURL,
                            tier: 'free' as Tier,
                            isDev // Now guaranteed boolean
                        };

                        // Create User Doc
                        await setDoc(userRef, {
                            ...profileData,
                            friends: [],
                            location: null,
                            currentArea: 'unknown',
                            useGps: true,
                            lastKnownArea: 'unknown',
                            hasSeenWelcome: false
                        });
                        await setDoc(publicProfileRef, profileData);

                        // Create Squad
                        const squadDoc = await addDoc(collection(db, "squads"), {
                            ownerId: user.uid,
                            members: [user.uid],
                            pendingMembers: [],
                            createdAt: Date.now(),
                        });

                        // Link Squad
                        await updateDoc(userRef, {
                            squadId: squadDoc.id,
                            squadOwnerId: user.uid,
                        });
                    } else {
                        // Existing user checks
                        const updates: any = {};
                        if (isDev) updates.isDev = true;
                        const data = userDoc.data();
                        if (!data?.tier) updates.tier = 'free';
                        if (!data?.squadId) {
                            const squadDoc = await addDoc(collection(db, "squads"), {
                                ownerId: user.uid,
                                members: [user.uid],
                                pendingMembers: [],
                                createdAt: Date.now(),
                            });
                            updates.squadId = squadDoc.id;
                            updates.squadOwnerId = user.uid;
                        }
                        if (Object.keys(updates).length > 0) {
                            await updateDoc(userRef, updates);
                        }
                    }
                } else {
                    setCurrentUser(null);
                    setUserData(null);
                }
            } catch (err) {
                console.error("Critical Auth Init Error:", err);
                // Force logout so user is not stuck in limbo
                await firebaseSignOut(auth);
                setCurrentUser(null);
                setUserData(null);
            } finally {
                setLoading(false);
            }
        });

        return () => unsubscribeAuth();
    }, []);

    // UserData Listener
    useEffect(() => {
        if (!currentUser?.uid) {
            if (!loading) setUserData(null);
            return;
        }

        const unsubUser = onSnapshot(doc(db, 'users', currentUser.uid), (doc) => {
            if (doc.exists()) {
                setUserData(doc.data() as UserData);
            }
        });
        return () => unsubUser();
    }, [currentUser?.uid, loading]);

    const signOut = () => {
        return firebaseSignOut(auth);
    };

    return (
        <AuthContext.Provider value={{ currentUser, userData, loading, signOut }}>
            {children}
        </AuthContext.Provider>
    );
}
