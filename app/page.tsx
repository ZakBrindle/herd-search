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
import { FaMapMarkerAlt, FaCog, FaTrash } from 'react-icons/fa';

// --- Type Definitions ---
type Point = { x: number; y: number };
type Area = { id: string; name: string; polygon: Point[] };
type UserData = DocumentData & { 
    uid: string; 
    location?: Point; 
    photoURL?: string; 
    displayName?: string; 
    currentArea?: string; 
    friends?: string[];
    useGps?: boolean;
};
type ConfirmAction = {
    message: string;
    onConfirm: () => void;
};

// --- Main Page Component ---
export default function HomePage() {
  // --- State Management ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [friendsData, setFriendsData] = useState<UserData[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [isDevMode, setIsDevMode] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [friendEmail, setFriendEmail] = useState('');
  const [areaName, setAreaName] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
   const [isDeveloper, setIsDeveloper] = useState(false);

  // --- Refs ---
  const mapImageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentPolygonPoints = useRef<Point[]>([]);

  // --- Utility & Helper Functions ---
  const showAlert = (message: string) => {
    setAlertMessage(message);
    setActiveModal('alert');
  };

  const showConfirm = (message: string, onConfirm: () => void) => {
    setConfirmAction({ message, onConfirm });
    setActiveModal('confirm');
  };

  const getPublicProfileCollection = () => collection(db, `public/user_profiles/users`);
  const getUserDocRef = (uid: string) => doc(db, 'users', uid);

  const isPointInPolygon = (point: Point, polygon: Point[]): boolean => {
    if (!polygon) return false;
    let isInside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        const intersect = ((yi > point.y) !== (yj > point.y)) && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
        if (intersect) isInside = !isInside;
    }
    return isInside;
  };

  // --- Canvas Drawing & Map Logic ---
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    areas.forEach(area => {
      drawPolygon(ctx, area.polygon, 'rgba(29, 78, 216, 0.3)', 'rgba(29, 78, 216, 0.7)');
    });

    if (isDevMode && currentPolygonPoints.current.length > 0) {
      drawPolygon(ctx, currentPolygonPoints.current, 'rgba(255, 255, 0, 0.3)', 'rgba(255, 255, 0, 0.7)', true);
    }
  }, [areas, isDevMode]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const mapImage = mapImageRef.current;
    if (!canvas || !mapImage) return;
    if (mapImage.clientWidth > 0) {
      canvas.width = mapImage.clientWidth;
      canvas.height = mapImage.clientHeight;
      redrawCanvas();
    }
  }, [redrawCanvas]);

  const drawPolygon = (ctx: CanvasRenderingContext2D, points: Point[], fill: string, stroke: string, drawVertices = false) => {
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

    if (drawVertices) {
        ctx.fillStyle = 'yellow';
        points.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x * canvas.width, p.y * canvas.height, 5, 0, 2 * Math.PI);
            ctx.fill();
        });
    }
  };

  // Remove ResizeObserver effect

  // Redraw canvas whenever areas data changes
  useEffect(() => {
    redrawCanvas();
  }, [areas, redrawCanvas]);

  // Add window resize listener
  useEffect(() => {
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [resizeCanvas]);

  // --- Event Handlers & App Logic ---

  const handlePasscodeSubmit = () => {
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

  const handleDeleteArea = async (areaId: string) => {
    const areaName = areas.find(a => a.id === areaId)?.name || 'the selected area';
    showConfirm(`Are you sure you want to delete "${areaName}"?`, async () => {
        try {
            await deleteDoc(doc(db, 'areas', areaId));
            showAlert("Area deleted successfully.");
        } catch (error) {
            console.error("Error deleting area:", error);
            showAlert("Could not delete the area.");
        }
    });
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

      const userFriends = userData?.friends || [];
      if (userFriends.includes(friendUid)) {
        return showAlert("This user is already your friend.");
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

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDevMode || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const pos = {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height
    };

    if (currentPolygonPoints.current.length > 2) {
        const firstPoint = currentPolygonPoints.current[0];
        const clickRadius = 15 / canvas.width; 
        if (Math.hypot(pos.x - firstPoint.x, pos.y - firstPoint.y) < clickRadius) {
            setActiveModal('areaName');
            return;
        }
    }

    currentPolygonPoints.current.push(pos);
    redrawCanvas();
  };

  const handleManualCheckIn = async (area: Area) => {
    if (!currentUser || !area.polygon) return;
    let cx = 0, cy = 0;
    area.polygon.forEach(p => {
        cx += p.x;
        cy += p.y;
    });
    const centroid = {
        x: cx / area.polygon.length,
        y: cy / area.polygon.length,
    };

    try {
        await updateDoc(getUserDocRef(currentUser.uid), {
            location: centroid,
            currentArea: area.name
        });
        setActiveModal(null);
    } catch (error) {
        console.error("Error checking in manually:", error);
        showAlert("Could not perform check-in.");
    }
  };

  const handleGpsToggle = async (useGps: boolean) => {
    if (!currentUser) return;
    // Optimistically update UI
    setUserData(prev => prev ? { ...prev, useGps } : prev);
    try {
        await updateDoc(getUserDocRef(currentUser.uid), { useGps });
    } catch (error) {
        // Revert if error
        setUserData(prev => prev ? { ...prev, useGps: !useGps } : prev);
        console.error("Error updating GPS preference:", error);
        showAlert("Could not save setting.");
    }
  };

  const cancelDrawing = () => {
    currentPolygonPoints.current = [];
    setIsDevMode(false);
    redrawCanvas();
  };

  // --- Data Subscription Hooks ---
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
          await setDoc(userRef, { ...profileData, friends: [], location: null, currentArea: 'unknown', useGps: true });
          await setDoc(publicProfileRef, profileData);
        }
      } else {
        setCurrentUser(null);
        setUserData(null);
        setFriendsData([]);
        setIsDevMode(false);
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
  }, []);
  
  // User and friends data listener
  useEffect(() => {
    if (!currentUser?.uid) {
      setUserData(null);
      setFriendsData([]);
      setIsDeveloper(false); // Reset on logout
      return;
    }

    const unsubUser = onSnapshot(getUserDocRef(currentUser.uid), (doc) => {
     const data = doc.data() as UserData;
      setUserData(data);
      // Check if the user is the developer
      if (data?.displayName === 'Zak Brindle') {
        setIsDeveloper(true);
      } else {
        setIsDeveloper(false);
      }
    });
    
    // This effect will re-run when userData or userData.friends changes
    const friendIds = userData?.friends || [];
    const unsubscribes = friendIds.map(friendId => 
      onSnapshot(getUserDocRef(friendId), (doc) => {
        const friendData = { uid: doc.id, ...doc.data() } as UserData;
        setFriendsData(prevFriends => {
          // Replace or add the updated friend data
          const existingFriendIndex = prevFriends.findIndex(f => f.uid === friendId);
          if (existingFriendIndex > -1) {
            const newFriends = [...prevFriends];
            newFriends[existingFriendIndex] = friendData;
            return newFriends;
          } else {
            return [...prevFriends, friendData];
          }
        });
      })
    );
    
    // Cleanup friends that were removed
    setFriendsData(prevFriends => prevFriends.filter(f => friendIds.includes(f.uid)));

    return () => {
      unsubUser();
      unsubscribes.forEach(unsub => unsub());
    };
  }, [currentUser?.uid, userData?.friends?.join(',')]); // Depend on joined string of friend UIDs

  // --- MOCK LOCATION UPDATER ---
  useEffect(() => {
    // Always update location for the current user for testing (bouncing around)
    if (!currentUser) return;
    const intervalId = setInterval(() => {
      // Only update if userData exists
      if (userData) {
        // Bounce around the map
        const t = Date.now() / 1000;
        const x = 0.5 + 0.4 * Math.sin(t / 5);
        const y = 0.5 + 0.4 * Math.cos(t / 7);
        let newAreaName = 'The Wilds';
        for (const area of areas) {
            if (isPointInPolygon({ x, y }, area.polygon)) {
                newAreaName = area.name;
                break;
            }
        }
        updateDoc(getUserDocRef(currentUser.uid), {
            location: { x, y },
            currentArea: newAreaName
        }).catch(err => console.error("Error in mock location update: ", err));
      }
    }, 2000); // Update every 2 seconds for more visible movement

    return () => clearInterval(intervalId);
  }, [currentUser, userData, areas]); // Rerun if user, userData, or areas change


  // --- Render Logic ---
  if (!currentUser) {
    return (
      <div className={styles.container}>
        <header className={styles.header}>
            <h1 className={styles.headerTitle}>Herd Search</h1>
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
    (u): u is UserData => !!u && !!u.location
  );

  return (
    <div className={styles.container}>
      {/* --- HEADER --- */}
      <header className={styles.header}>
  <div className={styles.logo}>Herd Search</div>

</header>

 {/* --- USER/DEV CONTROLS --- */}
<div className={styles.userControls}>
  {/* User Info */}
  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
    {userData?.photoURL && <Image src={userData.photoURL} alt="avatar" width={40} height={40} style={{ borderRadius: '50%' }} />}
    <span style={{ fontWeight: 600 }}>{userData?.displayName}</span>
    <button onClick={() => setActiveModal('settings')} className={styles.iconButton}><FaCog size={20} /></button>
  </div>

  {/* Action Buttons Container */}
  <div style={{ display: 'flex', gap: '0.5rem' }}>
  </div>
</div>
      
      {isDevMode && (
          <div className={styles.devPanel}>
              <h3 style={{fontWeight: 700}}>Developer Mode: Drawing Area</h3>
              <p>Click on the map to draw. Click near the first point to finish and name the shape ✏️ </p>
              <button onClick={cancelDrawing} className={styles.dangerButton} style={{padding: '0.25rem 0.75rem', marginTop: '0.5rem'}}>Cancel Drawing</button>
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
          onLoad={resizeCanvas}
        />
        <canvas 
            ref={canvasRef} 
            className={styles.mapCanvas}
            onClick={handleCanvasClick}
            style={{ cursor: isDevMode ? 'crosshair' : 'default' }}
        />
        {/* Always show your own marker if you have a location */}
        {userData?.location && (
          <div
            key={userData.uid}
            className={styles.userMarker}
            style={{ left: `${userData.location.x * 100}%`, top: `${userData.location.y * 100}%`, zIndex: 2 }}
          >
            <img src={userData.photoURL || "/default-avatar.png"} alt={userData.displayName || "You"} />
            <div className={styles.nameLabel}>{(userData.displayName?.split(' ')[0]) || "You"}</div>
          </div>
        )}
        {/* Show friends' markers */}
        {friendsData.filter(f => !!f.location).map(u => (
          <div
            key={u.uid}
            className={styles.userMarker}
            style={{ left: `${u.location!.x * 100}%`, top: `${u.location!.y * 100}%` }}
          >
            <img src={u.photoURL || "/default-avatar.png"} alt={u.displayName || "User"} />
            <div className={styles.nameLabel}>{(u.displayName?.split(' ')[0]) || "User"}</div>
          </div>
        ))}
      </div>
      
      {/* --- SQUAD LIST --- */}
      <div style={{marginTop: '2rem', marginBottom: '0.5rem'}}>
        <h2 className={styles.headerTitle} style={{fontSize: '1.5rem'}}>Your Squad</h2>
      </div>
      <div className={styles.squadList}>
          {/* Always show yourself in the squad list */}
          {userData && (
            <div className={`${styles.card} ${styles.currentUserCard}`}>
              <Image src={userData.photoURL!} alt="avatar" width={48} height={48} style={{borderRadius: '50%'}} />
              <div>
                  <p style={{fontWeight: 'bold'}}>{userData.displayName}</p>
                  <p style={{fontSize: '0.9rem'}}>Location: <span style={{fontWeight: 600}}>{userData.currentArea || 'Unknown'}</span></p>
              </div>
            </div>
          )}
          {friendsData.map(friend => (
              <div key={friend.uid} className={styles.card}>
                  <Image src={friend.photoURL!} alt="avatar" width={48} height={48} style={{borderRadius: '50%'}} />
                  <div>
                      <p style={{fontWeight: 'bold'}}>{friend.displayName}</p>
                      <p style={{fontSize: '0.9rem'}}>Location: <span style={{fontWeight: 600}}>{friend.currentArea || 'Unknown'}</span></p>
                  </div>
              </div>
          ))}
          {/* Invite Friends Card */}
          <div className={`${styles.card} ${styles.inviteCard}`} onClick={() => setActiveModal('addFriend')}>
              <div className={styles.inviteIconContainer}>
                  <span className={styles.invitePlus}>+</span>
              </div>
              <div>
                  <p style={{fontWeight: 'bold'}}>Invite Friends</p>
              </div>
          </div>
      </div>

      {/* --- FLOATING BUTTON --- */}
      {userData?.useGps === false && (
         <button onClick={() => setActiveModal('checkIn')} className={styles.floatingButton}><FaMapMarkerAlt />Check In</button>
      )}

      {/* --- MODALS --- */}
      {activeModal && (
        <div className={styles.modalOverlay} onClick={() => setActiveModal(null)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>

            {activeModal === 'passcode' && (<>
              <h3 className={styles.modalHeader}>Enter Developer Passcode</h3>
              <input type="password" value={passcode} onChange={e => setPasscode(e.target.value)} className={styles.textInput} autoFocus/>
              <div className={styles.modalActions}>
                <button onClick={() => setActiveModal(null)} className={styles.neutralButton}>Cancel</button>
                <button onClick={handlePasscodeSubmit} className={styles.secondaryButton}>Submit</button>
              </div>
            </>)}

            {activeModal === 'addFriend' && (<>
              <h3 className={styles.modalHeader}>Add a Friend</h3>
              <input type="email" placeholder="friend@example.com" value={friendEmail} onChange={e => setFriendEmail(e.target.value)} className={styles.textInput} autoFocus/>
              <div className={styles.modalActions}>
                <button onClick={() => setActiveModal(null)} className={styles.neutralButton}>Cancel</button>
                <button onClick={handleAddFriend} className={styles.primaryButton}>Add</button>
              </div>
            </>)}

            {activeModal === 'alert' && (<>
                <p style={{marginBottom: '1rem'}}>{alertMessage}</p>
                <div className={styles.modalActions} style={{justifyContent: 'center'}}>
                    <button onClick={() => setActiveModal(null)} className={styles.primaryButton}>OK</button>
                </div>
            </>)}

            {activeModal === 'confirm' && confirmAction && (<>
                <h3 className={styles.modalHeader}>Are you sure?</h3>
                <p>{confirmAction.message}</p>
                <div className={styles.modalActions}>
                    <button onClick={() => { setActiveModal(null); setConfirmAction(null); }} className={styles.neutralButton}>Cancel</button>
                    <button onClick={() => { confirmAction.onConfirm(); setActiveModal(null); setConfirmAction(null); }} className={styles.dangerButton}>Confirm</button>
                </div>
            </>)}

            {activeModal === 'areaName' && (<>
              <h3 className={styles.modalHeader}>Name This Area</h3>
              <input type="text" placeholder="e.g., Main Stage" value={areaName} onChange={e => setAreaName(e.target.value)} className={styles.textInput} autoFocus/>
              <div className={styles.modalActions}>
                  <button onClick={() => { setActiveModal(null); currentPolygonPoints.current = []; redrawCanvas(); }} className={styles.neutralButton}>Cancel</button>
                  <button onClick={handleSaveArea} className={styles.primaryButton}>Save</button>
              </div>
            </>)}

            {activeModal === 'settings' && (<>
    <h3 className={styles.modalHeader}>Settings</h3>

    <div className={styles.settingItem}>
        <span>Use GPS Location</span>
        <label className={styles.switch}>
            <input
                type="checkbox"
                checked={userData?.useGps ?? true}
                onChange={e => handleGpsToggle(e.target.checked)}
            />
            <span className={styles.slider}></span>
        </label>
    </div>
    <p className={styles.settingHint}>Turn this off to enable manual check-ins.</p>

    {/* Developer Mode button only shows for the authorized user */}
    {isDeveloper && (
        <div className={styles.settingItem}>
            <span>Developer Mode</span>
            <button
                onClick={() => {
                    setActiveModal('passcode');
                }}
                className={styles.secondaryButton}
            >
                Manage Locations
            </button>
        </div>
    )}

    <div className={styles.modalActions} style={{ marginTop: '2rem' }}>
        <button
            onClick={() => {
                setIsDevMode(false);
                signOut(auth);
            }}
            className={styles.dangerButton}
        >
            Sign Out
        </button>
        <button onClick={() => setActiveModal(null)} className={styles.primaryButton}>Done</button>
    </div>
</>)}

            {activeModal === 'checkIn' && (<>
              <h3 className={styles.modalHeader}>Check In To a Location</h3>
              <div className={styles.locationsList}>
                {areas.length > 0 ? areas.map(area => (
                  <div key={area.id} className={styles.locationItem} onClick={() => handleManualCheckIn(area)}>
                    {area.name}
                  </div>
                )) : <p>No locations defined.</p>}
              </div>
              <div className={styles.modalActions}>
                <button onClick={() => setActiveModal(null)} className={styles.neutralButton}>Cancel</button>
              </div>
            </>)}

            {activeModal === 'locations' && (<>
              <h3 className={styles.modalHeader}>Manage Locations</h3>
              <div className={styles.locationsList}>
                {areas.length > 0 ? areas.map(area => (
                  <div key={area.id} className={styles.locationItemManager}>
                    <span>{area.name}</span>
                    <button onClick={() => handleDeleteArea(area.id)} className={styles.dangerButton}><FaTrash /></button>
                  </div>
                )) : <p>No locations created yet.</p>}
              </div>
              <div className={styles.modalActions}>
                <button onClick={() => setActiveModal(null)} className={styles.neutralButton}>Close</button>
                <button onClick={() => { setActiveModal(null); setIsDevMode(true); }} className={styles.primaryButton}>Add New Location</button>
              </div>
            </>)}

          </div>
        </div>
      )}
    </div>
  );
}