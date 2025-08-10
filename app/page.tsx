"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from "firebase/auth";
import { 
  doc, onSnapshot, setDoc, getDoc, updateDoc, arrayUnion, collection, 
  query, where, getDocs, addDoc, deleteDoc, DocumentData, arrayRemove, QuerySnapshot 
} from "firebase/firestore";
import { auth, db } from '../lib/firebase';
import styles from './page.module.css';
// --- MODIFIED --- Added FaPencilAlt icon for renaming
import { FaMapMarkerAlt, FaCog, FaTrash, FaPencilAlt } from 'react-icons/fa';
// ADDED: Notification icon
import { FaBell } from 'react-icons/fa';

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
    lastUpdate?: number; // ADDED: timestamp of last update
    squadId?: string;
    squadOwnerId?: string;
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
  // --- ADDED --- State to manage the area being renamed
  const [renamingArea, setRenamingArea] = useState<Area | null>(null);
  const [newAreaName, setNewAreaName] = useState('');
  // --- ADDED --- State to manage the area selected for quick check-in
  const [selectedAreaForCheckIn, setSelectedAreaForCheckIn] = useState<Area | null>(null);
  const [selectedMember, setSelectedMember] = useState<UserData | null>(null);
  const [incomingSquadInvites, setIncomingSquadInvites] = useState<DocumentData[]>([]);
  // ADDED: Outgoing invites state
  const [outgoingSquadInvites, setOutgoingSquadInvites] = useState<DocumentData[]>([]);

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

  // --- ADDED --- Function to handle the submission of a renamed area
  const handleRenameArea = async () => {
    if (!newAreaName || !renamingArea) {
      return showAlert("Please provide a valid new name.");
    }
    try {
      const areaRef = doc(db, 'areas', renamingArea.id);
      await updateDoc(areaRef, { name: newAreaName });
      showAlert("Area renamed successfully!");
      setActiveModal('locations'); // Go back to the locations list
      setRenamingArea(null);
      setNewAreaName('');
    } catch (error) {
      console.error("Error renaming area:", error);
      showAlert("Could not rename the area.");
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

      const userFriends = userData?.friends || [];
      if (userFriends.includes(friendUid)) {
        return showAlert("This user is already your friend.");
      }

      await updateDoc(getUserDocRef(currentUser.uid), {
        friends: arrayUnion(friendUid)
      });
        setActiveModal(null);
      showAlert("Friend added successfully!");
      setFriendEmail('');
    
    } catch (error) {
       console.error("Error adding friend:", error);
       showAlert("An error occurred while adding the friend.");
    }
  };

  const handleInviteToSquad = async (friendUid: string) => {
    if (!userData?.squadId || !userData?.uid) return;
    try {
      // Create a squad invite notification for the friend
      await addDoc(collection(db, "squadInvites"), {
        squadId: userData.squadId,
        from: userData.uid,
        to: friendUid,
        createdAt: Date.now(),
        status: "pending"
      });
    
    } catch (error) {
      console.error("Error sending squad invite:", error);
      showAlert("Failed to send squad invite.");
    }
  };

  // --- MODIFIED --- This function now handles both developer drawing and user-based area selection for check-in.
  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const pos = {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height
    };

    // Handle developer drawing mode
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
    // Handle user check-in selection mode (only if GPS is off)
    else if (userData?.useGps === false) {
        let foundArea: Area | null = null;
        for (const area of areas) {
            if (isPointInPolygon(pos, area.polygon)) {
                foundArea = area;
                break;
            }
        }
        setSelectedAreaForCheckIn(foundArea); // Sets the selected area, or null if click was outside all areas
    }
  };

  // --- MODIFIED --- Added logic to clear the selected area after check-in.
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
            lastKnownArea: area.name,
            lastUpdate: Date.now() // <-- ADDED
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
    // --- ADDED --- When toggling GPS, clear any selected check-in area.
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

  // --- Helper to get squad leader ---
  const getSquadLeaderUid = () => {
    if (!userData?.squadId) return null;
    const leader = [userData, ...friendsData].find(u => u.uid === userData.squadOwnerId);
    return leader ? leader.uid : userData.squadOwnerId || userData.uid;
  };

  // --- Helper to get display name by UID ---
  const getDisplayNameByUid = (uid: string): string => {
    if (uid === userData?.uid) return userData.displayName || uid;
    const friend = friendsData.find(f => f.uid === uid);
    return friend?.displayName || uid;
  };

  // --- Handler for kicking a member ---
  // MODIFIED: Now shows confirmation before kicking
  const handleKickMemberConfirmed = async (member: UserData) => {
    if (!userData || !userData.squadId || !member.uid) return;
    try {
      await updateDoc(doc(db, "squads", userData.squadId), {
        members: arrayRemove(member.uid)
      });
      await updateDoc(getUserDocRef(member.uid), {
        squadId: null
      });
      showAlert(`${member.displayName} has been kicked from the squad.`);
      setSelectedMember(null);
    } catch (error) {
      console.error("Error kicking member:", error);
      showAlert("Failed to kick member from squad.");
      setSelectedMember(null);
    }
  };

  // ADDED: Wrapper to show confirmation dialog for kicking
  const handleKickMember = (member: UserData) => {
    showConfirm(
      `Are you sure you want to kick '${member.displayName}' from the squad?`,
      () => handleKickMemberConfirmed(member)
    );
  };

  // --- Handler for leaving squad and creating a new one ---
  // MODIFIED: Now shows confirmation before leaving squad
  const handleLeaveSquadConfirmed = async () => {
    if (!userData || !userData.squadId || !currentUser) return;
    try {
      // Remove user from current squad's members array
      await updateDoc(doc(db, "squads", userData.squadId), {
        members: arrayRemove(currentUser.uid)
      });
      // Create a new squad for the user
      const squadDoc = await addDoc(collection(db, "squads"), {
        ownerId: currentUser.uid,
        members: [currentUser.uid],
        pendingMembers: [],
        createdAt: Date.now(),
      });
      // Update user's squadId and squadOwnerId
      await updateDoc(doc(db, "users", currentUser.uid), {
        squadId: squadDoc.id,
        squadOwnerId: currentUser.uid,
      });
      setSelectedMember(null);
    } catch (error) {
      console.error("Error leaving squad:", error);
      showAlert("Failed to leave squad.");
      setSelectedMember(null);
    }
  };

  // ADDED: Wrapper to show confirmation dialog
  const handleLeaveSquad = () => {
    showConfirm(
      "Are you sure you want to leave your squad? You will create a new squad and leave your current one.",
      handleLeaveSquadConfirmed
    );
  };

  // --- Accept Squad Invite ---
  const handleAcceptSquadInvite = async (invite: DocumentData) => {
    try {
      // Add user to squad members
      await updateDoc(doc(db, "squads", invite.squadId), {
        members: arrayUnion(currentUser!.uid)
      });
      // Update user's squadId and squadOwnerId
      await updateDoc(doc(db, "users", currentUser!.uid), {
        squadId: invite.squadId,
        squadOwnerId: invite.from
      });
      // Mark invite as accepted
      await updateDoc(doc(db, "squadInvites", invite.id), {
        status: "accepted"
      });
      // ADDED: Close the invite modal after accepting
      setActiveModal(null);
    } catch (error) {
      console.error("Error accepting squad invite:", error);
      showAlert("Could not accept squad invite.");
    }
  };

  // --- Decline Squad Invite ---
  const handleDeclineSquadInvite = async (invite: DocumentData) => {
    try {
      // Mark invite as declined (or delete)
      await updateDoc(doc(db, "squadInvites", invite.id), {
        status: "declined"
      });
      showAlert("Squad invite declined.");
    } catch (error) {
      console.error("Error declining squad invite:", error);
      showAlert("Could not decline squad invite.");
    }
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

          // --- ADDED: Immediately create a squad for new users ---
          const squadDoc = await addDoc(collection(db, "squads"), {
            ownerId: user.uid,
            members: [user.uid],
            pendingMembers: [],
            createdAt: Date.now(),
          });
          await updateDoc(userRef, {
            squadId: squadDoc.id,
            squadOwnerId: user.uid,
          });
        } else {
          // --- ADDED: If user doc exists but no squadId, create squad ---
          const data = userDoc.data();
          if (!data?.squadId) {
            const squadDoc = await addDoc(collection(db, "squads"), {
              ownerId: user.uid,
              members: [user.uid],
              pendingMembers: [],
              createdAt: Date.now(),
            });
            await updateDoc(userRef, {
              squadId: squadDoc.id,
              squadOwnerId: user.uid,
            });
          }
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
  
  // User and friends data listener
// Listener for current user's data
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

  // Listener for friends' data - This now runs only when the friends list changes.
  useEffect(() => {
    const friendIds = userData?.friends || [];
    
    // Create listeners for each friend in the user's list
    const unsubscribes = friendIds.map(friendId =>
      onSnapshot(getUserDocRef(friendId), (doc) => {
        // If a friend's document exists, add or update them in the local state
        if (doc.exists()) {
          const friendData = { uid: doc.id, ...doc.data() } as UserData;
          setFriendsData(prevFriends => {
            const otherFriends = prevFriends.filter(f => f.uid !== friendId);
            return [...otherFriends, friendData];
          });
        } else {
          // If a friend's document has been deleted, remove them from the local state
          setFriendsData(prevFriends => prevFriends.filter(f => f.uid !== friendId));
        }
      })
    );

    // When the friend list changes, remove any users from the UI who are no longer friends.
    setFriendsData(prevFriends => prevFriends.filter(f => friendIds.includes(f.uid)));

    // Cleanup function to detach all listeners when the component unmounts or the friends list changes
    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [userData?.friends]); // T

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
      
      const updatePayload: LocationUpdatePayload & { lastUpdate: number } = {
        location: { x, y },
        currentArea: newAreaName,
        lastUpdate: Date.now() // <-- ADDED
      };

      if (newAreaName !== 'Out of Bounds') {
        updatePayload.lastKnownArea = newAreaName;
      }

      updateDoc(getUserDocRef(currentUser.uid), updatePayload)
        .catch(err => console.error("Error in mock location update: ", err));
        
    }, 20000);

    return () => clearInterval(intervalId);
  }, [currentUser, userData, areas]);


  // --- Automatically create a squad if not in one ---
  useEffect(() => {
    // Only run if user is signed in, userData is loaded, and not in a squad
    if (
      currentUser &&
      userData &&
      !userData.squadId
    ) {
      const createSquad = async () => {
        try {
          // Create a new squad document
          const squadDoc = await addDoc(collection(db, "squads"), {
            ownerId: currentUser.uid,
            members: [currentUser.uid],
            pendingMembers: [],
            createdAt: Date.now(),
          });
          // Update the user's squadId and squadOwnerId
          await updateDoc(doc(db, "users", currentUser.uid), {
            squadId: squadDoc.id,
            squadOwnerId: currentUser.uid,
          });
        } catch (err) {
          console.error("Error creating squad:", err);
        }
      };
      createSquad();
    }
  }, [currentUser, userData]);

  // --- Squad Invites Listener ---
  useEffect(() => {
    if (!currentUser?.uid) {
      setIncomingSquadInvites([]);
      setOutgoingSquadInvites([]); // ADDED
      return;
    }
    // Listen for incoming invites
    const qIn = query(collection(db, "squadInvites"), where("to", "==", currentUser.uid), where("status", "==", "pending"));
    const unsubIn = onSnapshot(qIn, (snapshot: QuerySnapshot<DocumentData>) => {
      setIncomingSquadInvites(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    // ADDED: Listen for outgoing invites
    const qOut = query(collection(db, "squadInvites"), where("from", "==", currentUser.uid), where("status", "==", "pending"));
    const unsubOut = onSnapshot(qOut, (snapshot: QuerySnapshot<DocumentData>) => {
      setOutgoingSquadInvites(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => { unsubIn(); unsubOut(); };
  }, [currentUser?.uid]);

  // ADDED: Withdraw squad invite handler
  const handleWithdrawSquadInvite = async (invite: DocumentData) => {
    try {
      await deleteDoc(doc(db, "squadInvites", invite.id));
    } catch (error) {
      console.error("Error withdrawing squad invite:", error);
      showAlert("Could not withdraw squad invite.");
    }
  };

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
      {/* --- HEADER --- */}
      <header className={styles.header}>
        <div className={styles.logo}>Herd Search</div>
      </header>

      {/* --- USER/DEV CONTROLS --- */}
      <div className={styles.userControls}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {userData?.photoURL && <Image src={userData.photoURL} alt="avatar" width={40} height={40} style={{ borderRadius: '50%' }} />}
          <span style={{ fontWeight: 600 }}>{userData?.displayName}</span>
          <button onClick={() => setActiveModal('settings')} className={styles.iconButton}><FaCog size={20} /></button>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}></div>
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
          priority // Prioritize loading the main map image
        />
        <canvas 
            ref={canvasRef} 
            className={styles.mapCanvas}
            onClick={handleCanvasClick}
            // --- MODIFIED --- Cursor changes to a pointer if manual check-in is enabled, indicating a clickable map.
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
     
      <div className={styles.squadList}>
        {/* Show squad UI if user has a squadId (even if it's just them) */}
        {userData?.squadId ? (
          <>
            {/* --- MODIFIED: Sort members so leader is first --- */}
            {(() => {
              const squadMembers = [userData, ...friendsData]
                .filter(u => u.squadId === userData.squadId);
              const leaderUid = getSquadLeaderUid();
              const sortedMembers = squadMembers.sort((a, b) =>
                a.uid === leaderUid ? -1 : b.uid === leaderUid ? 1 : 0
              );
              return sortedMembers.map(member => (
                <div
                  key={member.uid}
                  className={`${styles.card} ${getSquadLeaderUid() === member.uid ? styles.currentUserCard : ""}`}
                  onClick={() => setSelectedMember(member)}
                  style={{ cursor: "pointer" }}
                >
                  <Image src={member.photoURL!} alt="avatar" width={48} height={48} style={{borderRadius: '50%'}} />
                  <div>
                    <p style={{fontWeight: 'bold'}}>
                      {getSquadLeaderUid() === member.uid && <span style={{marginRight: 4}}>👑</span>}
                      {member.displayName}
                    </p>
                    {member.currentArea === 'The Wilds' ? (
                      <p style={{fontSize: '0.9rem'}}>Last Seen: <span style={{fontWeight: 600}}>{member.lastKnownArea || 'Unknown'}</span></p>
                    ) : (
                      <p style={{fontSize: '0.9rem'}}>Location: <span style={{fontWeight: 600}}>{member.currentArea || 'Unknown'}</span></p>
                    )}
                  </div>
                </div>
              ));
            })()}
            {/* ADDED: Outgoing squad invites cards */}
            {outgoingSquadInvites.map(invite => (
              <div
                key={invite.id}
                className={`${styles.card} ${styles.inviteCard}`}
                style={{ display: 'flex', alignItems: 'center', background: '#35354d', borderColor: '#3b82f6', marginTop: 8 }}
              >
                <div className={styles.inviteIconContainer}>
                  <FaBell color="#3b82f6" size={24} />
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{fontWeight: 'bold', color: '#1e40af', marginBottom: 2}}>
                    Invite sent to
                  </p>
                <strong>{getDisplayNameByUid(invite.to)}</strong>
                </div>
                <button
                  className={styles.dangerButton}
                  style={{marginLeft: 8, fontSize: '0.9rem', padding: '0.3rem 0.8rem'}}
                  onClick={() => handleWithdrawSquadInvite(invite)}
                >
                  Withdraw
                </button>
              </div>
            ))}
            {/* MODIFIED: Show notification card if there are pending invites, otherwise show invite card */}
            {incomingSquadInvites.length > 0 ? (
              <div
                className={`${styles.card} ${styles.inviteCard}`}
                onClick={() => setActiveModal('inviteToSquad')}
                style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', background: '#fffbe6', borderColor: '#facc15' }}
              >
                <div className={styles.inviteIconContainer}>
                  <FaBell color="#facc15" size={28} />
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{fontWeight: 'bold', color: '#b45309', marginBottom: 2}}>
                    Squad Invite!
                  </p>
                  {/* Show details for the first invite */}
                  <div style={{fontSize: '0.95rem', color: '#92400e'}}>
                    From: <strong>{getDisplayNameByUid(incomingSquadInvites[0].from)}</strong>
                  </div>
                </div>
                <div style={{marginLeft: 8, fontSize: '0.9rem', color: '#92400e'}}>
                  View
                </div>
              </div>
            ) : (
              getSquadLeaderUid() === userData.uid && (
                <div className={`${styles.card} ${styles.inviteCard}`} onClick={() => setActiveModal('inviteToSquad')}>
                  <div className={styles.inviteIconContainer}>
                    <span className={styles.invitePlus}>+</span>
                  </div>
                  <div>
                    <p style={{fontWeight: 'bold'}}>Invite Friends</p>
                  </div>
                </div>
              )
            )}
          </>
        ) : (
          // If not in a squad, show only the original card
          userData && (
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
          )
        )}
      </div>

      {/* --- MEMBER DETAIL POPUP --- */}
      {selectedMember && (
        <div className={styles.modalOverlay} onClick={() => setSelectedMember(null)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <Image src={selectedMember.photoURL!} alt="avatar" width={64} height={64} style={{borderRadius: '50%', marginBottom: 12}} />
            <h3 className={styles.modalHeader}>
              {getSquadLeaderUid() === selectedMember.uid && <span style={{marginRight: 4}}></span>}
              {selectedMember.displayName}
            </h3>
            <div style={{marginBottom: 8}}>
              <div><strong>Last Seen:</strong> {selectedMember.lastKnownArea || selectedMember.currentArea || "Unknown"}</div>
              <div>
                <strong></strong>{" "}
                {selectedMember.lastUpdate
                  ? new Date(selectedMember.lastUpdate).toLocaleString()
                  : "Unknown"}
              </div>
            </div>
            <div style={{marginBottom: 8}}>
              
            </div>
            {/* Only show kick button if current user is squad leader and not viewing their own card */}
            {getSquadLeaderUid() === userData?.uid && selectedMember.uid !== userData?.uid && (
              <button
                className={styles.dangerButton}
                // MODIFIED: Now calls confirmation wrapper
                onClick={() => handleKickMember(selectedMember)}
                style={{marginTop: 16}}
              >
                Kick from squad
              </button>
            )}
            {/* --- ADDED: Leave Squad button if viewing own card --- */}
            {selectedMember.uid === userData?.uid && (
              <button
                className={styles.dangerButton}
                // MODIFIED: Now calls confirmation wrapper
                onClick={handleLeaveSquad}
                style={{marginTop: 16}}
              >
                Leave Squad
              </button>
            )}
            <div className={styles.modalActions} style={{marginTop: 16}}>
              <button className={styles.primaryButton} onClick={() => setSelectedMember(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* --- FLOATING BUTTON --- */}
      {/* --- MODIFIED --- This block now conditionally renders the correct check-in button. */}
      {userData?.useGps === false && (
        <>
          {/* Show the specific check-in button if an area is selected by clicking the map */}
          {selectedAreaForCheckIn ? (
            <button 
              onClick={() => handleManualCheckIn(selectedAreaForCheckIn)} 
              className={styles.floatingButton}
            >
              <FaMapMarkerAlt /> Check into {selectedAreaForCheckIn.name}
            </button>
          ) : (
            // Otherwise, show the generic button to open the list modal
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
              <h3 className={styles.modalHeader}>Add a Friend</h3>
              {/* --- IMPROVED: Friends quick invite list above the email input --- */}
              {friendsData.filter(f => f.squadId !== userData?.squadId).length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <div>
                    {friendsData
                      .filter(friend => friend.squadId !== userData?.squadId)
                      .map(friend => (
                        <div
                          key={friend.uid}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            padding: '0.5rem 0',
                            borderBottom: '1px solid #494e61'
                          }}
                        >
                          <Image
                            src={friend.photoURL || "/default-avatar.png"}
                            alt={friend.displayName || "Friend"}
                            width={32}
                            height={32}
                            style={{ borderRadius: '50%' }}
                          />
                          <span style={{ flex: 1, fontWeight: 500 }}>{friend.displayName}</span>
                          <button
                            className={styles.secondaryButton}
                            style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', minWidth: 80 }}
                            onClick={() => handleInviteToSquad(friend.uid)}
                            aria-label={`Invite ${friend.displayName} to squad`}
                          >
                            Invite
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              )}
              {/* --- END IMPROVED --- */}
              <div style={{ marginBottom: '0.5rem', fontWeight: 600 }}>Invite by email:</div>
              <input
                type="email"
                placeholder="friend@example.com"
                value={friendEmail}
                onChange={e => setFriendEmail(e.target.value)}
                className={styles.textInput}
                autoFocus
              />
              <div className={styles.modalActions}>
                <button onClick={() => setActiveModal(null)} className={styles.neutralButton}>Cancel</button>
                {/* --- RESTORED: Invite by email button --- */}
                <button
                  onClick={async () => {
                    // Try to add friend by email, then send squad invite if already a friend
                    if (!friendEmail || !currentUser) return;
                    try {
                      const q = query(getPublicProfileCollection(), where("email", "==", friendEmail.toLowerCase()));
                      const querySnapshot = await getDocs(q);

                      if (querySnapshot.empty) {
                        showAlert("User not found. Ensure they have signed in at least once.");
                        return;
                      }

                      const friendUid = querySnapshot.docs[0].id;
                      if (friendUid === currentUser.uid) {
                        showAlert("You can't add yourself as a friend!");
                        return;
                      }

                      const userFriends = userData?.friends || [];
                      if (!userFriends.includes(friendUid)) {
                        // Add as friend first
                        await updateDoc(getUserDocRef(currentUser.uid), {
                          friends: arrayUnion(friendUid)
                        });
                        showAlert("Friend added successfully! Now inviting to squad...");
                      }
                      // Send squad invite
                      await handleInviteToSquad(friendUid);
                      setFriendEmail('');
                      setActiveModal(null);
                    } catch (error) {
                      console.error("Error inviting by email:", error);
                      showAlert("An error occurred while inviting by email.");
                    }
                  }}
                  className={styles.primaryButton}
                >
                  Invite by Email
                </button>
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

            {/* --- ADDED --- Modal for renaming an existing area */}
            {activeModal === 'renameArea' && renamingArea && (<>
              {/* --- FIXED --- Replaced " with &quot; to avoid unescaped entities error */}
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
                    {/* --- MODIFIED --- Added a container for the action buttons */}
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

            {/* --- ADDED --- Modal for inviting friends to squad */}
            {activeModal === 'inviteToSquad' && (
              <>
                <h3 className={styles.modalHeader}>Squad Invites</h3>
                {/* --- Incoming Squad Invites --- */}
                {incomingSquadInvites.length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
             
                    <div>
                      {incomingSquadInvites.map(invite => (
                        <div key={invite.id} className={styles.locationItemManager}>
                          <span>
                            Squad invite from 
                            <br />
                           <strong>{getDisplayNameByUid(invite.from)}</strong>
                          </span>
                         
                        
                       
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                              className={styles.acceptButton}
                              onClick={() => handleAcceptSquadInvite(invite)}
                            >
                              ✔
                            </button>
                            <button
                              className={styles.dangerButton}
                              onClick={() => handleDeclineSquadInvite(invite)}
                            >
                              ✘
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* --- Friends quick invite list --- */}
                {friendsData.filter(f => f.squadId !== userData?.squadId).length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
     
                    <div>
                      {friendsData
                        .filter(friend => friend.squadId !== userData?.squadId)
                        .map(friend => (
                          <div
                            key={friend.uid}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.75rem',
                              padding: '0.5rem 0',
                              borderBottom: '1px solid #494e61'
                            }}
                          >
                            <Image
                              src={friend.photoURL || "/default-avatar.png"}
                              alt={friend.displayName || "Friend"}
                              width={32}
                              height={32}
                              style={{ borderRadius: '50%' }}
                            />
                            <span style={{ flex: 1, fontWeight: 500 }}>{friend.displayName}</span>
                            <button
                              className={styles.secondaryButton}
                              style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', minWidth: 80 }}
                              onClick={() => handleInviteToSquad(friend.uid)}
                              aria-label={`Invite ${friend.displayName} to squad`}
                            >
                              Invite
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
                 <br />
                  <br />
                {/* --- Invite by email --- */}
                <div style={{ marginBottom: '0.5rem', fontWeight: 600 }}>Invite by email:</div>
                <input
                  type="email"
                  placeholder="friend@example.com"
                  value={friendEmail}
                  onChange={e => setFriendEmail(e.target.value)}
                  className={styles.textInput}
                />
                <div className={styles.modalActions}>
                  <button onClick={() => setActiveModal(null)} className={styles.neutralButton}>Cancel</button>
                  <button
                    onClick={async () => {
                      // Try to add friend by email, then send squad invite if already a friend
                      if (!friendEmail || !currentUser) return;
                      try {
                        const q = query(getPublicProfileCollection(), where("email", "==", friendEmail.toLowerCase()));
                        const querySnapshot = await getDocs(q);

                        if (querySnapshot.empty) {
                          showAlert("User not found. Ensure they have signed in at least once.");
                          return;
                        }

                        const friendUid = querySnapshot.docs[0].id;
                        if (friendUid === currentUser.uid) {
                          showAlert("You can't add yourself as a friend!");
                          return;
                        }

                        const userFriends = userData?.friends || [];
                        if (!userFriends.includes(friendUid)) {
                          // Add as friend first
                          await updateDoc(getUserDocRef(currentUser.uid), {
                            friends: arrayUnion(friendUid)
                          });
                          showAlert("Friend added successfully! Now inviting to squad...");
                        }
                        // Send squad invite
                        await handleInviteToSquad(friendUid);
                        setFriendEmail('');
                        setActiveModal(null);
                      } catch (error) {
                        console.error("Error inviting by email:", error);
                        showAlert("An error occurred while inviting by email.");
                      }
                    }}
                    className={styles.primaryButton}
                  >
                    Invite by Email
                  </button>
                </div>
              </>
            )}

          </div>
        </div>
      )}
    </div>
  );
}