"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from "firebase/auth";
import { 
  doc, onSnapshot, setDoc, getDoc, updateDoc, arrayUnion, collection, 
  query, where, getDocs, addDoc, deleteDoc, DocumentData 
} from "firebase/firestore";
import { auth, db } from '../lib/firebase';
import styles from './page.module.css';
import { FaMapMarkerAlt, FaCog } from 'react-icons/fa';

// Define types for our data for better TypeScript support
type Point = { x: number; y: number };
type Area = { id: string; name: string; polygon: Point[] };
type FriendData = DocumentData & { uid: string; location?: Point; photoURL?: string; displayName?: string; currentArea?: string };

// --- Main Page Component ---
export default function HomePage() {
  // State Management
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<FriendData | null>(null);
  const [friendsData, setFriendsData] = useState<FriendData[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [isDevMode, setIsDevMode] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [friendEmail, setFriendEmail] = useState('');
  const [areaName, setAreaName] = useState('');
  const [alertMessage, setAlertMessage] = useState('');

  // Refs for DOM elements that need direct manipulation (like canvas)
  const mapImageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentPolygonPoints = useRef<Point[]>([]);

  // --- Utility & Helper Functions ---
  const showAlert = (message: string) => {
    setAlertMessage(message);
    setActiveModal('alert');
  };

  const getPublicProfileCollection = () => collection(db, `public/user_profiles/users`);
  const getUserDocRef = (uid: string) => doc(db, 'users', uid);

  // --- Canvas Drawing Logic ---
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw saved areas
    areas.forEach(area => {
      drawPolygon(ctx, area.polygon, 'rgba(29, 78, 216, 0.3)', 'rgba(29, 78, 216, 0.7)');
    });

    // Draw the current polygon being created by the developer
    if (isDevMode && currentPolygonPoints.current.length > 0) {
      drawPolygon(ctx, currentPolygonPoints.current, 'rgba(255, 255, 0, 0.3)', 'rgba(255, 255, 0, 0.7)');
    }
  }, [areas, isDevMode]);

  const drawPolygon = (ctx: CanvasRenderingContext2D, points: Point[], fill: string, stroke: string) => {
    if (points.length < 1) return;
    const canvas = canvasRef.current!;
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(points[0].x * canvas.width, points[0].y * canvas.height);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x * canvas.width, points[i].y * canvas.height);
    }
    if (points.length > 2) {
      ctx.closePath();
      ctx.fill();
    }
    ctx.stroke();
  };

  // Resize canvas whenever the map image resizes
  useEffect(() => {
    const canvas = canvasRef.current;
    const mapImage = mapImageRef.current;
    if (!canvas || !mapImage) return;

    const resizeObserver = new ResizeObserver(() => {
      canvas.width = mapImage.clientWidth;
      canvas.height = mapImage.clientHeight;
      redrawCanvas();
    });

    resizeObserver.observe(mapImage);
    return () => resizeObserver.disconnect();
  }, [redrawCanvas]);


  // --- Firebase & App Logic ---
  const handlePasscodeSubmit = () => {
    // In a real app, this would be a secure check.
    if (passcode === '1979') {
      setIsDevMode(true);
      setActiveModal('locations');
    } else {
      showAlert("Incorrect passcode.");
    }
    setPasscode('');
  };

  const handleSaveArea = async () => {
    if (!areaName || currentPolygonPoints.current.length < 3) {
      return showAlert("Please provide a name and draw a valid shape (at least 3 points).");
    }
    try {
      await addDoc(collection(db, 'areas'), {
        name: areaName,
        polygon: currentPolygonPoints.current,
      });
      currentPolygonPoints.current = [];
      setAreaName('');
      setIsDevMode(false);
      setActiveModal(null);
      redrawCanvas();
    } catch (error) {
      console.error("Error saving area:", error);
      showAlert("Could not save area.");
    }
  };
  
  const handleAddFriend = async () => {
    if (!friendEmail || !currentUser) return;
    try {
      const q = query(getPublicProfileCollection(), where("email", "==", friendEmail.toLowerCase()));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        return showAlert("User not found. Ensure they have signed in at least once.");
      }
      
      const friendUid = querySnapshot.docs[0].id;
      if (friendUid === currentUser.uid) {
        return showAlert("You can't add yourself as a friend!");
      }

      await updateDoc(getUserDocRef(currentUser.uid), {
        friends: arrayUnion(friendUid)
      });
      
      showAlert("Friend added successfully!");
      setFriendEmail('');
      setActiveModal(null);
    } catch (error) {
       console.error("Error adding friend:", error);
       showAlert("An error occurred while adding the friend.");
    }
  };


  // --- UseEffect Hooks for Data Subscriptions ---
  useEffect(() => {
    // Auth state listener
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);
        const userRef = getUserDocRef(user.uid);
        const publicProfileRef = doc(getPublicProfileCollection(), user.uid);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists()) {
          const profileData = {
            uid: user.uid,
            displayName: user.displayName,
            email: user.email?.toLowerCase(),
            photoURL: user.photoURL
          };
          await setDoc(userRef, { ...profileData, friends: [], location: null, currentArea: 'unknown' });
          await setDoc(publicProfileRef, profileData);
        }
      } else {
        setCurrentUser(null);
        setUserData(null);
        setFriendsData([]);
      }
    });

    // Areas listener
    const unsubscribeAreas = onSnapshot(collection(db, "areas"), (snapshot) => {
        const areasData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Area[];
        setAreas(areasData);
    });

    return () => {
      unsubscribeAuth();
      unsubscribeAreas();
    };
  }, [redrawCanvas]);
  
  // Effect for listening to user and friend data changes
  useEffect(() => {
    if (!currentUser) return;

    const unsubUser = onSnapshot(getUserDocRef(currentUser.uid), (doc) => {
      setUserData(doc.data() as FriendData);
    });

    let friendUnsubs: (() => void)[] = [];
    if (userData?.friends && userData.friends.length > 0) {
      friendUnsubs = userData.friends.map((friendId: string) =>
        onSnapshot(getUserDocRef(friendId), (doc) => {
          setFriendsData(prev => {
            const otherFriends = prev.filter(f => f.uid !== friendId);
            return [...otherFriends, { uid: doc.id, ...doc.data() }];
          });
        })
      );
    }
    
    return () => {
      unsubUser();
      friendUnsubs.forEach(unsub => unsub());
    };
  }, [currentUser, userData?.friends]);
  
  // Redraw canvas whenever areas data changes
  useEffect(() => {
    redrawCanvas();
  }, [areas, redrawCanvas]);


  // --- Main Render Logic ---
  if (!currentUser) {
    return (
      <div className={styles.container}>
        <header className={styles.header}>
            <h1 className={styles.headerTitle}>Beat-Herder Friend Finder</h1>
            <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className={styles.primaryButton}>Sign in with Google</button>
        </header>
        <div className={styles.card} style={{textAlign: 'center', padding: '2rem'}}>
            <h2 className={styles.headerTitle}>Welcome!</h2>
            <p>Please sign in to find your friends and see the map.</p>
        </div>
      </div>
    );
  }
  
  const allUsersOnMap = [userData, ...friendsData].filter(
    (u): u is FriendData => !!u && !!u.location
  );

  return (
    <div className={styles.container}>
      {/* --- HEADER --- */}
      <header className={styles.header}>
        <div>
          <h1 className={styles.headerTitle}>Beat-Herder Friend Finder</h1>
          <p className={styles.headerSubtitle}>Stay connected with your crew at the festival.</p>
        </div>
        <button onClick={() => signOut(auth)} className={styles.dangerButton}>Sign Out</button>
      </header>

      {/* --- USER/DEV CONTROLS --- */}
      <div className={styles.card} style={{ justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {userData?.photoURL && <Image src={userData.photoURL} alt="avatar" width={40} height={40} style={{ borderRadius: '50%' }} />}
          <span style={{ fontWeight: 600 }}>{userData?.displayName}</span>
          <button onClick={() => setActiveModal('settings')} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><FaCog size={20} /></button>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => setActiveModal('passcode')} className={styles.secondaryButton}>Developer Mode</button>
          <button onClick={() => setActiveModal('addFriend')} className={styles.primaryButton}>Add Friend</button>
        </div>
      </div>
      
      {isDevMode && (
          <div className={styles.devPanel}>
              <h3 style={{fontWeight: 700}}>Developer Mode: Drawing Area</h3>
              <p>Click on the map to draw. Click the first point again to close and name the shape.</p>
          </div>
      )}
      
      {/* --- MAP --- */}
      <div className={styles.mapContainer}>
        <img
          ref={mapImageRef}
          src="/Beatherder Map.png"
          alt="Beat-Herder Festival Map"
          width={1200}
          height={800}
          className={styles.mapImage}
          style={{ display: 'block' }}
          onError={e => { (e.target as HTMLImageElement).style.background = '#fdd'; }}
        />
        <canvas ref={canvasRef} className={styles.mapCanvas} />
        {allUsersOnMap.map(u => (
          <div
            key={u.uid}
            className={styles.userMarker}
            style={{ left: `${u.location!.x * 100}%`, top: `${u.location!.y * 100}%` }}
          >
            <img
              src={u.photoURL || "/default-avatar.png"}
              alt={u.displayName || "User"}
            />
            <div className={styles.nameLabel}>
              {(u.displayName?.split(' ')[0]) || "User"}
            </div>
          </div>
        ))}
      </div>
      
      {/* --- SQUAD LIST --- */}
      <div className={styles.squadList}>
          {userData && <div className={`${styles.card} ${styles.currentUserCard}`}>
              <Image src={userData.photoURL!} alt="avatar" width={48} height={48} style={{borderRadius: '50%'}} />
              <div>
                  <p style={{fontWeight: 'bold'}}>{userData.displayName} (You)</p>
                  <p style={{fontSize: '0.9rem'}}>Location: <span style={{fontWeight: 600}}>{userData.currentArea || 'Unknown'}</span></p>
              </div>
          </div>}
          {friendsData.map(friend => (
              <div key={friend.uid} className={styles.card}>
                  <Image src={friend.photoURL!} alt="avatar" width={48} height={48} style={{borderRadius: '50%'}} />
                  <div>
                      <p style={{fontWeight: 'bold'}}>{friend.displayName}</p>
                      <p style={{fontSize: '0.9rem'}}>Location: <span style={{fontWeight: 600}}>{friend.currentArea || 'Unknown'}</span></p>
                  </div>
              </div>
          ))}
      </div>

      {/* --- FLOATING BUTTON --- */}
      <button className={styles.floatingButton}><FaMapMarkerAlt />Check In</button>

      {/* --- MODALS --- */}
      {activeModal && (
        <div className={styles.modalOverlay} onClick={() => setActiveModal(null)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            {activeModal === 'passcode' && (<>
              <h3 className={styles.modalHeader}>Enter Developer Passcode</h3>
              <input type="password" value={passcode} onChange={e => setPasscode(e.target.value)} className={styles.textInput} />
              <div className={styles.modalActions}>
                <button onClick={() => setActiveModal(null)} className={styles.neutralButton}>Cancel</button>
                <button onClick={handlePasscodeSubmit} className={styles.secondaryButton}>Submit</button>
              </div>
            </>)}
            {activeModal === 'addFriend' && (<>
              <h3 className={styles.modalHeader}>Add a Friend</h3>
              <input type="email" placeholder="friend@example.com" value={friendEmail} onChange={e => setFriendEmail(e.target.value)} className={styles.textInput} />
              <div className={styles.modalActions}>
                <button onClick={() => setActiveModal(null)} className={styles.neutralButton}>Cancel</button>
                <button onClick={handleAddFriend} className={styles.primaryButton}>Add</button>
              </div>
            </>)}
            {activeModal === 'alert' && (<>
                <p>{alertMessage}</p>
                <div className={styles.modalActions}>
                    <button onClick={() => setActiveModal(null)} className={styles.primaryButton}>OK</button>
                </div>
            </>)}
            {/* You can add more modals here like 'settings', 'areaName', etc. following the same pattern */}
          </div>
        </div>
      )}
    </div>
  );
}