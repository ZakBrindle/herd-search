"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from "firebase/auth";
import { 
  doc, onSnapshot, setDoc, getDoc, updateDoc, arrayUnion, collection, 
  query, where, getDocs, addDoc, deleteDoc, DocumentData, writeBatch
} from "firebase/firestore";
import { auth, db } from '../lib/firebase';
import styles from './page.module.css';
// --- MODIFIED --- Added more icons for the new UI elements
import { FaMapMarkerAlt, FaCog, FaTrash, FaPencilAlt, FaUserPlus, FaCheck, FaTimes } from 'react-icons/fa';

// --- Type Definitions ---
type Point = { x: number; y: number };
type Area = { id: string; name: string; polygon: Point[] };
type UserData = DocumentData & { 
    uid: string; 
    location?: Point; 
    photoURL?: string; 
    displayName?: string; 
    currentArea?: string; 
    lastKnownArea?: string;
    friends?: string[];
    useGps?: boolean;
};
type ConfirmAction = {
    message: string;
    onConfirm: () => void;
};
type LocationUpdatePayload = {
  location: Point;
  currentArea: string;
  lastKnownArea?: string;
};
// --- ADDED --- Type for friend requests
type FriendRequest = {
  id: string;
  from: string;
  to: string;
  fromName: string;
  fromPhotoURL: string;
  status: 'pending' | 'accepted' | 'declined';
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
  const [showZones, setShowZones] = useState(false);
  const [renamingArea, setRenamingArea] = useState<Area | null>(null);
  const [newAreaName, setNewAreaName] = useState('');
  const [selectedAreaForCheckIn, setSelectedAreaForCheckIn] = useState<Area | null>(null);
  // --- ADDED --- State for toast messages and incoming friend requests
  const [toastMessage, setToastMessage] = useState('');
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);


  // --- Refs ---
  const mapImageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentPolygonPoints = useRef<Point[]>([]);

  // --- Utility & Helper Functions ---
  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(''), 3000); // Hide after 3 seconds
  };

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

    if (showZones) {
      areas.forEach(area => {
        drawPolygon(ctx, area.polygon, 'rgba(29, 78, 216, 0.3)', 'rgba(29, 78, 216, 0.7)');
      });
    }

    if (isDevMode && currentPolygonPoints.current.length > 0) {
      drawPolygon(ctx, currentPolygonPoints.current, 'rgba(255, 255, 0, 0.3)', 'rgba(255, 255, 0, 0.7)', true);
    }
  }, [areas, isDevMode, showZones]);

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

  useEffect(() => {
    redrawCanvas();
  }, [areas, redrawCanvas, showZones]);

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

  const handleRenameArea = async () => {
    if (!newAreaName || !renamingArea) {
      return showAlert("Please provide a valid new name.");
    }
    try {
      const areaRef = doc(db, 'areas', renamingArea.id);
      await updateDoc(areaRef, { name: newAreaName });
      showAlert("Area renamed successfully!");
      setActiveModal('locations');
      setRenamingArea(null);
      setNewAreaName('');
    } catch (error) {
      console.error("Error renaming area:", error);
      showAlert("Could not rename the area.");
    }
  };
  
  // --- MODIFIED --- This function now sends a friend request instead of directly adding a friend.
  const handleSendFriendRequest = async () => {
    if (!friendEmail || !currentUser || !userData) return;
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
      
      // Check if a request already exists
      const requestsRef = collection(db, 'friendRequests');
      const requestQuery = query(requestsRef, 
        where('from', '==', currentUser.uid), 
        where('to', '==', friendUid),
        where('status', '==', 'pending')
      );
      const existingRequest = await getDocs(requestQuery);
      if (!existingRequest.empty) {
          return showAlert("You have already sent a request to this user.");
      }

      // Create a new friend request document
      await addDoc(requestsRef, {
        from: currentUser.uid,
        to: friendUid,
        fromName: userData.displayName,
        fromPhotoURL: userData.photoURL,
        status: 'pending'
      });
      
      showToast("Invite Sent");
      setFriendEmail('');
      setActiveModal(null);
    } catch (error) {
       console.error("Error sending friend request:", error);
       showAlert("An error occurred while sending the request.");
    }
  };

  // --- ADDED --- Functions to handle accepting or declining requests
  const handleAcceptRequest = async (request: FriendRequest) => {
    if (!currentUser) return;
    const batch = writeBatch(db);

    // 1. Add each user to the other's friends list
    const currentUserRef = getUserDocRef(currentUser.uid);
    batch.update(currentUserRef, { friends: arrayUnion(request.from) });

    const friendUserRef = getUserDocRef(request.from);
    batch.update(friendUserRef, { friends: arrayUnion(request.to) });

    // 2. Delete the friend request document
    const requestRef = doc(db, 'friendRequests', request.id);
    batch.delete(requestRef);

    try {
      await batch.commit();
    } catch (error) {
      console.error("Error accepting friend request:", error);
      showAlert("Failed to accept request.");
    }
  };

  const handleDeclineRequest = async (requestId: string) => {
    try {
      await deleteDoc(doc(db, 'friendRequests', requestId));
    } catch (error) {
      console.error("Error declining friend request:", error);
      showAlert("Failed to decline request.");
    }
  };

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const pos = {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height
    };

    if (isDevMode) {
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
    } 
    else if (userData?.useGps === false) {
        let foundArea: Area | null = null;
        for (const area of areas) {
            if (isPointInPolygon(pos, area.polygon)) {
                foundArea = area;
                break;
            }
        }
        setSelectedAreaForCheckIn(foundArea);
    }
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
            currentArea: area.name,
            lastKnownArea: area.name
        });
        setActiveModal(null);
        setSelectedAreaForCheckIn(null);
    } catch (error) {
        console.error("Error checking in manually:", error);
        showAlert("Could not perform check-in.");
    }
  };

  const handleGpsToggle = async (useGps: boolean) => {
    if (!currentUser) return;
    if (useGps) {
      setSelectedAreaForCheckIn(null);
    }
    setUserData(prev => prev ? { ...prev, useGps } : prev);
    try {
        await updateDoc(getUserDocRef(currentUser.uid), { useGps });
    } catch (error) {
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
          await setDoc(userRef, { ...profileData, friends: [], location: null, currentArea: 'unknown', useGps: true, lastKnownArea: 'unknown' });
          await setDoc(publicProfileRef, profileData);
        }
      } else {
        setCurrentUser(null);
        setUserData(null);
        setFriendsData([]);
        setIsDevMode(false);
      }
    });

    const unsubscribeAreas = onSnapshot(collection(db, "areas"), (snapshot) => {
        const areasData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Area[];
        setAreas(areasData);
    });

    return () => {
      unsubscribeAuth();
      unsubscribeAreas();
    };
  }, []);
  
  useEffect(() => {
    if (!currentUser?.uid) {
      setUserData(null);
      setIsDeveloper(false);
      return;
    }

    const unsubUser = onSnapshot(getUserDocRef(currentUser.uid), (doc) => {
      if (doc.exists()) {
        const data = doc.data() as UserData;
        setUserData(data);
        setIsDeveloper(data?.displayName === 'Zak Brindle');
      }
    });

    return () => unsubUser();
  }, [currentUser?.uid]);

  useEffect(() => {
    const friendIds = userData?.friends || [];
    
    const unsubscribes = friendIds.map(friendId =>
      onSnapshot(getUserDocRef(friendId), (doc) => {
        if (doc.exists()) {
          const friendData = { uid: doc.id, ...doc.data() } as UserData;
          setFriendsData(prevFriends => {
            const otherFriends = prevFriends.filter(f => f.uid !== friendId);
            return [...otherFriends, friendData];
          });
        } else {
          setFriendsData(prevFriends => prevFriends.filter(f => f.uid !== friendId));
        }
      })
    );

    setFriendsData(prevFriends => prevFriends.filter(f => friendIds.includes(f.uid)));

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [userData?.friends]);

  // --- ADDED --- Listener for incoming friend requests
  useEffect(() => {
    if (!currentUser?.uid) {
        setIncomingRequests([]);
        return;
    }

    const requestsRef = collection(db, 'friendRequests');
    const q = query(requestsRef, where('to', '==', currentUser.uid), where('status', '==', 'pending'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
        const requests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as FriendRequest[];
        setIncomingRequests(requests);
    });

    return () => unsubscribe();
  }, [currentUser?.uid]);

  // --- MOCK LOCATION UPDATER ---
  useEffect(() => {
    if (!currentUser || !userData) return;
    
    const intervalId = setInterval(() => {
      const t = Date.now() / 1000;
      const x = 0.5 + 0.4 * Math.sin(t / 5);
      const y = 0.5 + 0.4 * Math.cos(t / 7);
      let newAreaName = 'Out of Bounds';
      for (const area of areas) {
          if (isPointInPolygon({ x, y }, area.polygon)) {
              newAreaName = area.name;
              break;
          }
      }
      
      const updatePayload: LocationUpdatePayload = {
        location: { x, y },
        currentArea: newAreaName
      };

      if (newAreaName !== 'Out of Bounds') {
        updatePayload.lastKnownArea = newAreaName;
      }

      updateDoc(getUserDocRef(currentUser.uid), updatePayload)
        .catch(err => console.error("Error in mock location update: ", err));
        
    }, 2000);

    return () => clearInterval(intervalId);
  }, [currentUser, userData, areas]);


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
  
  return (
    <div className={styles.container}>
      {/* --- ADDED --- Toast Notification */}
      {toastMessage && (
        <div className={styles.toast}>
          {toastMessage}
        </div>
      )}

      {/* --- HEADER --- */}
      {/* --- MODIFIED --- Header now conditionally shows a friend request or the title */}
      <header className={styles.header}>
        {incomingRequests.length > 0 ? (
          <div className={styles.notificationBar}>
            <div className={styles.notificationContent}>
              <Image src={incomingRequests[0].fromPhotoURL} alt={incomingRequests[0].fromName} width={32} height={32} style={{borderRadius: '50%'}} />
              <span><b>{incomingRequests[0].fromName}</b> wants to be friends!</span>
            </div>
            <div className={styles.notificationActions}>
              <button onClick={() => handleAcceptRequest(incomingRequests[0])} className={styles.acceptButton}><FaCheck /></button>
              <button onClick={() => handleDeclineRequest(incomingRequests[0].id)} className={styles.declineButton}><FaTimes /></button>
            </div>
          </div>
        ) : (
          <div className={styles.logo}>Herd Search</div>
        )}
      </header>

      {/* --- USER/DEV CONTROLS --- */}
      <div className={styles.userControls}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {userData?.photoURL && <Image src={userData.photoURL} alt="avatar" width={40} height={40} style={{ borderRadius: '50%' }} />}
          <span style={{ fontWeight: 600 }}>{userData?.displayName}</span>
          <button onClick={() => setActiveModal('settings')} className={styles.iconButton}><FaCog size={20} /></button>
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
        <Image
          ref={mapImageRef}
          src="/Beatherder Map.png"
          alt="Beat-Herder Festival Map"
          width={1200}
          height={800}
          className={styles.mapImage}
          onLoad={resizeCanvas}
          priority
        />
        <canvas 
            ref={canvasRef} 
            className={styles.mapCanvas}
            onClick={handleCanvasClick}
            style={{ cursor: isDevMode ? 'crosshair' : (userData?.useGps === false ? 'pointer' : 'default') }}
        />
        {userData?.location && (
          <div
            key={userData.uid}
            className={styles.userMarker}
            style={{ left: `${userData.location.x * 100}%`, top: `${userData.location.y * 100}%`, zIndex: 2 }}
          >
            <Image 
              src={userData.photoURL || "/default-avatar.png"} 
              alt={userData.displayName || "You"}
              width={32}
              height={32}
              style={{ borderRadius: '50%' }}
            />
            <div className={styles.nameLabel}>{(userData.displayName?.split(' ')[0]) || "You"}</div>
          </div>
        )}
        {friendsData.filter(f => !!f.location).map(u => (
          <div
            key={u.uid}
            className={styles.userMarker}
            style={{ left: `${u.location!.x * 100}%`, top: `${u.location!.y * 100}%` }}
          >
            <Image 
              src={u.photoURL || "/default-avatar.png"} 
              alt={u.displayName || "User"}
              width={32}
              height={32}
              style={{ borderRadius: '50%' }}
            />
            <div className={styles.nameLabel}>{(u.displayName?.split(' ')[0]) || "User"}</div>
          </div>
        ))}
      </div>
      
      {/* --- SQUAD LIST --- */}
      <div style={{marginTop: '2rem', marginBottom: '0.5rem'}}>
        <h2 className={styles.headerTitle} style={{fontSize: '1.5rem'}}>Your Squad</h2>
      </div>
      <div className={styles.squadList}>
          {userData && (
            <div className={`${styles.card} ${styles.currentUserCard}`}>
              <Image src={userData.photoURL!} alt="avatar" width={48} height={48} style={{borderRadius: '50%'}} />
              <div>
                  <p style={{fontWeight: 'bold'}}>{userData.displayName}</p>
                   {userData.currentArea === 'The Wilds' ? (
                    <p style={{fontSize: '0.9rem'}}>Last Seen: <span style={{fontWeight: 600}}>{userData.lastKnownArea || 'Unknown'}</span></p>
                  ) : (
                    <p style={{fontSize: '0.9rem'}}>Location: <span style={{fontWeight: 600}}>{userData.currentArea || 'Unknown'}</span></p>
                  )}
              </div>
            </div>
          )}
          {friendsData.map(friend => (
              <div key={friend.uid} className={styles.card}>
                  <Image src={friend.photoURL!} alt="avatar" width={48} height={48} style={{borderRadius: '50%'}} />
                  <div>
                      <p style={{fontWeight: 'bold'}}>{friend.displayName}</p>
                      {friend.currentArea === 'The Wilds' ? (
                        <p style={{fontSize: '0.9rem'}}>Last Seen: <span style={{fontWeight: 600}}>{friend.lastKnownArea || 'Unknown'}</span></p>
                      ) : (
                        <p style={{fontSize: '0.9rem'}}>Location: <span style={{fontWeight: 600}}>{friend.currentArea || 'Unknown'}</span></p>
                      )}
                  </div>
              </div>
          ))}
          <div className={`${styles.card} ${styles.inviteCard}`} onClick={() => setActiveModal('addFriend')}>
              <div className={styles.inviteIconContainer}>
                  <FaUserPlus />
              </div>
              <div>
                  <p style={{fontWeight: 'bold'}}>Invite Friends</p>
              </div>
          </div>
      </div>

      {/* --- FLOATING BUTTON --- */}
      {userData?.useGps === false && (
        <>
          {selectedAreaForCheckIn ? (
            <button 
              onClick={() => handleManualCheckIn(selectedAreaForCheckIn)} 
              className={styles.floatingButton}
            >
              <FaMapMarkerAlt /> Check into {selectedAreaForCheckIn.name}
            </button>
          ) : (
            <button 
              onClick={() => setActiveModal('checkIn')} 
              className={styles.floatingButton}
            >
              <FaMapMarkerAlt />Check In
            </button>
          )}
        </>
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
              <h3 className={styles.modalHeader}>Send Friend Invite</h3>
              <input type="email" placeholder="friend@example.com" value={friendEmail} onChange={e => setFriendEmail(e.target.value)} className={styles.textInput} autoFocus/>
              <div className={styles.modalActions}>
                <button onClick={() => setActiveModal(null)} className={styles.neutralButton}>Cancel</button>
                <button onClick={handleSendFriendRequest} className={styles.primaryButton}>Send Invite</button>
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

            {activeModal === 'renameArea' && renamingArea && (<>
              <h3 className={styles.modalHeader}>Rename &quot;{renamingArea.name}&quot;</h3>
              <input 
                type="text" 
                value={newAreaName} 
                onChange={e => setNewAreaName(e.target.value)} 
                className={styles.textInput} 
                autoFocus
              />
              <div className={styles.modalActions}>
                  <button onClick={() => { setActiveModal('locations'); setRenamingArea(null); }} className={styles.neutralButton}>Cancel</button>
                  <button onClick={handleRenameArea} className={styles.primaryButton}>Save</button>
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

                <div className={styles.settingItem} style={{borderTop: '1px solid #eee', paddingTop: '1rem', marginTop: '1rem'}}>
                    <span>Show Location Zones</span>
                    <label className={styles.switch}>
                        <input
                            type="checkbox"
                            checked={showZones}
                            onChange={e => setShowZones(e.target.checked)}
                        />
                        <span className={styles.slider}></span>
                    </label>
                </div>
                <p className={styles.settingHint}>Show or hide the defined areas on the map.</p>


                {isDeveloper && (
                    <div className={styles.settingItem} style={{borderTop: '1px solid #eee', paddingTop: '1rem', marginTop: '1rem'}}>
                        <span>Developer Mode</span>
                        <button
                            onClick={() => {
                                if (isDevMode) {
                                  setActiveModal('locations');
                                } else {
                                  setActiveModal('passcode');
                                }
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
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button 
                        onClick={() => {
                          setRenamingArea(area);
                          setNewAreaName(area.name);
                          setActiveModal('renameArea');
                        }} 
                        className={styles.secondaryButton}
                        aria-label={`Rename ${area.name}`}
                      >
                        <FaPencilAlt />
                      </button>
                      <button 
                        onClick={() => handleDeleteArea(area.id)} 
                        className={styles.dangerButton}
                        aria-label={`Delete ${area.name}`}
                      >
                        <FaTrash />
                      </button>
                    </div>
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