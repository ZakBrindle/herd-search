"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from "firebase/auth";
import {
  doc, onSnapshot, setDoc, getDoc, updateDoc, arrayUnion, arrayRemove, collection,
  query, where, getDocs, addDoc, deleteDoc, DocumentData, writeBatch, serverTimestamp
} from "firebase/firestore";
import { auth, db } from '../lib/firebase';
import styles from './page.module.css';
import { FaMapMarkerAlt, FaCog, FaTrash, FaPencilAlt, FaUserPlus, FaCheck, FaTimes, FaSignOutAlt, FaCrown } from 'react-icons/fa';

// --- Type Definitions ---
type Point = { x: number; y: number };
type Area = { id: string; name: string; polygon: Point[] };

// NEW: Squad definition
type Squad = {
    id: string;
    ownerId: string;
    members: string[];
};

type UserData = DocumentData & {
    uid: string;
    squadId?: string; // REPLACES ownerId and friends
    location?: Point;
    photoURL?: string;
    displayName?: string;
    currentArea?: string;
    lastKnownArea?: string;
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
type FriendRequest = {
  id: string;
  from: string;
  to: string;
  fromName: string;
  fromPhotoURL: string;
  status: 'pending' | 'accepted' | 'declined';
  squadId: string; // Add squadId to the request
};


// --- Main Page Component ---
export default function HomePage() {
  // --- State Management ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [squad, setSquad] = useState<Squad | null>(null); // NEW: squad state
  const [squadMembersData, setSquadMembersData] = useState<UserData[]>([]); // REPLACES friendsData
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
  const [toastMessage, setToastMessage] = useState('');
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
  const [userToRemove, setUserToRemove] = useState<UserData | null>(null);

  // --- Refs ---
  const mapImageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentPolygonPoints = useRef<Point[]>([]);
  const pressTimer = useRef<NodeJS.Timeout | null>(null);


  // --- Utility & Helper Functions ---
  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(''), 3000);
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
  const getSquadDocRef = (squadId: string) => doc(db, 'squads', squadId); // NEW: squad ref helper

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
      areas.forEach(area => drawPolygon(ctx, area.polygon, 'rgba(29, 78, 216, 0.3)', 'rgba(29, 78, 216, 0.7)'));
    }
    if (isDevMode && currentPolygonPoints.current.length > 0) {
      drawPolygon(ctx, currentPolygonPoints.current, 'rgba(255, 255, 0, 0.3)', 'rgba(255, 255, 0, 0.7)', true);
    }
  }, [areas, isDevMode, showZones]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const mapImage = mapImageRef.current;
    if (!canvas || !mapImage || !mapImage.clientWidth) return;
    canvas.width = mapImage.clientWidth;
    canvas.height = mapImage.clientHeight;
    redrawCanvas();
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

  useEffect(() => { redrawCanvas(); }, [areas, redrawCanvas, showZones]);
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
    if (!areaName || currentPolygonPoints.current.length < 3) return showAlert("Please provide a name and draw a valid shape (at least 3 points).");
    try {
      await addDoc(collection(db, 'areas'), { name: areaName, polygon: currentPolygonPoints.current });
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
    if (!newAreaName || !renamingArea) return showAlert("Please provide a valid new name.");
    try {
      await updateDoc(doc(db, 'areas', renamingArea.id), { name: newAreaName });
      showAlert("Area renamed successfully!");
      setActiveModal('locations');
      setRenamingArea(null);
      setNewAreaName('');
    } catch (error) {
      console.error("Error renaming area:", error);
      showAlert("Could not rename the area.");
    }
  };

 const handleSendFriendRequest = async () => {
    if (!friendEmail || !currentUser || !userData) return;

    try {
        const q = query(getPublicProfileCollection(), where("email", "==", friendEmail.toLowerCase()));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            return showAlert("User not found. Ensure they have signed in at least once.");
        }

        const friendDoc = querySnapshot.docs[0];
        const friendUid = friendDoc.id;
        const friendData = friendDoc.data() as UserData;

        if (friendUid === currentUser.uid) return showAlert("You can't invite yourself!");
        if (friendData.squadId === userData.squadId && userData.squadId) return showAlert("This user is already in your squad.");

        const requestsRef = collection(db, 'friendRequests');
        const requestQuery = query(requestsRef, where('from', '==', currentUser.uid), where('to', '==', friendUid), where('status', '==', 'pending'));
        if (!(await getDocs(requestQuery)).empty) return showAlert("You have already sent an invite to this user.");

        let squadIdToJoin = userData.squadId;
        const batch = writeBatch(db); // Use a batch for atomicity

        if (!squadIdToJoin) {
            const newSquadRef = doc(collection(db, 'squads'));
            // ✅ ADD pendingMembers TO THE NEW SQUAD
            batch.set(newSquadRef, {
                ownerId: currentUser.uid,
                members: [currentUser.uid],
                pendingMembers: [friendUid], // Pre-approve the friend
                createdAt: serverTimestamp(),
            });
            squadIdToJoin = newSquadRef.id;
            batch.update(getUserDocRef(currentUser.uid), { squadId: squadIdToJoin });
        } else {
            // ✅ ADD friend's UID to pendingMembers on an EXISTING squad
            const squadRef = getSquadDocRef(squadIdToJoin);
            batch.update(squadRef, { pendingMembers: arrayUnion(friendUid) });
        }

        if (!squadIdToJoin) {
          return showAlert("Could not create or find a squad to join.");
        }

        const newRequestRef = doc(requestsRef);
        batch.set(newRequestRef, {
            from: currentUser.uid,
            to: friendUid,
            fromName: userData.displayName,
            fromPhotoURL: userData.photoURL,
            status: 'pending',
            squadId: squadIdToJoin,
        });

        await batch.commit(); // Commit all writes at once

        showToast("Invite Sent");
        setFriendEmail('');
        setActiveModal(null);
    } catch (error) {
        console.error("Error sending friend request:", error);
        showAlert("An error occurred while sending the invite.");
    }
};

    const handleAcceptRequest = async (request: FriendRequest) => {
    if (!currentUser) return;
    const batch = writeBatch(db);

    const squadRef = getSquadDocRef(request.squadId);
    // ✅ MOVE user from pending to active members list
    batch.update(squadRef, {
        members: arrayUnion(request.to),
        pendingMembers: arrayRemove(request.to) // Clean up the pending list
    });

    const userRef = getUserDocRef(request.to);
    batch.update(userRef, { squadId: request.squadId });

    batch.delete(doc(db, 'friendRequests', request.id));

    try {
        await batch.commit();
        showToast("Welcome to the squad! 🎉");
    } catch (error) {
        console.error("Error accepting friend request:", error);
        showAlert("Failed to accept invite.");
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

    const handleRemoveFriend = async () => {
        if (!userToRemove || !currentUser || !squad || squad.ownerId !== currentUser.uid) return;
        
        showConfirm(`Are you sure you want to remove ${userToRemove.displayName} from your squad?`, async () => {
            const batch = writeBatch(db);

            // 1. Remove user from the squad's member list
            batch.update(getSquadDocRef(squad.id), { members: arrayRemove(userToRemove.uid) });

            // 2. Remove squadId from the user's profile
            batch.update(getUserDocRef(userToRemove.uid), { squadId: null });

            try {
                await batch.commit();
                showToast(`${userToRemove.displayName} has been removed from the squad.`);
                setUserToRemove(null); // Clear selection
            } catch (error) {
                console.error("Error removing friend:", error);
                showAlert("Could not remove friend.");
            }
        });
    };

    const handleLeaveSquad = async () => {
        if (!currentUser || !userData || !squad || squad.ownerId === currentUser.uid) {
            return showAlert("Squad owners cannot leave. You must transfer ownership first.");
        }
        
        showConfirm("Are you sure you want to leave this squad? You will need a new invite to rejoin.", async () => {
            const batch = writeBatch(db);
            
            // 1. Remove user from the squad's member list
            batch.update(getSquadDocRef(squad.id), { members: arrayRemove(currentUser.uid) });

            // 2. Reset own user document's squadId
            batch.update(getUserDocRef(currentUser.uid), { squadId: null });

            try {
                await batch.commit();
                setActiveModal(null);
                showToast("You have left the squad.");
            } catch (error) {
                console.error("Error leaving squad:", error);
                showAlert("Could not leave the squad.");
            }
        });
    };

    const handleBecomeSquadLeader = async () => {
        if (!currentUser || !userData || !isDeveloper || !squad) return;
        if (squad.ownerId === currentUser.uid) {
            return showAlert("You are already the squad leader.");
        }

        showConfirm("This will make you the leader of your current squad. Proceed?", async () => {
            try {
                await updateDoc(getSquadDocRef(squad.id), { ownerId: currentUser.uid });
                setActiveModal(null);
                showToast("You are now the squad leader!");
            } catch (error) {
                console.error("Error becoming squad leader:", error);
                showAlert("An error occurred while taking over the squad.");
            }
        });
    };

  const handleTouchStart = (friend: UserData) => {
    if (squad?.ownerId !== currentUser?.uid || friend.uid === currentUser?.uid) return; // Only owner can initiate removal, and not of themselves
    pressTimer.current = setTimeout(() => {
      setUserToRemove(friend);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
    }
  };

  const handleCardClick = (friend: UserData) => {
    if (userToRemove && userToRemove.uid === friend.uid) {
      setUserToRemove(null);
    }
  };

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const pos = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };

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
    area.polygon.forEach(p => { cx += p.x; cy += p.y; });
    const centroid = { x: cx / area.polygon.length, y: cy / area.polygon.length };

    try {
        await updateDoc(getUserDocRef(currentUser.uid), { location: centroid, currentArea: area.name, lastKnownArea: area.name });
        setActiveModal(null);
        setSelectedAreaForCheckIn(null);
    } catch (error) {
        console.error("Error checking in manually:", error);
        showAlert("Could not perform check-in.");
    }
  };

  const handleGpsToggle = async (useGps: boolean) => {
    if (!currentUser) return;
    if (useGps) setSelectedAreaForCheckIn(null);
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
          const profileData = { uid: user.uid, displayName: user.displayName, email: user.email?.toLowerCase(), photoURL: user.photoURL };
          // New users have no squadId initially
          await setDoc(userRef, { ...profileData, squadId: null, location: null, currentArea: 'unknown', useGps: true, lastKnownArea: 'unknown' });
          await setDoc(publicProfileRef, profileData);
        }
      } else {
        setCurrentUser(null); setUserData(null); setSquad(null); setSquadMembersData([]); setIsDevMode(false);
      }
    });

    const unsubscribeAreas = onSnapshot(collection(db, "areas"), (snapshot) => {
        setAreas(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Area[]);
    });

    return () => { unsubscribeAuth(); unsubscribeAreas(); };
  }, []);

  useEffect(() => {
    if (!currentUser?.uid) { setUserData(null); setIsDeveloper(false); return; }
    const unsubUser = onSnapshot(getUserDocRef(currentUser.uid), (doc) => {
      if (doc.exists()) {
        const data = doc.data() as UserData;
        setUserData(data);
        setIsDeveloper(data?.displayName === 'Zak Brindle');
      }
    });
    return () => unsubUser();
  }, [currentUser?.uid]);

  // NEW: Effect to listen to squad changes based on user's squadId
  useEffect(() => {
    if (!userData?.squadId) {
        setSquad(null);
        setSquadMembersData([]);
        return;
    }

    const unsubSquad = onSnapshot(getSquadDocRef(userData.squadId), (doc) => {
        if (doc.exists()) {
            setSquad({ id: doc.id, ...doc.data() } as Squad);
        } else {
            // Squad was deleted, clear local state
            setSquad(null);
            // Optionally clear the user's squadId in Firestore
            updateDoc(getUserDocRef(userData.uid), { squadId: null });
        }
    });
    
    return () => unsubSquad();
  }, [userData?.squadId, userData?.uid]);


  // NEW: Effect to fetch squad member data when the squad member list changes
  useEffect(() => {
    const memberIds = squad?.members || [];
    if (memberIds.length === 0) {
        setSquadMembersData([]);
        return;
    }

    // Fetch all member docs at once
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('uid', 'in', memberIds));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const members = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserData));
      // CHANGED: We will now set all members here and filter in the render logic.
      setSquadMembersData(members);
    });

    return () => unsubscribe();
  }, [squad?.members, currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid) { setIncomingRequests([]); return; }
    const q = query(collection(db, 'friendRequests'), where('to', '==', currentUser.uid), where('status', '==', 'pending'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
        setIncomingRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as FriendRequest[]);
    });
    return () => unsubscribe();
  }, [currentUser?.uid]);

  // --- MOCK LOCATION UPDATER ---
  useEffect(() => {
    if (!currentUser || !userData || !userData.useGps) {
        return;
    }

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
  const allSquadUsers = squadMembersData.sort((a, b) => {
    if (a.uid === squad?.ownerId) return -1; // Owner first
    if (b.uid === squad?.ownerId) return 1;
    if (a.uid === currentUser?.uid) return -1; // Then current user
    if (b.uid === currentUser?.uid) return 1;
    return 0;
  });

  // ADD THIS LINE BACK
  const allUsersOnMap = allSquadUsers;

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
      {toastMessage && (<div className={styles.toast}>{toastMessage}</div>)}

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
              <p>Click on the map to draw. Click near the first point to finish and name the shape.</p>
              <button onClick={cancelDrawing} className={styles.dangerButton} style={{padding: '0.25rem 0.75rem', marginTop: '0.5rem'}}>Cancel Drawing</button>
          </div>
      )}

      <div className={styles.mapContainer}>
        <Image ref={mapImageRef} src="/Beatherder Map.png" alt="Beat-Herder Festival Map" width={1200} height={800} className={styles.mapImage} onLoad={resizeCanvas} priority />
        <canvas ref={canvasRef} className={styles.mapCanvas} onClick={handleCanvasClick} style={{ cursor: isDevMode ? 'crosshair' : (userData?.useGps === false ? 'pointer' : 'default') }} />
        {allUsersOnMap.filter(u => !!u.location).map(u => (
          <div key={u.uid} className={styles.userMarker} style={{ left: `${u.location!.x * 100}%`, top: `${u.location!.y * 100}%`, zIndex: u.uid === currentUser.uid ? 2 : 1 }}>
            <Image src={u.photoURL || "/default-avatar.png"} alt={u.displayName || "User"} width={32} height={32} style={{ borderRadius: '50%', border: u.uid === currentUser.uid ? '2px solid #3b82f6' : '2px solid white' }} />
            <div className={styles.nameLabel}>{(u.displayName?.split(' ')[0]) || "User"}</div>
          </div>
        ))}
      </div>

      <div style={{marginTop: '2rem', marginBottom: '0.5rem'}}>
        <h2 className={styles.headerTitle} style={{fontSize: '1.5rem'}}>Your Squad</h2>
      </div>
      <div className={styles.squadList}>
          {userData && (
            <div className={`${styles.card} ${styles.currentUserCard}`}>
              <Image src={userData.photoURL!} alt="avatar" width={48} height={48} style={{borderRadius: '50%'}} />
              <div>
                  <p style={{fontWeight: 'bold'}}>
                    {squad?.ownerId === userData.uid && '👑 '}{userData.displayName}
                  </p>
                  <p style={{fontSize: '0.9rem'}}>Location: <span style={{fontWeight: 600}}>{userData.currentArea === 'unknown' ? userData.lastKnownArea : userData.currentArea || 'Unknown'}</span></p>
              </div>
            </div>
          )}
          {squadMembersData.map(friend => (
              <div
                key={friend.uid}
                className={`${styles.card} ${userToRemove?.uid === friend.uid ? styles.highlightedCard : ''}`}
                onMouseDown={() => handleTouchStart(friend)}
                onMouseUp={handleTouchEnd}
                onTouchStart={() => handleTouchStart(friend)}
                onTouchEnd={handleTouchEnd}
                onClick={() => handleCardClick(friend)}
              >
                  <Image src={friend.photoURL!} alt="avatar" width={48} height={48} style={{borderRadius: '50%'}} />
                  <div>
                      <p style={{fontWeight: 'bold'}}>
                        {squad?.ownerId === friend.uid && '👑 '}{friend.displayName}
                      </p>
                      <p style={{fontSize: '0.9rem'}}>Location: <span style={{fontWeight: 600}}>{friend.currentArea === 'unknown' ? friend.lastKnownArea : friend.currentArea || 'Unknown'}</span></p>
                  </div>
              </div>
          ))}
          {/* Show invite card only if the user is the squad owner, or if they have no squad yet. */}
          {userData && (!userData.squadId || userData.uid === squad?.ownerId) && (
            <div className={`${styles.card} ${styles.inviteCard}`} onClick={() => setActiveModal('addFriend')}>
                <div className={styles.inviteIconContainer}><FaUserPlus /></div>
                <div><p style={{fontWeight: 'bold'}}>Invite Friends</p></div>
            </div>
          )}
      </div>

      {userToRemove ? (
        <button onClick={handleRemoveFriend} className={`${styles.floatingButton} ${styles.dangerButton}`}>
          <FaTrash /> Remove {userToRemove.displayName?.split(' ')[0]}
        </button>
      ) : userData?.useGps === false && (
        <>
          {selectedAreaForCheckIn ? (
            <button onClick={() => handleManualCheckIn(selectedAreaForCheckIn)} className={styles.floatingButton}>
              <FaMapMarkerAlt /> Check into {selectedAreaForCheckIn.name}
            </button>
          ) : (
            <button onClick={() => setActiveModal('checkIn')} className={styles.floatingButton}>
              <FaMapMarkerAlt />Check In
            </button>
          )}
        </>
      )}

      {activeModal && (
        <div className={styles.modalOverlay} onClick={() => { setActiveModal(null); setUserToRemove(null); }}>
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
              <h3 className={styles.modalHeader}>Send Squad Invite</h3>
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
              <input type="text" value={newAreaName} onChange={e => setNewAreaName(e.target.value)} className={styles.textInput} autoFocus />
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
                        <input type="checkbox" checked={userData?.useGps ?? true} onChange={e => handleGpsToggle(e.target.checked)} />
                        <span className={styles.slider}></span>
                    </label>
                </div>
                <p className={styles.settingHint}>Turn this off to enable manual check-ins.</p>
                <div className={styles.settingItem} style={{borderTop: '1px solid #eee', paddingTop: '1rem', marginTop: '1rem'}}>
                    <span>Show Location Zones</span>
                    <label className={styles.switch}>
                        <input type="checkbox" checked={showZones} onChange={e => setShowZones(e.target.checked)} />
                        <span className={styles.slider}></span>
                    </label>
                </div>
                <p className={styles.settingHint}>Show or hide the defined areas on the map.</p>

                {isDeveloper && (
                    <div className={styles.settingItem} style={{borderTop: '1px solid #eee', paddingTop: '1rem', marginTop: '1rem'}}>
                        <span>Developer Mode</span>
                        <button onClick={() => { if (isDevMode) setActiveModal('locations'); else setActiveModal('passcode'); }} className={styles.secondaryButton}>Manage Locations</button>
                    </div>
                )}

                {isDeveloper && userData?.squadId && squad && squad.ownerId !== userData.uid && (
                  <div style={{marginTop: '1rem', paddingTop: '1rem'}}>
                     <button onClick={handleBecomeSquadLeader} className={styles.secondaryButton} style={{width: '100%'}}>
                        <FaCrown /> Become Squad Leader
                    </button>
                  </div>
                )}

                {userData?.squadId && squad && squad.ownerId !== userData.uid && (
                  <div style={{borderTop: '1px solid #e74c3c', marginTop: '2rem', paddingTop: '1rem'}}>
                    <button onClick={handleLeaveSquad} className={styles.dangerButton} style={{width: '100%'}}>
                      <FaSignOutAlt /> Leave Squad
                    </button>
                  </div>
                )}

                <div className={styles.modalActions} style={{ marginTop: '2rem' }}>
                    <button onClick={() => { setIsDevMode(false); signOut(auth); }} className={styles.dangerButton}>Sign Out</button>
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
                      <button onClick={() => { setRenamingArea(area); setNewAreaName(area.name); setActiveModal('renameArea'); }} className={styles.secondaryButton} aria-label={`Rename ${area.name}`}><FaPencilAlt /></button>
                      <button onClick={() => handleDeleteArea(area.id)} className={styles.dangerButton} aria-label={`Delete ${area.name}`}><FaTrash /></button>
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