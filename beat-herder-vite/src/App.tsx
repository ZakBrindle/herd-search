import { useState, useEffect, useRef, useCallback } from 'react';
import {
  FaMapMarkerAlt, FaCog, FaTrash, FaPencilAlt, FaBell, FaMap, FaUserFriends, FaUser
} from 'react-icons/fa';
import {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, type User
} from "firebase/auth";
import {
  doc, onSnapshot, setDoc, getDoc, updateDoc, arrayUnion, collection,
  query, where, getDocs, addDoc, deleteDoc, type DocumentData, arrayRemove
} from "firebase/firestore";
import { auth, db } from './firebase';

// --- Type Definitions ---
type Point = { x: number; y: number };
type Area = { id: string; name: string; polygon: Point[] };
type Tier = 'free' | 'basic' | 'standard' | 'premium';

type UserData = DocumentData & {
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
};
type ConfirmAction = {
  message: string;
  onConfirm: () => void;
};

const TIER_LIMITS = {
  free: 0,
  basic: 1,
  standard: 3,
  premium: 8
};

const PLANS = [
  { id: 'basic', name: 'Just the 2 of us', price: '£2.99', limit: 1 },
  { id: 'standard', name: 'Squad of 4', price: '£4.99', limit: 3 },
  { id: 'premium', name: 'Full Squad', price: '£9.99', limit: 8 }
];

// --- Main Component ---
export default function App() {
  // --- State Management ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [friendsData, setFriendsData] = useState<UserData[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [allowTierCycling, setAllowTierCycling] = useState(false);
  const [isDevMode, setIsDevMode] = useState(false);
  const [friendEmail, setFriendEmail] = useState('');
  const [areaName, setAreaName] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [showZones, setShowZones] = useState(false);
  const [renamingArea, setRenamingArea] = useState<Area | null>(null);
  const [newAreaName, setNewAreaName] = useState('');
  const [selectedAreaForCheckIn, setSelectedAreaForCheckIn] = useState<Area | null>(null);
  const [selectedMember, setSelectedMember] = useState<UserData | null>(null);
  const [incomingSquadInvites, setIncomingSquadInvites] = useState<DocumentData[]>([]);
  const [outgoingSquadInvites, setOutgoingSquadInvites] = useState<DocumentData[]>([]);
  const [publicProfileCache, setPublicProfileCache] = useState<{ [uid: string]: string }>({});

  const [activeTab, setActiveTab] = useState<'map' | 'friends' | 'profile'>('map');

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
        drawPolygon(ctx, area.polygon, 'rgba(3, 218, 198, 0.3)', 'rgba(3, 218, 198, 0.7)');
      });
    }

    if (isDevMode && currentPolygonPoints.current.length > 0) {
      drawPolygon(ctx, currentPolygonPoints.current, 'rgba(187, 134, 252, 0.3)', 'rgba(187, 134, 252, 0.7)', true);
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
      ctx.fillStyle = '#CF6679';
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

  const handleInviteToSquad = async (friendUid: string) => {
    if (!userData?.squadId || !userData?.uid) return;

    // Check Tier Limits
    const myTier = userData.tier || 'free';
    if (myTier === 'free') {
      showAlert("Free tier users cannot invite friends to a squad. Please upgrade to create a squad.");
      return;
    }

    // Check Squad Size Limit
    const squadMembers = [userData, ...friendsData].filter(u => u.squadId === userData.squadId);
    if (squadMembers.length >= (TIER_LIMITS[myTier] + 1)) { // +1 for self
      showAlert(`You have reached the limit of your ${myTier} plan (${TIER_LIMITS[myTier]} friends). Upgrade to invite more users.`);
      return;
    }

    if (userData.uid !== userData.squadOwnerId) {
      showAlert("Only the squad leader can send invites.");
      return;
    }
    try {
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
        lastKnownArea: area.name,
        lastUpdate: Date.now()
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

  const getSquadLeaderUid = () => {
    if (!userData?.squadId) return null;
    const leader = [userData, ...friendsData].find(u => u.uid === userData.squadOwnerId);
    return leader ? leader.uid : userData.squadOwnerId || userData.uid;
  };

  const getDisplayNameByUid = (uid: string): string => {
    if (uid === userData?.uid) return userData.displayName || uid;
    const friend = friendsData.find(f => f.uid === uid);
    if (friend?.displayName) return friend.displayName;
    return publicProfileCache[uid] || uid;
  };

  useEffect(() => {
    const inviteUids = [
      ...incomingSquadInvites.map(inv => inv.from),
      ...outgoingSquadInvites.map(inv => inv.to)
    ].filter(uid =>
      uid !== userData?.uid &&
      !friendsData.some(f => f.uid === uid) &&
      !(publicProfileCache[uid])
    );
    if (inviteUids.length === 0) return;
    inviteUids.forEach(async uid => {
      try {
        const docRef = doc(db, 'public/user_profiles/users', uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const profile = docSnap.data();
          setPublicProfileCache(prev => ({
            ...prev,
            [uid]: profile.displayName || uid
          }));
        }
      } catch (e) { }
    });
  }, [incomingSquadInvites, outgoingSquadInvites, friendsData, userData, publicProfileCache]);

  const handleKickMemberConfirmed = async (member: UserData) => {
    if (!userData || !userData.squadId || !member.uid) return;
    try {
      await updateDoc(doc(db, "squads", userData.squadId), {
        members: arrayRemove(member.uid)
      });
      await updateDoc(getUserDocRef(member.uid), {
        squadId: null
      });
      setSelectedMember(null);
    } catch (error) {
      console.error("Error kicking member:", error);
      showAlert("Failed to kick member from squad.");
      setSelectedMember(null);
    }
  };

  const handleKickMember = (member: UserData) => {
    setSelectedMember(null);
    showConfirm(
      `Are you sure you want to kick '${member.displayName}' from the squad?`,
      () => handleKickMemberConfirmed(member)
    );
  };

  const handleLeaveSquadConfirmed = async () => {
    if (!userData || !userData.squadId || !currentUser) return;
    try {
      await updateDoc(doc(db, "squads", userData.squadId), {
        members: arrayRemove(currentUser.uid)
      });
      const squadDoc = await addDoc(collection(db, "squads"), {
        ownerId: currentUser.uid,
        members: [currentUser.uid],
        pendingMembers: [],
        createdAt: Date.now(),
      });
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

  const handleLeaveSquad = () => {
    setSelectedMember(null);
    showConfirm(
      "Are you sure you want to leave the squad?",
      handleLeaveSquadConfirmed
    );
  };

  const handleAcceptSquadInvite = async (invite: DocumentData) => {
    try {
      await updateDoc(doc(db, "squads", invite.squadId), {
        members: arrayUnion(currentUser!.uid)
      });
      await updateDoc(doc(db, "users", currentUser!.uid), {
        squadId: invite.squadId,
        squadOwnerId: invite.from
      });
      await updateDoc(doc(db, "squadInvites", invite.id), {
        status: "accepted"
      });
      setActiveModal(null);
    } catch (error) {
      console.error("Error accepting squad invite:", error);
      showAlert("Could not accept squad invite.");
    }
  };

  const handleDeclineSquadInvite = async (invite: DocumentData) => {
    try {
      await updateDoc(doc(db, "squadInvites", invite.id), {
        status: "declined"
      });
      showAlert("Squad invite declined.");
    } catch (error) {
      console.error("Error declining squad invite:", error);
      showAlert("Could not decline squad invite.");
    }
  };

  const handleWithdrawSquadInvite = async (invite: DocumentData) => {
    try {
      await deleteDoc(doc(db, "squadInvites", invite.id));
    } catch (error) {
      console.error("Error withdrawing squad invite:", error);
      showAlert("Could not withdraw squad invite.");
    }
  };

  const handleUpgrade = async (planId: Tier) => {
    // If Admin Dev Mode for Cycling is on, just switch instantly without payment simulation logic (conceptually)
    // Here we just use the same logic but the user perception of "payment" is bypassed by intent.
    // In a real app, successful payment callback would trigger this.

    if (!currentUser) return;
    try {
      if (allowTierCycling && currentUser.email === 'z4kbrindle@gmail.com') {
        // Just set it directly
      } else {
        // Simulate Payment Delay or Process here if needed
      }

      await updateDoc(getUserDocRef(currentUser.uid), {
        tier: planId,
        subscriptionExpiry: Date.now() + (365 * 24 * 60 * 60 * 1000) // 1 year
      });
      showAlert(allowTierCycling ? `Dev Mode: Switched to ${planId}` : "Upgrade successful! You now have access to better squad features.");
      setActiveModal(null);
    } catch (e) {
      console.error(e);
      showAlert("Upgrade failed.");
    }
  };

  // --- Subscriptions ---
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
            photoURL: user.photoURL,
            tier: 'free'
          };
          await setDoc(userRef, { ...profileData, friends: [], location: null, currentArea: 'unknown', useGps: true, lastKnownArea: 'unknown' });
          await setDoc(publicProfileRef, profileData);

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

  useEffect(() => {
    if (!currentUser?.uid) return;
    const unsubUser = onSnapshot(getUserDocRef(currentUser.uid), (doc) => {
      if (doc.exists()) {
        const data = doc.data() as UserData;
        setUserData(data);
      }
    });
    return () => unsubUser();
  }, [currentUser?.uid]);

  useEffect(() => {
    const friendIds = userData?.friends || [];
    if (friendIds.length === 0) return;
    const unsubscribes = friendIds.map(friendId =>
      onSnapshot(getUserDocRef(friendId), (doc) => {
        if (doc.exists()) {
          const friendData = { uid: doc.id, ...doc.data() } as UserData;
          setFriendsData(prevFriends => {
            const otherFriends = prevFriends.filter(f => f.uid !== friendId);
            return [...otherFriends, friendData];
          });
        }
      })
    );
    return () => unsubscribes.forEach(unsub => unsub());
  }, [userData?.friends]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const qIn = query(collection(db, "squadInvites"), where("to", "==", currentUser.uid), where("status", "==", "pending"));
    const unsubIn = onSnapshot(qIn, (snapshot) => {
      setIncomingSquadInvites(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    const qOut = query(collection(db, "squadInvites"), where("from", "==", currentUser.uid), where("status", "==", "pending"));
    const unsubOut = onSnapshot(qOut, (snapshot) => {
      setOutgoingSquadInvites(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => { unsubIn(); unsubOut(); };
  }, [currentUser?.uid]);

  // --- Render ---
  if (!currentUser) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <h1 className="logo" style={{ fontSize: '3rem', marginBottom: '2rem' }}>Herd Search</h1>
        <button
          onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}
          className="btn"
          style={{ background: 'white', color: '#444', border: '1px solid #ccc', display: 'flex', alignItems: 'center', gap: '1rem' }}
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" width="24" />
          Sign in with Google
        </button>
      </div>
    );
  }

  const renderContent = () => {
    if (activeTab === 'map') {
      return (
        <>
          <header>
            <div className="logo">Herd Search</div>
            <div className="user-controls" onClick={() => setActiveTab('profile')} style={{ cursor: 'pointer' }}>
              {userData?.photoURL && <img className="avatar" src={userData.photoURL} alt="Profile" />}
            </div>
          </header>

          {isDevMode && (
            <div className="dev-panel">
              <h3>Developer Mode</h3>
              <p>Click on the map to draw areas.</p>
              <button onClick={cancelDrawing} className="btn btn-danger" style={{ padding: '0.25rem 0.5rem' }}>Cancel</button>
            </div>
          )}

          {/* Map */}
          <div className="map-container">
            <img
              ref={mapImageRef}
              src="/Beatherder Map.png"
              alt="Map"
              className="map-image"
              onLoad={resizeCanvas}
            />
            <canvas
              ref={canvasRef}
              className="map-canvas"
              onClick={handleCanvasClick}
              style={{ cursor: isDevMode ? 'crosshair' : (userData?.useGps === false ? 'pointer' : 'default') }}
            />

            {userData?.location && (
              <div className="user-marker" style={{ left: `${userData.location.x * 100}%`, top: `${userData.location.y * 100}%` }}>
                <img src={userData.photoURL || "/default-avatar.png"} className="marker-avatar" alt="Me" />
                <div className="marker-label">You</div>
              </div>
            )}

            {friendsData
              .filter(f => !!f.location && f.squadId === userData?.squadId)
              .map(u => (
                <div key={u.uid} className="user-marker" style={{ left: `${u.location!.x * 100}%`, top: `${u.location!.y * 100}%` }}>
                  <img src={u.photoURL || "/default-avatar.png"} className="marker-avatar" alt={u.displayName} />
                  <div className="marker-label">{u.displayName?.split(' ')[0]}</div>
                </div>
              ))}
          </div>

          {/* Floating Button */}
          {userData?.useGps === false && (
            <button onClick={() => selectedAreaForCheckIn ? handleManualCheckIn(selectedAreaForCheckIn) : setActiveModal('checkIn')} className="floating-btn">
              <FaMapMarkerAlt /> {selectedAreaForCheckIn ? `Check into ${selectedAreaForCheckIn.name}` : `Check In`}
            </button>
          )}
        </>
      )
    }

    if (activeTab === 'friends') {
      return (
        <>
          <h2 className="section-title">My Squad</h2>
          <div className="squad-list">
            {userData?.squadId && (() => {
              const squadMembers = [userData, ...friendsData].filter(u => u.squadId === userData.squadId);
              const leaderUid = getSquadLeaderUid();
              return squadMembers
                .sort((a, b) => a.uid === leaderUid ? -1 : b.uid === leaderUid ? 1 : 0)
                .map(member => (
                  <div key={member.uid} className={`card ${member.uid === currentUser.uid ? 'current-user' : ''}`} onClick={() => setSelectedMember(member)}>
                    <img src={member.photoURL!} className="avatar" alt="Avatar" />
                    <div>
                      <h3>
                        {leaderUid === member.uid && '👑 '}
                        {member.displayName}
                      </h3>
                      <p>
                        {member.currentArea === 'The Wilds' ?
                          <>Last Seen <span className="location-tag">{member.lastKnownArea || 'Unknown'}</span></> :
                          <>Location: <span className="location-tag">{member.currentArea || 'Unknown'}</span></>
                        }
                      </p>
                    </div>
                  </div>
                ));
            })()}

            {/* Invites Sections */}
            {outgoingSquadInvites.map(invite => (
              <div key={invite.id} className="card" style={{ borderColor: '#bb86fc' }}>
                <FaBell color="#bb86fc" />
                <div style={{ flex: 1 }}>
                  <p>Invite sent to <strong>{getDisplayNameByUid(invite.to)}</strong></p>
                </div>
                <button className="btn btn-danger" style={{ padding: '4px 8px', fontSize: '12px' }} onClick={() => handleWithdrawSquadInvite(invite)}>Withdraw</button>
              </div>
            ))}

            {incomingSquadInvites.length > 0 && (
              <div className="card" onClick={() => setActiveModal('inviteToSquad')} style={{ cursor: 'pointer', borderColor: '#facc15' }}>
                <FaBell color="#facc15" size={24} />
                <div>
                  <h3>Squad Invite!</h3>
                  <p>From: <strong>{getDisplayNameByUid(incomingSquadInvites[0].from)}</strong></p>
                </div>
              </div>
            )}

            {/* Only allow adding friends if they are the leader */}
            {getSquadLeaderUid() === userData?.uid && (
              <div className="card" onClick={() => setActiveModal('inviteToSquad')} style={{ cursor: 'pointer', justifyContent: 'center' }}>
                <h3>+ Invite Friends to Squad</h3>
              </div>
            )}
          </div>

          <h2 className="section-title">All Friends</h2>
          <div className="squad-list">
            {friendsData.map(friend => (
              <div key={friend.uid} className="card" onClick={() => setSelectedMember(friend)}>
                <img src={friend.photoURL || "/default-avatar.png"} className="avatar" alt="Avatar" />
                <div>
                  <h3>{friend.displayName}</h3>
                  <p>Status: {friend.squadId ? (friend.squadId === userData?.squadId ? "In your squad" : "In another squad") : "Alone or Free"}</p>
                </div>
              </div>
            ))}
            {/* Reuse the Invite Friends modal logic to add new friends via email */}
            <div className="card" onClick={() => setActiveModal('inviteToSquad')} style={{ cursor: 'pointer', justifyContent: 'center', marginTop: '1rem', borderStyle: 'dashed' }}>
              <p>+ Add Friend by Email</p>
            </div>
          </div>
        </>
      )
    }

    if (activeTab === 'profile') {
      const tier = userData?.tier || 'free';
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '2rem' }}>
          {userData?.photoURL && <img className="avatar-large" src={userData.photoURL} alt="Profile" />}
          <h1 style={{ margin: '0.5rem 0' }}>{userData?.displayName}</h1>
          <p style={{ color: 'var(--text-muted)' }}>{userData?.email}</p>

          <div className="card" style={{ width: '100%', marginTop: '2rem', flexDirection: 'column', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <h3>Current Plan</h3>
              <span style={{
                padding: '4px 12px',
                borderRadius: '20px',
                background: tier === 'free' ? '#333' : 'var(--secondary)',
                color: tier === 'free' ? '#aaa' : '#000',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                fontSize: '0.8rem'
              }}>{tier}</span>
            </div>
            <p>
              {tier === 'free' && "You are on the Free Tier. You can join squads but cannot create your own."}
              {tier !== 'free' && `You can invite up to ${TIER_LIMITS[tier]} friends to your squad.`}
            </p>
          </div>

          <button onClick={() => setActiveModal('upgrade')} className="btn btn-primary w-full mt-4" style={{ background: 'linear-gradient(45deg, var(--primary), var(--secondary))' }}>
            Upgrade Plan ⚡
          </button>

          <div className="card" style={{ width: '100%', marginTop: '1rem', cursor: 'pointer' }} onClick={() => setActiveModal('settings')}>
            <FaCog /> Settings
          </div>
        </div>
      )
    }
  }

  return (
    <div className="app-container">
      {renderContent()}

      <nav className="bottom-nav">
        <button className={`nav-item ${activeTab === 'map' ? 'active' : ''}`} onClick={() => setActiveTab('map')}>
          <FaMap />
          <span>Map</span>
        </button>
        <button className={`nav-item ${activeTab === 'friends' ? 'active' : ''}`} onClick={() => setActiveTab('friends')}>
          <FaUserFriends />
          <span>Friends</span>
        </button>
        <button className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => setActiveTab('profile')}>
          <FaUser />
          <span>Profile</span>
        </button>
      </nav>

      {/* Modals */}
      {activeModal === 'settings' && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="modal-header">Settings</h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <span>Use GPS (Simulated)</span>
              <input type="checkbox" checked={userData?.useGps ?? true} onChange={e => handleGpsToggle(e.target.checked)} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <span>Show Zones</span>
              <input type="checkbox" checked={showZones} onChange={e => setShowZones(e.target.checked)} />
            </div>
            {currentUser?.email === 'z4kbrindle@gmail.com' && (
              <>
                <button onClick={() => setActiveModal('locations')} className="btn btn-secondary w-full" style={{ marginBottom: '1rem' }}>
                  Manage Locations
                </button>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <span>Dev Mode (Tier Cycling)</span>
                  <input type="checkbox" checked={allowTierCycling} onChange={e => setAllowTierCycling(e.target.checked)} />
                </div>
              </>
            )}
            <div className="modal-actions">
              <button onClick={() => signOut(auth)} className="btn btn-danger">Sign Out</button>
              <button onClick={() => setActiveModal(null)} className="btn btn-primary">Done</button>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'upgrade' && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="modal-header">Choose Your Plan</h3>
            <p className="text-center" style={{ marginBottom: '1.5rem', color: 'var(--text-muted)' }}>Upgrade to create squads and invite friends!</p>

            {PLANS.map(plan => (
              <div key={plan.id} className={`pricing-card`} onClick={() => handleUpgrade(plan.id as Tier)}>
                <h3>{plan.name}</h3>
                <div className="pricing-price">{plan.price}<span style={{ fontSize: '0.9rem', color: '#888', fontWeight: 'normal' }}>/year</span></div>
                <p>Invite {plan.limit} friend{plan.limit > 1 ? 's' : ''} to your squad</p>
              </div>
            ))}

            <div className="modal-actions">
              <button onClick={() => setActiveModal(null)} className="btn btn-secondary">Close</button>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'checkIn' && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="modal-header">Select Location</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '300px', overflowY: 'auto' }}>
              {areas.map(area => (
                <div key={area.id} className="card" onClick={() => handleManualCheckIn(area)} style={{ cursor: 'pointer' }}>
                  {area.name}
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button onClick={() => setActiveModal(null)} className="btn btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'locations' && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="modal-header">Locations</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '300px', overflowY: 'auto' }}>
              {areas.map(area => (
                <div key={area.id} className="card" style={{ justifyContent: 'space-between' }}>
                  <span>{area.name}</span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={() => { setRenamingArea(area); setNewAreaName(area.name); setActiveModal('renameArea') }} className="icon-button"><FaPencilAlt /></button>
                    <button onClick={() => handleDeleteArea(area.id)} className="icon-button" style={{ color: 'var(--error)' }}><FaTrash /></button>
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button onClick={() => { setActiveModal(null); setIsDevMode(true) }} className="btn btn-primary">Add New</button>
              <button onClick={() => setActiveModal(null)} className="btn btn-secondary">Close</button>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'areaName' && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-header">Name Area</h3>
            <input value={areaName} onChange={e => setAreaName(e.target.value)} className="input-field" autoFocus />
            <div className="modal-actions">
              <button onClick={cancelDrawing} className="btn btn-secondary">Cancel</button>
              <button onClick={handleSaveArea} className="btn btn-primary">Save</button>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'renameArea' && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-header">Rename Area</h3>
            <input value={newAreaName} onChange={e => setNewAreaName(e.target.value)} className="input-field" autoFocus />
            <div className="modal-actions">
              <button onClick={() => setActiveModal('locations')} className="btn btn-secondary">Cancel</button>
              <button onClick={handleRenameArea} className="btn btn-primary">Save</button>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'inviteToSquad' && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="modal-header">Invite / Add Friend</h3>

            {incomingSquadInvites.length > 0 && (
              <div>
                <h4>Squad Invites</h4>
                {incomingSquadInvites.map(invite => (
                  <div key={invite.id} className="card">
                    <span>{getDisplayNameByUid(invite.from)}</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => handleAcceptSquadInvite(invite)} className="btn btn-primary" style={{ padding: '4px 8px' }}>✔</button>
                      <button onClick={() => handleDeclineSquadInvite(invite)} className="btn btn-danger" style={{ padding: '4px 8px' }}>✘</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4">
              <h4>Search User by Email</h4>
              <input type="email" value={friendEmail} onChange={e => setFriendEmail(e.target.value)} className="input-field" placeholder="friend@example.com" />
              <button onClick={async () => {
                // Logic for email invite...
                if (!friendEmail || !currentUser) return;
                try {
                  const q = query(getPublicProfileCollection(), where("email", "==", friendEmail.toLowerCase()));
                  const querySnapshot = await getDocs(q);
                  if (querySnapshot.empty) { showConfirm("User not found!", () => { }); return; }
                  const friendUid = querySnapshot.docs[0].id;
                  if (friendUid === currentUser.uid) return;
                  // Add as friend first (always allowed)
                  const userFriends = userData?.friends || [];
                  if (!userFriends.includes(friendUid)) {
                    await updateDoc(getUserDocRef(currentUser.uid), { friends: arrayUnion(friendUid) });
                    showAlert(`${friendEmail} added to friends!`);
                    setFriendEmail('');
                  } else {
                    // If already friend, try to invite to squad
                    await handleInviteToSquad(friendUid);
                    setFriendEmail('');
                  }
                } catch (e) { console.error(e); }
              }} className="btn btn-primary w-full">Add Friend / Invite</button>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'alert' && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <p className="text-center">{alertMessage}</p>
            <div className="modal-actions" style={{ justifyContent: 'center' }}>
              <button onClick={() => setActiveModal(null)} className="btn btn-primary">OK</button>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'confirm' && confirmAction && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-header">Confirm</h3>
            <p className="text-center">{confirmAction.message}</p>
            <div className="modal-actions">
              <button onClick={() => setActiveModal(null)} className="btn btn-secondary">Cancel</button>
              <button onClick={() => { confirmAction.onConfirm(); setActiveModal(null); }} className="btn btn-danger">Confirm</button>
            </div>
          </div>
        </div>
      )}

      {selectedMember && (
        <div className="modal-overlay" onClick={() => setSelectedMember(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div style={{ textAlign: 'center' }}>
              <img src={selectedMember.photoURL!} alt="Avatar" className="avatar" style={{ width: 80, height: 80, marginBottom: '1rem' }} />
              <h2>{selectedMember.displayName}</h2>
              <p>{selectedMember.currentArea || "Unknown Location"}</p>

              {/* Case 1: Friend is in MY squad and I am leader -> Kick */}
              {getSquadLeaderUid() === userData?.uid && selectedMember.squadId === userData?.squadId && selectedMember.uid !== userData?.uid && (
                <button onClick={() => handleKickMember(selectedMember)} className="btn btn-danger w-full mt-4">Kick from Squad</button>
              )}

              {/* Case 2: Friend is NOT in ANY squad and I have capacity -> Invite */}
              {!selectedMember.squadId && userData?.squadId && getSquadLeaderUid() === userData?.uid && selectedMember.uid !== userData?.uid && (userData.tier !== 'free') && (
                <button onClick={() => { setSelectedMember(null); handleInviteToSquad(selectedMember.uid); }} className="btn btn-primary w-full mt-4">Invite to Squad</button>
              )}

              {/* Case 3: I want to remove them from my friend list (always available if not self) */}
              {selectedMember.uid !== userData?.uid && (
                <button onClick={() => {
                  // Remove friend logic
                  showConfirm(`Remove ${selectedMember.displayName} from friends?`, async () => {
                    try {
                      await updateDoc(getUserDocRef(currentUser!.uid), { friends: arrayRemove(selectedMember.uid) });
                      setSelectedMember(null);
                      showAlert("Friend removed.");
                    } catch (e) { console.error(e); }
                  });
                }} className="btn btn-danger w-full mt-4" style={{ background: 'transparent', border: '1px solid var(--error)' }}>Remove Friend</button>
              )}

              {selectedMember.uid === userData?.uid && (
                <button onClick={handleLeaveSquad} className="btn btn-danger w-full mt-4">Leave Squad</button>
              )}
              <button onClick={() => setSelectedMember(null)} className="btn btn-secondary w-full mt-4">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
