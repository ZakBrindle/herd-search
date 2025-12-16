import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FaMapMarkerAlt, FaCog, FaTrash, FaPencilAlt, FaMap, FaUserFriends, FaUser, FaTimes
} from 'react-icons/fa';
import {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, type User
} from "firebase/auth";
import SupportSystem from './components/SupportSystem';
import {
  doc, onSnapshot, setDoc, getDoc, updateDoc, arrayUnion, collection,
  query, where, getDocs, addDoc, deleteDoc, type DocumentData, arrayRemove
} from "firebase/firestore";
import { auth, db, messaging } from './firebase';
import { getToken, onMessage } from "firebase/messaging";

// --- Type Definitions ---
import LocationPicker from './components/LocationPicker';

type Point = { x: number; y: number };
type Area = { id: string; name: string; polygon: Point[] };
type Tier = 'free' | 'basic' | 'standard' | 'premium' | 'festival';
type GPSBounds = {
  north: number; // Max Lat
  south: number; // Min Lat
  east: number;  // Max Lon
  west: number;  // Min Lon
};

type Vote = {
  id: string;
  creatorId: string;
  creatorName: string;
  targetAreaId: string;
  targetAreaName: string;
  createdAt: number;
  votes: { [uid: string]: 'yes' | 'no' };
  completedAt?: number;
};


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
  ghostMode?: boolean;
  ghostModeExpiry?: number;
  isDev?: boolean;
  statusMessage?: string;
  statusTimestamp?: number;
};


type ConfirmAction = {
  message: string;
  onConfirm: () => void;
};

const TIER_LIMITS = {
  free: 0,
  basic: 1,
  standard: 3,
  premium: 8,
  festival: 20
};

const PLANS = [
  { id: 'basic', name: 'Just the 2 of us', price: '£2.99', limit: 1 },
  { id: 'standard', name: 'Squad of 4', price: '£4.99', limit: 3 },
  { id: 'premium', name: 'Full Squad', price: '£9.99', limit: 8 },
  { id: 'festival', name: 'Festival Group', price: '£15.99', limit: 20 }
];

// --- Helper Components ---
const FriendStatus = ({ friend, mySquadId }: { friend: UserData, mySquadId?: string }) => {
  const [statusText, setStatusText] = useState("Loading...");

  useEffect(() => {
    if (!friend.squadId) {
      setStatusText("Alone or Free");
      return;
    }
    if (friend.squadId === mySquadId) {
      setStatusText("In your squad");
      return;
    }

    // Subscribe to that squad to check member count
    const unsub = onSnapshot(doc(db, "squads", friend.squadId), (sDoc) => {
      if (sDoc.exists()) {
        const data = sDoc.data();
        if (data?.members && data.members.length > 1) {
          setStatusText("In another squad");
        } else {
          setStatusText("Alone or Free");
        }
      } else {
        setStatusText("Alone or Free");
      }
    });

    return () => unsub();
  }, [friend.squadId, mySquadId]);

  return <span>Status: {statusText}</span>;
};

// --- Main Component ---
export default function App() {
  const navigate = useNavigate();
  // --- State Management ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [squadData, setSquadData] = useState<DocumentData | null>(null);
  const [friendsData, setFriendsData] = useState<UserData[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [activeModal, setActiveModal] = useState<string | null>(null);
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
  const [selectedMemberContext, setSelectedMemberContext] = useState<'squad' | 'friend' | null>(null);
  const [incomingSquadInvites, setIncomingSquadInvites] = useState<DocumentData[]>([]);
  const [outgoingSquadInvites, setOutgoingSquadInvites] = useState<DocumentData[]>([]);
  const [incomingFriendRequests, setIncomingFriendRequests] = useState<DocumentData[]>([]);
  const [outgoingFriendRequests, setOutgoingFriendRequests] = useState<DocumentData[]>([]);
  const [publicProfileCache, setPublicProfileCache] = useState<{ [uid: string]: string }>({});
  const [useSandboxStripe, setUseSandboxStripe] = useState(() => localStorage.getItem('useSandboxStripe') === 'true');
  const [activeTab, setActiveTab] = useState<'map' | 'friends' | 'notifications' | 'profile'>('map');
  const [tempCalibration, setTempCalibration] = useState<GPSBounds>({ north: 0, south: 0, east: 0, west: 0 });
  const [pickingLocationFor, setPickingLocationFor] = useState<'NW' | 'SE' | null>(null);
  const [showSplash, setShowSplash] = useState(true);
  const [gpsRefreshButtonText, setGpsRefreshButtonText] = useState<string | null>(null);
  const [gpsRefreshInterval, setGpsRefreshInterval] = useState(5); // Default 5 seconds
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsTimeoutCount, setGpsTimeoutCount] = useState(0);
  void gpsTimeoutCount; // Used via functional state update in GPS error handler
  const [showShareLink, setShowShareLink] = useState(false);
  const [gpsHasLocation, setGpsHasLocation] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem('useSandboxStripe', useSandboxStripe.toString());
  }, [useSandboxStripe]);

  // Fetch GPS refresh interval from Firestore config
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "config", "gps"), (doc) => {
      if (doc.exists() && doc.data().refreshInterval) {
        setGpsRefreshInterval(doc.data().refreshInterval);
      }
    });
    return () => unsub();
  }, []);

  const [selectedAreaForVote, setSelectedAreaForVote] = useState<Area | null>(null);
  const [activeVote, setActiveVote] = useState<Vote | null>(null);
  const [tempDisableGhostBtn, setTempDisableGhostBtn] = useState(false);
  const [alertIsUpgrade, setAlertIsUpgrade] = useState(false);
  const [mapCalibration, setMapCalibration] = useState<GPSBounds | null>(null);

  useEffect(() => {
    // Fetch Map Calibration
    const unsub = onSnapshot(doc(db, "config", "map"), (doc) => {
      if (doc.exists()) {
        setMapCalibration(doc.data() as GPSBounds);
      }
    });
    return () => unsub();
  }, []);

  // GPS Tracking Logic
  useEffect(() => {
    if (!userData?.uid) return;
    if (userData?.useGps === false) { console.log("GPS: Disabled by user settings"); return; }
    if (!mapCalibration) { console.log("GPS: Waiting for Map Calibration"); return; }
    if (!navigator.geolocation) { console.log("GPS: Not supported"); return; }
    if (areas.length === 0) { console.log("GPS: Waiting for areas to load"); return; }

    console.log(`GPS: Starting live location tracking (every ${gpsRefreshInterval} seconds)`);
    setGpsHasLocation(false); // Reset when starting GPS tracking

    const updateGpsLocation = async () => {
      // Double-check areas are still loaded
      if (areas.length === 0) {
        console.log("GPS: Areas not loaded, skipping update");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude, longitude } = pos.coords;
          const { north, south, east, west } = mapCalibration;

          // Map (Lat, Lon) to (x, y) 0-1 range
          let x = (longitude - west) / (east - west);
          let y = (north - latitude) / (north - south);

          const newPoint = { x, y };

          // Check if we are in Ghost Mode
          if (userData?.ghostMode && userData.ghostModeExpiry && userData.ghostModeExpiry > Date.now()) {
            console.log("GPS: Ghost Mode Active, skipping update");
            return;
          }

          // Determine which area the user is in
          let foundArea: Area | null = null;
          console.log(`GPS: Checking ${areas.length} areas for point (${x.toFixed(4)}, ${y.toFixed(4)})`);
          console.log(`GPS: Point coordinates:`, newPoint);
          for (const area of areas) {
            console.log(`GPS: Checking area "${area.name}" with ${area.polygon.length} polygon points:`, area.polygon);
            const isInside = isPointInPolygon(newPoint, area.polygon, true); // Enable debug
            console.log(`GPS: Area "${area.name}" - ${isInside ? 'INSIDE ✓' : 'outside ✗'}`);
            if (isInside) {
              foundArea = area;
              break;
            }
          }

          const areaName = foundArea ? foundArea.name : 'The Wilds';

          console.log("GPS: Update", { latitude, longitude, x, y, area: areaName, foundArea: !!foundArea });

          try {
            const updateData: any = {
              location: newPoint,
              lastUpdate: Date.now(),
              currentArea: areaName
            };

            // Update lastKnownArea if not in The Wilds
            if (areaName !== 'The Wilds') {
              updateData.lastKnownArea = areaName;
            }

            console.log("GPS: Updating Firestore with:", updateData);
            await updateDoc(getUserDocRef(userData.uid), updateData);
            console.log("GPS: Firestore update successful");
            setGpsTimeoutCount(0); // Reset timeout counter on success
            setGpsHasLocation(true); // Mark that we have a GPS location
          } catch (e) { console.error("Error updating GPS location", e); }
        },
        async (err) => {
          console.error("GPS Error:", err);

          // Check for timeout errors (code 3)
          if (err.code === 3) {
            setGpsTimeoutCount(prevCount => {
              const newCount = prevCount + 1;
              console.log(`GPS: Timeout error ${newCount}/3`);

              if (newCount >= 3) {
                console.log("GPS: 3 consecutive timeouts, auto-disabling GPS");
                setGpsError("Live location was disabled due to repeated GPS timeouts");
                setGpsRefreshButtonText('GPS failed to connect');
                setTimeout(() => setGpsRefreshButtonText(null), 2000);
                handleGpsToggle(false).catch(e => console.error("Failed to disable GPS:", e));
                return 0; // Reset counter
              }

              return newCount;
            });
          }
          // Check for network service errors
          else if (err.message && err.message.includes("network service")) {
            console.log("GPS: Network service failed, auto-disabling GPS");
            setGpsError("Live location was disabled as app failed to grab GPS");
            setGpsRefreshButtonText('GPS failed to connect');
            setTimeout(() => setGpsRefreshButtonText(null), 2000);
            setGpsTimeoutCount(0); // Reset counter
            try {
              await handleGpsToggle(false);
            } catch (e) {
              console.error("Failed to disable GPS:", e);
            }
          }
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
      );
    };

    // Update immediately on mount
    updateGpsLocation();

    // Then update every X seconds based on setting
    const intervalId = setInterval(updateGpsLocation, gpsRefreshInterval * 1000);

    return () => clearInterval(intervalId);
  }, [userData?.useGps, mapCalibration, userData?.uid, userData?.ghostMode, areas, gpsRefreshInterval]);

  // ... (skip lines) ...

  // --- Main Component ---
  // --- Refs ---
  const mapImageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentPolygonPoints = useRef<Point[]>([]);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressRef = useRef(false);
  const pointerDownTimeRef = useRef(0);
  const pointerEventsRef = useRef<{ x: number, y: number } | null>(null);

  // Voting Widget (Appears on top of content if there is an active vote)


  // --- Utility & Helper Functions ---
  const showAlert = (message: string, showShareButton = false) => {
    setAlertMessage(message);
    setShowShareLink(showShareButton);
    setActiveModal('alert');
  };

  const showConfirm = (message: string, onConfirm: () => void) => {
    setConfirmAction({ message, onConfirm });
    setActiveModal('confirm');
  };

  const copyInviteLink = async () => {
    if (!currentUser?.uid) return;
    const inviteLink = `${window.location.origin}?invite=${currentUser.uid}`;
    try {
      await navigator.clipboard.writeText(inviteLink);
      showAlert("Invite link copied to clipboard!");
    } catch (err) {
      console.error("Failed to copy:", err);
      showAlert("Failed to copy link");
    }
  };

  const getPublicProfileCollection = () => collection(db, 'public/user_profiles/users');
  const getUserDocRef = (uid: string) => doc(db, 'users', uid);

  const isPointInPolygon = (point: Point, polygon: Point[], debug = false): boolean => {
    if (!polygon) return false;
    let isInside = false;
    if (debug) console.log(`Testing point (${point.x.toFixed(4)}, ${point.y.toFixed(4)}) against ${polygon.length} edges`);
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      const intersect = ((yi > point.y) !== (yj > point.y)) && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
      if (debug) {
        console.log(`Edge ${j}->${i}: (${xj.toFixed(4)},${yj.toFixed(4)}) to (${xi.toFixed(4)},${yi.toFixed(4)}) - intersect: ${intersect}`);
      }
      if (intersect) isInside = !isInside;
    }
    if (debug) console.log(`Final result: ${isInside ? 'INSIDE' : 'OUTSIDE'}`);
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
    showConfirm(`Are you sure you want to delete "${areaName}" ? `, async () => {
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
    const myTier = hasActiveSubscription(userData) ? (userData.tier || 'free') : 'free';
    if (myTier === 'free') {
      showAlert("Free tier users cannot invite friends to a squad. Please upgrade to create a squad.");
      return;
    }

    // Check Squad Size Limit
    const squadMembers = [userData, ...friendsData].filter(u => u.squadId === userData.squadId);
    if (squadMembers.length >= (TIER_LIMITS[myTier] + 1)) { // +1 for self
      setActiveModal('limitReached');
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
    try {
      if (!currentUser) return;
      await updateDoc(getUserDocRef(currentUser.uid), { useGps });
    } catch (e) {
      console.error(e);
      showAlert("Error updating GPS setting.");
    }
  };

  const startVote = async (area: Area) => {
    if (!userData || !userData.squadId) return;
    const newVote: Vote = {
      id: Date.now().toString(),
      creatorId: userData.uid,
      creatorName: userData.displayName || 'Unknown',
      targetAreaId: area.id,
      targetAreaName: area.name,
      createdAt: Date.now(),
      votes: { [userData.uid]: 'yes' }, // Creator votes yes automatically? Or wait. 'Vote we go to...' implies intent.
    };
    try {
      await updateDoc(doc(db, "squads", userData.squadId), { activeVote: newVote });
      setSelectedAreaForVote(null); // Reset selection
    } catch (e) {
      console.error(e);
      showAlert("Failed to start vote.");
    }
  };

  const castVote = async (voteVal: 'yes' | 'no') => {
    if (!userData?.squadId || !activeVote) return;
    try {
      const updatedVotes = { ...activeVote.votes, [userData.uid]: voteVal };
      const squadRef = doc(db, "squads", userData.squadId);

      // Check if everyone has voted OR majority reached
      const squadMembers = (squadData?.members) || [userData.uid, ...(friendsData.filter(f => f.squadId === userData.squadId).map(f => f.uid))];
      const squadSize = squadMembers.length;

      const yesVotes = Object.values(updatedVotes).filter(v => v === 'yes').length;
      const noVotes = Object.values(updatedVotes).filter(v => v === 'no').length;
      const allVoted = squadMembers.every((uid: string) => updatedVotes[uid] !== undefined);
      const majorityReached = yesVotes > squadSize / 2 || noVotes > squadSize / 2;

      let updateData: any = { [`activeVote.votes.${userData.uid} `]: voteVal };

      if ((allVoted || majorityReached) && !activeVote.completedAt) {
        updateData[`activeVote.completedAt`] = Date.now();
      }

      await updateDoc(squadRef, updateData);
    } catch (e) { console.error(e); }
  };

  const endVote = async () => {
    if (!userData?.squadId) return;
    try {
      await updateDoc(doc(db, "squads", userData.squadId), { activeVote: null });
    } catch (e) { console.error(e); }
  };


  // Voting Widget (Appears on top of content if there is an active vote)
  const renderVoteWidget = () => {
    if (!activeVote || !userData) return null;

    // Check expiry
    if (activeVote.completedAt && (Date.now() - activeVote.completedAt > 30 * 60 * 1000)) return null;

    const myVote = activeVote.votes[userData.uid];
    const isOwner = activeVote.creatorId === userData.uid;
    const totalVotes = Object.keys(activeVote.votes).length;

    // Squad members count (me + friends in squad)
    const squadMembers = (squadData?.members) || [userData.uid, ...(friendsData.filter(f => f.squadId === userData.squadId).map(f => f.uid))];
    const squadSize = squadMembers.length;

    const yesCount = Object.values(activeVote.votes).filter(v => v === 'yes').length;
    const noCount = Object.values(activeVote.votes).filter(v => v === 'no').length;
    const isCompleted = activeVote.completedAt || (totalVotes >= squadSize && squadSize > 1) || (yesCount > squadSize / 2) || (noCount > squadSize / 2);

    return (
      <div className="card" style={{
        marginBottom: '1rem',
        backgroundColor: '#1f1f1f',
        border: '1px solid #444',
        boxSizing: 'border-box',
        boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
        animation: 'slideIn 0.3s ease-out',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '16px'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
          <strong style={{ color: 'var(--primary)', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Squad Vote</strong>
          <span style={{ fontSize: '1rem' }}>🗳️</span>
        </div>

        {/* Question */}
        <h3 style={{ margin: '0 0 16px 0', textAlign: 'center', fontSize: '1.3rem' }}>
          Go to <span style={{ color: 'white' }}>{activeVote.targetAreaName}</span>?
        </h3>

        {!isCompleted ? (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Buttons Row */}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              {/* Yes Button */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <button
                  onClick={() => castVote('yes')}
                  className="btn"
                  style={{
                    width: '100%',
                    background: myVote === 'yes' ? 'linear-gradient(45deg, var(--primary), var(--secondary))' : '#333',
                    color: myVote === 'yes' ? '#000' : 'white',
                    opacity: myVote && myVote !== 'yes' ? 0.3 : 1,
                    border: 'none',
                    fontSize: '1rem',
                    padding: '12px'
                  }}
                >Lets Go</button>
                <div style={{ fontSize: '0.8rem', textAlign: 'center', color: 'var(--primary)' }}>{yesCount} votes</div>
              </div>

              {/* No Button */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <button
                  onClick={() => castVote('no')}
                  className="btn"
                  style={{
                    width: '100%',
                    background: myVote === 'no' ? 'var(--error)' : '#333',
                    opacity: myVote && myVote !== 'no' ? 0.3 : 1,
                    border: '1px solid var(--error)',
                    fontSize: '1rem',
                    padding: '12px'
                  }}
                >F*** That</button>
                <div style={{ fontSize: '0.8rem', textAlign: 'center', color: 'var(--error)' }}>{noCount} votes</div>
              </div>
            </div>

            {/* Cancel Button (Owner Only) */}
            {isOwner && (
              <button
                onClick={endVote}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#666',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  marginTop: '8px',
                  textDecoration: 'underline'
                }}
              >
                Cancel Vote
              </button>
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center', width: '100%' }}>
            <div style={{ fontSize: '1.2rem', marginBottom: '12px', fontWeight: 'bold', color: 'white' }}>
              Vote Completed!
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '30px', marginBottom: '16px' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--primary)' }}>{yesCount}</div>
                <div style={{ fontSize: '0.8rem', color: '#aaa' }}>Lets Go</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--error)' }}>{noCount}</div>
                <div style={{ fontSize: '0.8rem', color: '#aaa' }}>No</div>
              </div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '8px' }}>
              {yesCount > noCount
                ? <div style={{ color: 'var(--primary)', fontWeight: 'bold', fontSize: '1.1rem' }}>We are going! 🏃‍♂️</div>
                : <div style={{ color: 'var(--error)', fontWeight: 'bold', fontSize: '1.1rem' }}>Screw that! 🙅‍♂️</div>}
            </div>

            {isOwner && (
              <button
                onClick={endVote}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#666',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  marginTop: '12px'
                }}
              >
                Close Widget
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isDevMode) return;
    isLongPressRef.current = false;
    pointerDownTimeRef.current = Date.now();
    pointerEventsRef.current = { x: e.clientX, y: e.clientY };

    // Start 1s timer
    longPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      // Trigger vote mode
      const rect = canvasRef.current!.getBoundingClientRect();
      const x = (pointerEventsRef.current!.x - rect.left) / rect.width;
      const y = (pointerEventsRef.current!.y - rect.top) / rect.height;

      const clickedArea = areas.find(area => isPointInPolygon({ x, y }, area.polygon));
      if (clickedArea) {
        setSelectedAreaForVote(clickedArea);
        setSelectedAreaForCheckIn(null); // Clear check-in if long press
        // Vibrate if mobile?
        if (navigator.vibrate) navigator.vibrate(200);
      }
    }, 800); // 0.8 seconds requested
    // "hold a place on the map for 0.8 seconds"
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (isDevMode) return;

    // If it wasn't a long press, treat as click check-in
    if (!isLongPressRef.current) {
      // handle click
      handleCanvasClick(e as any);
      // Also reset vote selection on normal click?
      setSelectedAreaForVote(null);
    }
  };

  const handlePointerLeave = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // If moved significantly, cancel long press
    if (longPressTimerRef.current && pointerEventsRef.current) {
      const dx = Math.abs(e.clientX - pointerEventsRef.current.x);
      const dy = Math.abs(e.clientY - pointerEventsRef.current.y);
      if (dx > 10 || dy > 10) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
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
      ...outgoingSquadInvites.map(inv => inv.to),
      ...incomingFriendRequests.map(req => req.from),
      ...outgoingFriendRequests.map(req => req.to)
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
  }, [incomingSquadInvites, outgoingSquadInvites, incomingFriendRequests, outgoingFriendRequests, friendsData, userData, publicProfileCache]);

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
      `Are you sure you want to kick '${member.displayName}' from the squad ? `,
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
      // Leave old squad if in one
      if (userData?.squadId) {
        await updateDoc(doc(db, "squads", userData.squadId), {
          members: arrayRemove(currentUser!.uid)
        });
      }

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

  const handleUpgrade = async (planId: Tier, forceOverride = false) => {
    // If Admin Dev Mode for Cycling is on, just switch instantly without payment simulation logic (conceptually)
    // Here we just use the same logic but the user perception of "payment" is bypassed by intent.
    // In a real app, successful payment callback would trigger this.

    if (!currentUser) return;
    try {
      if ((useSandboxStripe || forceOverride) && userData?.isDev) {
        // Just set it directly
        if (planId === 'free') {
          // Reset Logic: Remove everyone from squad, cancel invites
          if (userData?.squadId) {
            const squadRef = doc(db, "squads", userData.squadId);
            const snap = await getDoc(squadRef);
            if (snap.exists()) {
              const members = snap.data().members || [];
              // Reset all members
              for (const memberUid of members) {
                await updateDoc(getUserDocRef(memberUid), { squadId: null, squadOwnerId: null });
              }
              // Delete squad
              await deleteDoc(squadRef);
            }

            // Delete invites
            const invitesQ = query(collection(db, "squadInvites"), where("from", "==", currentUser.uid));
            const invSnap = await getDocs(invitesQ);
            invSnap.forEach(async (d) => {
              await deleteDoc(d.ref);
            });
          }
          await updateDoc(getUserDocRef(currentUser.uid), {
            tier: 'free',
            subscriptionExpiry: null,
            squadId: null, // Ensure self is reset
            squadOwnerId: null
          });
          setFriendsData(prev => prev.map(f => f.squadId === userData?.squadId ? { ...f, squadId: undefined } : f));
        } else {
          await updateDoc(getUserDocRef(currentUser.uid), {
            tier: planId,
            subscriptionExpiry: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days
          });
        }
        setActiveModal(null);
        showAlert(`Plan updated to ${planId.toUpperCase()}!`);
      } else {
        // STRIPE CHECKOUT FLOW
        try {
          const res = await fetch('/api/create-checkout-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tierId: planId,
              userId: currentUser.uid,
              sandboxMode: useSandboxStripe,
              successUrl: window.location.origin, // Return to home on success
              cancelUrl: window.location.origin,
            })
          });

          const data = await res.json();
          if (data.url) {
            window.location.href = data.url; // Redirect to Stripe
          } else {
            console.error("No URL returned from checkout session creation", data);
            showAlert("Failed to initialize checkout.");
          }
        } catch (err) {
          console.error(err);
          showAlert("Connection error initiating checkout.");
        }
      }
    } catch (e) {
      console.error(e);
      showAlert("Upgrade failed.");
    }
  };

  /**
   * Helper to check if user has an active paid subscription
   */
  const hasActiveSubscription = (user: UserData | null): boolean => {
    if (!user || !user.subscriptionExpiry) return false;
    return user.subscriptionExpiry > Date.now();
  };

  // Track previous invites count to notify on new ones
  const prevFriendReqCount = useRef(0);
  const prevSquadInvCount = useRef(0);
  const initialLoadDone = useRef(false);

  useEffect(() => {
    if (!initialLoadDone.current) {
      prevFriendReqCount.current = incomingFriendRequests.length;
      prevSquadInvCount.current = incomingSquadInvites.length;
      initialLoadDone.current = true;
      return;
    }

    if (incomingFriendRequests.length > prevFriendReqCount.current) {
      setAlertMessage("New Friend Request received! 👥");
      setActiveModal('alert');
    }
    prevFriendReqCount.current = incomingFriendRequests.length;

    // Squad Invites - Update count but do NOT show modal, we show widget instead
    prevSquadInvCount.current = incomingSquadInvites.length;
  }, [incomingFriendRequests, incomingSquadInvites]);

  // --- Subscriptions ---
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);
        const userRef = getUserDocRef(user.uid);
        const publicProfileRef = doc(getPublicProfileCollection(), user.uid);
        const userDoc = await getDoc(userRef);

        const envEmail = import.meta.env.VITE_ZAKS_PERSONAL_EMAIL_ADDRESS?.toLowerCase();
        const isDev = user.email?.toLowerCase() === 'z4kbrindle@gmail.com' || (envEmail && user.email?.toLowerCase() === envEmail);
        console.log("User logged in:", user.email, "Is Dev:", isDev);

        if (!userDoc.exists()) {
          const profileData = {
            uid: user.uid,
            displayName: user.displayName,
            email: user.email?.toLowerCase(),
            photoURL: user.photoURL,
            tier: 'free',
            isDev
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
          if (isDev) {
            await updateDoc(userRef, { isDev: true });
          }
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

    // Immediately remove any friends from state that are no longer in the list
    setFriendsData(prev => prev.filter(f => friendIds.includes(f.uid)));

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

  // --- Auto-remove Desynced Friends ---
  useEffect(() => {
    if (!selectedMember || !userData || !currentUser) return;

    // Only apply if we are viewing them as a "Friend" (or checking if they are in our friend list)
    const isMyFriend = userData.friends?.includes(selectedMember.uid);
    if (!isMyFriend) return;

    // Check Reciprocity
    // Note: selectedMember.friends might be undefined if we can't read it, but usually we can read public/user profiles if friends.
    // If we can't read it, we shouldn't delete immediately? 
    // Wait, if we can read 'selectedMember' (it comes from friendsData usually), we have their doc.
    const isReciprocal = selectedMember.friends?.includes(userData.uid);

    if (isReciprocal === false) { // Explicitly false check to be sure we read the array and it was missing ID
      console.log(`Auto-removing desynced friend: ${selectedMember.displayName}`);
      updateDoc(getUserDocRef(currentUser.uid), { friends: arrayRemove(selectedMember.uid) })
        .then(() => {
          setSelectedMember(null);
          showAlert(`Connection with ${selectedMember.displayName} was out of sync and has been reset. You can add them again.`);
        })
        .catch(console.error);
    }
  }, [selectedMember, userData, currentUser]);

  // --- Notifications ---
  useEffect(() => {
    if (!currentUser) return;

    // Request Permission & Get Token
    const requestPermission = async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          // Note: In production you often need a VAPID key: getToken(messaging, { vapidKey: 'YOUR_KEY' });
          const currentToken = await getToken(messaging, { vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY });
          if (currentToken) {
            await updateDoc(getUserDocRef(currentUser.uid), {
              fcmToken: currentToken
            });
          }
        }
      } catch (err) {
        console.log('An error occurred while retrieving token. ', err);
      }
    };
    requestPermission();

    // Foreground Message Listener
    const unsubscribe = onMessage(messaging, (payload) => {
      if (payload.notification) {
        setAlertMessage(`${payload.notification.title}: ${payload.notification.body}`);
        setActiveModal('alert');
      }
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Listen to Squad Data for activeVote
  useEffect(() => {
    if (!userData?.squadId) return;
    const unsubSquad = onSnapshot(doc(db, "squads", userData.squadId), (docSnap) => {
      if (docSnap.exists()) {
        setSquadData(docSnap.data());
        const data = docSnap.data();
        if (data.activeVote) {
          // Check expiry
          if (data.activeVote.completedAt && (Date.now() - data.activeVote.completedAt > 30 * 60 * 1000)) {
            // Expired locally, maybe clean up later or just hide
          }
          setActiveVote(data.activeVote);
        } else {
          setActiveVote(null);
        }
      }
    });
    return () => unsubSquad();
  }, [userData?.squadId]);




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

    const qFreqIn = query(collection(db, "friendRequests"), where("to", "==", currentUser.uid), where("status", "==", "pending"));
    const unsubFreqIn = onSnapshot(qFreqIn, (snapshot) => {
      setIncomingFriendRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const qFreqOut = query(collection(db, "friendRequests"), where("from", "==", currentUser.uid), where("status", "==", "pending"));
    const unsubFreqOut = onSnapshot(qFreqOut, (snapshot) => {
      setOutgoingFriendRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => { unsubIn(); unsubOut(); unsubFreqIn(); unsubFreqOut(); };
  }, [currentUser?.uid]);

  const handleSendFriendRequest = async (friendUid: string) => {
    if (!currentUser) return;
    try {
      // Check if already friends
      if (userData?.friends?.includes(friendUid)) {
        showAlert("You are already friends!");
        return;
      }
      await addDoc(collection(db, "friendRequests"), {
        from: currentUser.uid,
        to: friendUid,
        status: 'pending',
        createdAt: Date.now()
      });
      showAlert("Friend request sent!");
      setFriendEmail('');
    } catch (e) {
      console.error(e);
      showAlert("Failed to send friend request.");
    }
  };

  const handleAcceptFriendRequest = async (request: DocumentData) => {
    if (!currentUser) return;
    try {
      await updateDoc(getUserDocRef(currentUser.uid), { friends: arrayUnion(request.from) });
      // Note context: We need to update the other user's friend list too, but Firestore security rules might prevent this 
      // unless we have specific rules allowing "mutual add" if request exists.
      // For now, assuming the rules I requested allow it OR we just do it one-way 
      // Update: The rules I tried to apply earlier (and failed) had the mutual add logic. 
      // Since I couldn't apply them, this might fail for the OTHER user if rules are strict.
      // Let's at least update our own and delete request.
      // Ideally: Cloud function or less strict rules.
      // I will attempt to update the other user too, hoping current rules allow it or user applied rules.

      await updateDoc(getUserDocRef(request.from), { friends: arrayUnion(currentUser.uid) });

      await deleteDoc(doc(db, "friendRequests", request.id));
      showAlert("Friend Request Accepted!");
    } catch (e) {
      console.error(e);
      showAlert("Error accepting friend request. (Permissions?)");
    }
  };

  const handleDeclineFriendRequest = async (request: DocumentData) => {
    try {
      await deleteDoc(doc(db, "friendRequests", request.id));
    } catch (e) { console.error(e); }
  };

  // --- Render ---
  if (!currentUser) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <img src="/logo-main.png" alt="Herd Search" style={{ width: '150px', height: 'auto', marginBottom: '1rem', borderRadius: '20px' }} />
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
            <Link to="/about" className="logo" style={{ textDecoration: 'none', color: 'inherit' }}>Herd Search</Link>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {!userData?.useGps && (
                <button
                  onClick={async () => {
                    await handleGpsToggle(true);
                  }}
                  style={{
                    background: 'linear-gradient(45deg, var(--primary), var(--secondary))',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '8px 16px',
                    color: 'black',
                    fontWeight: 'bold',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 2px 8px rgba(3, 218, 198, 0.3)'
                  }}
                >
                  📍 Turn on GPS
                </button>
              )}
              <div className="user-controls" onClick={() => setActiveTab('profile')} style={{ cursor: 'pointer' }}>
                {userData?.photoURL && <img className="avatar" src={userData.photoURL} alt="Profile" />}
              </div>
            </div>
          </header>

          {isDevMode && (
            <div className="dev-panel">
              <h3>Developer Mode</h3>
              <p>Click on the map to draw areas.</p>
              <button onClick={cancelDrawing} className="btn btn-danger" style={{ padding: '0.25rem 0.5rem' }}>Cancel</button>
            </div>
          )}

          {/* SQUAD INVITE NOTIFICATION WIDGET */}
          {incomingSquadInvites.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '60px', /* Below Header */
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 999,
              width: '90%',
              maxWidth: '400px',
              backgroundColor: 'rgba(30,30,30,0.95)',
              border: '1px solid var(--primary)',
              borderRadius: '12px',
              padding: '12px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              animation: 'slideDown 0.3s ease-out'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 'bold', color: 'var(--primary)', fontSize: '0.9rem' }}>Squad Invite</span>
                <span style={{ fontSize: '0.8rem', color: '#aaa' }}>{incomingSquadInvites.length > 1 ? `+${incomingSquadInvites.length - 1} more` : ''}</span>
              </div>

              {/* Show the first invite */}
              {(() => {
                const invite = incomingSquadInvites[0];
                const senderName = getDisplayNameByUid(invite.from);
                return (
                  <div>
                    <p style={{ margin: '0 0 8px 0', fontSize: '0.9rem' }}>
                      <strong>{senderName}</strong> invited you to join their squad.
                    </p>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => handleAcceptSquadInvite(invite)}
                        className="btn btn-primary"
                        style={{
                          flex: 1,
                          padding: '6px',
                          fontSize: '0.9rem',
                          background: 'linear-gradient(45deg, var(--primary), var(--secondary))'
                        }}>
                        Accept
                      </button>
                      <button
                        onClick={() => handleDeclineSquadInvite(invite)}
                        className="btn"
                        style={{
                          flex: 1,
                          padding: '6px',
                          fontSize: '0.9rem',
                          background: 'transparent',
                          border: '1px solid var(--error)',
                          color: 'var(--error)'
                        }}>
                        Decline
                      </button>
                    </div>
                  </div>
                )
              })()}
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
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerMove={handlePointerMove}
              onPointerLeave={handlePointerLeave}
              // onClick={handleCanvasClick} // Removed in favor of Pointer events
              style={{ cursor: isDevMode ? 'crosshair' : (userData?.useGps === false ? 'pointer' : 'default') }}
            />

            {userData?.location && !(userData.ghostMode && userData.ghostModeExpiry && userData.ghostModeExpiry > Date.now()) && (
              <div className="user-marker" style={{
                left: `${Math.max(0, Math.min(100, userData.location.x * 100))}%`,
                top: `${Math.max(0, Math.min(100, userData.location.y * 100))}%`
              }}>
                <img src={userData.photoURL || "/default-avatar.png"} className="marker-avatar" alt="Me" />
                <div className="marker-label">You</div>
              </div>
            )}

            {friendsData
              .filter(f => !!f.location && f.squadId === userData?.squadId && !(f.ghostMode && f.ghostModeExpiry && f.ghostModeExpiry > Date.now()))
              .map(u => (
                <div key={u.uid} className="user-marker" style={{
                  left: `${Math.max(0, Math.min(100, u.location!.x * 100))}%`,
                  top: `${Math.max(0, Math.min(100, u.location!.y * 100))}%`
                }}>
                  <img src={u.photoURL || "/default-avatar.png"} className="marker-avatar" alt={u.displayName} />
                  {u.ghostMode && u.ghostModeExpiry && u.ghostModeExpiry > Date.now() && (
                    <div style={{ position: 'absolute', top: '-10px', right: '-10px', fontSize: '20px' }}>👻</div>
                  )}
                  <div className="marker-label">{u.displayName?.split(' ')[0]}</div>
                </div>
              ))}
          </div>

          {/* Check In / Vote Button */}
          <div style={{ padding: '0 4px', marginBottom: '1rem' }}>
            {selectedAreaForVote ? (
              <button
                onClick={() => startVote(selectedAreaForVote)}
                className="btn w-full"
                style={{
                  background: 'linear-gradient(45deg, #ff0080, #7928ca)', // Different color for vote
                  padding: '16px',
                  fontSize: '1.2rem',
                  fontWeight: 'bold',
                  borderRadius: '12px',
                  boxShadow: '0 4px 15px rgba(255, 0, 128, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '12px',
                  color: 'white'
                }}
              >
                <FaUserFriends size={22} />
                Vote we go to {selectedAreaForVote.name}
              </button>
            ) : (
              <button
                onClick={() => {
                  if (userData?.useGps) {
                    if (!mapCalibration) return showAlert("Map not calibrated yet.");
                    if (!navigator.geolocation) return showAlert("GPS not supported.");

                    setGpsRefreshButtonText('Searching for GPS...');

                    navigator.geolocation.getCurrentPosition(async (pos) => {
                      const { latitude, longitude } = pos.coords;
                      const { north, south, east, west } = mapCalibration;
                      let x = (longitude - west) / (east - west);
                      let y = (north - latitude) / (north - south);
                      const isInside = x >= 0 && x <= 1 && y >= 0 && y <= 1;

                      console.log("--- GPS Refresh Debug ---");
                      console.log(`Current Location: Lat ${latitude}, Lon ${longitude}`);
                      console.log(`Map Bounds: N ${north}, S ${south}, E ${east}, W ${west}`);
                      console.log(`Map Coords: x ${x.toFixed(4)}, y ${y.toFixed(4)}`);
                      console.log(`Within Map Area: ${isInside}`);
                      console.log("-------------------------");

                      const newPoint = { x, y };

                      // Determine which area the user is in
                      let foundArea: Area | null = null;
                      for (const area of areas) {
                        if (isPointInPolygon(newPoint, area.polygon)) {
                          foundArea = area;
                          break;
                        }
                      }

                      const areaName = foundArea ? foundArea.name : 'The Wilds';
                      console.log(`Detected area: ${areaName}`);

                      try {
                        const updateData: any = {
                          location: newPoint,
                          lastUpdate: Date.now(),
                          currentArea: areaName
                        };

                        // Update lastKnownArea if not in The Wilds
                        if (areaName !== 'The Wilds') {
                          updateData.lastKnownArea = areaName;
                        }

                        await updateDoc(getUserDocRef(userData!.uid), updateData);
                        setGpsRefreshButtonText('GPS Location Updated');
                        setTimeout(() => setGpsRefreshButtonText(null), 1200);
                      } catch (e) {
                        console.error(e);
                        setGpsRefreshButtonText('Failed to update');
                        setTimeout(() => setGpsRefreshButtonText(null), 1200);
                      }
                    }, (err) => {
                      showAlert("GPS Error: " + err.message);
                      setGpsRefreshButtonText(null);
                    }, { enableHighAccuracy: true });
                  } else {
                    selectedAreaForCheckIn ? handleManualCheckIn(selectedAreaForCheckIn) : setActiveModal('checkIn');
                  }
                }}
                className="btn btn-primary w-full"
                style={{
                  background: 'linear-gradient(45deg, var(--primary), var(--secondary))',
                  padding: '16px',
                  fontSize: '1.2rem',
                  fontWeight: 'bold',
                  borderRadius: '12px',
                  boxShadow: '0 4px 15px rgba(3, 218, 198, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '12px'
                }}
              >
                <FaMapMarkerAlt size={22} />
                {gpsRefreshButtonText || (userData?.useGps
                  ? (gpsHasLocation ? "Using Live GPS" : "Searching for GPS...")
                  : (selectedAreaForCheckIn ? `Check in to ${selectedAreaForCheckIn.name} ` : `Check In`))}
              </button>
            )}
          </div>

          {renderVoteWidget()}

          <h2 className="section-title">My Squad</h2>
          <div className="squad-list horizontal" style={{ display: 'flex', overflowX: 'auto', gap: '8px', paddingBottom: '8px' }}>
            {userData?.squadId && (() => {
              const squadMembers = [userData, ...friendsData].filter(u => u.squadId === userData.squadId);
              const leaderUid = getSquadLeaderUid();
              return squadMembers
                .sort((a, b) => a.uid === leaderUid ? -1 : b.uid === leaderUid ? 1 : 0)
                .map(member => (
                  <div key={member.uid} className={`card ${member.uid === currentUser.uid ? 'current-user' : ''} `} onClick={() => { setSelectedMember(member); setSelectedMemberContext('squad'); }} style={{ minWidth: '200px', flexDirection: 'column', alignItems: 'flex-start', position: 'relative', gap: '4px' }}>
                    {member.uid === currentUser.uid && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setActiveModal('updateStatus'); }}
                        style={{
                          position: 'absolute',
                          top: '8px',
                          right: '8px',
                          background: 'rgba(255,255,255,0.1)',
                          border: 'none',
                          color: 'var(--text-primary)',
                          borderRadius: '50%',
                          width: '24px',
                          height: '24px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          zIndex: 10
                        }}
                      >
                        <FaPencilAlt size={12} />
                      </button>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <img src={member.photoURL!} className="avatar" alt="Avatar" />
                      <div>
                        <span>{leaderUid === member.uid && '👑 '}{member.displayName}</span>
                      </div>
                    </div>
                    <p style={{ fontSize: '0.8rem', marginTop: '-4px', marginBottom: '0' }}>
                      {(member.ghostMode && member.ghostModeExpiry && member.ghostModeExpiry > Date.now()) ?
                        <span style={{ color: 'var(--text-muted)' }}>Ghost Mode 👻</span> :
                        (member.currentArea === 'The Wilds' ?
                          <>
                            Last Seen <span className="location-tag">{member.lastKnownArea || 'Unknown'}</span> <span style={{ color: '#666' }}>
                              ({(() => {
                                const diff = (Date.now() - (member.lastUpdate || 0)) / 60000;
                                if (diff < 90) return `${Math.floor(diff)}m ago`;
                                return `${Math.floor(diff / 60)}h ago`;
                              })()})
                            </span>
                          </> :
                          <>
                            Location: <span className="location-tag">{member.currentArea || 'Unknown'}</span> <span style={{ color: '#666' }}>
                              ({(() => {
                                const diff = (Date.now() - (member.lastUpdate || 0)) / 60000;
                                if (diff < 90) return `${Math.floor(diff)}m ago`;
                                return `${Math.floor(diff / 60)}h ago`;
                              })()})
                            </span>
                          </>
                        )
                      }
                    </p>
                    {member.statusMessage && (Date.now() - (member.statusTimestamp || 0) < 12 * 60 * 60 * 1000) && (
                      <p style={{ fontSize: '0.75rem', color: 'var(--primary)', marginTop: '0', fontStyle: 'italic', maxWidth: '180px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        "{member.statusMessage}"
                      </p>
                    )}
                  </div>
                ));
            })()}

            {(() => {
              const pendingInvites = outgoingSquadInvites.filter(inv => inv.from === currentUser.uid);
              return pendingInvites.map(invite => {
                const friend = friendsData.find(f => f.uid === invite.to);
                return (
                  <div key={invite.id} className="card" style={{
                    minWidth: '200px',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    position: 'relative',
                    opacity: 0.9,
                    border: '1px dashed #ffc107',
                    background: 'rgba(255, 193, 7, 0.05)',
                    padding: '12px'
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {friend?.photoURL ? (
                          <img src={friend.photoURL} className="avatar" style={{ border: '1px solid #ffc107', width: '35px', height: '35px' }} alt="Avatar" />
                        ) : (
                          <div className="avatar" style={{ background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #ffc107', color: '#ffc107' }}>?</div>
                        )}
                        <span style={{ fontWeight: 'bold' }}>{friend?.displayName || getDisplayNameByUid(invite.to)}</span>
                      </div>
                      <p style={{ fontSize: '0.75rem', margin: 0, color: '#ffc107' }}>
                        Invited...
                      </p>
                    </div>

                    <button
                      className="btn btn-danger"
                      style={{
                        padding: '0',
                        width: '40px',
                        height: '40px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(207, 102, 121, 0.2)',
                        border: '1px solid var(--error)',
                        borderRadius: '8px'
                      }}
                      onClick={(e) => { e.stopPropagation(); handleWithdrawSquadInvite(invite); }}
                      title="Withdraw Invite"
                    >
                      <FaTimes size={16} />
                    </button>
                  </div>
                );
              });
            })()}

            {/* Invite Button for Squad Leaders */}
            {getSquadLeaderUid() === userData?.uid && userData?.tier !== 'free' && (
              <div
                className="card"
                onClick={() => setActiveModal('inviteToSquad')}
                style={{
                  minWidth: '85px',
                  padding: '12px 0',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px dashed #444',
                  color: 'var(--text-muted)',
                  gap: '2px'
                }}>
                <FaUserFriends size={20} />
                <span style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Invite</span>
                <span style={{ fontSize: '0.65rem' }}>
                  {(() => {
                    const tier = hasActiveSubscription(userData) ? (userData?.tier || 'free') : 'free';
                    const limit = TIER_LIMITS[tier];
                    const currentMembers = [userData, ...friendsData].filter(u => u.squadId === userData.squadId);
                    const pendingInvites = outgoingSquadInvites.filter(inv => inv.from === currentUser.uid);
                    const usedFriendSpots = (currentMembers.length - 1) + pendingInvites.length;
                    const remaining = Math.max(0, limit - usedFriendSpots);
                    return `${remaining} left`;
                  })()}
                </span>
              </div>
            )}
          </div>






        </>
      )
    }

    if (activeTab === 'friends') {
      return (
        <>
          <header>
            <Link to="/about" className="logo" style={{ textDecoration: 'none', color: 'inherit' }}>Herd Search</Link>
            <div className="user-controls" onClick={() => setActiveTab('profile')} style={{ cursor: 'pointer' }}>
              {userData?.photoURL && <img className="avatar" src={userData.photoURL} alt="Profile" />}
            </div>
          </header>
          {(incomingFriendRequests.length > 0 || incomingSquadInvites.length > 0) && (
            <>
              <h2 className="section-title">Requests</h2>
              {/* Incoming Requests */}
              {incomingFriendRequests.map(req => (
                <div key={req.id} className="card">
                  <div>
                    <strong>{getDisplayNameByUid(req.from)}</strong> wants to be friends.
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => handleAcceptFriendRequest(req)} className="btn btn-primary" style={{ padding: '4px 8px' }}>✔</button>
                    <button onClick={() => handleDeclineFriendRequest(req)} className="btn btn-danger" style={{ padding: '4px 8px' }}>✘</button>
                  </div>
                </div>
              ))}
              {incomingSquadInvites.map(invite => (
                <div key={invite.id} className="card">
                  <div>
                    <strong>{getDisplayNameByUid(invite.from)}</strong> invited you to their squad.
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => handleAcceptSquadInvite(invite)} className="btn btn-primary" style={{ padding: '4px 8px' }}>✔</button>
                    <button onClick={() => handleDeclineSquadInvite(invite)} className="btn btn-danger" style={{ padding: '4px 8px' }}>✘</button>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Outgoing Requests */}
          {outgoingFriendRequests.length > 0 && <h3 className="section-subtitle">Sent</h3>}
          {outgoingFriendRequests.map(req => {
            const canRevoke = (Date.now() - (req.createdAt || 0)) > 30 * 60 * 1000;
            return (
              <div key={req.id} className="card" style={{ opacity: 0.7, flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                  <span>To {getDisplayNameByUid(req.to)} (Friend Request)</span>
                  {canRevoke && (
                    <button className="btn btn-danger" style={{ padding: '2px 6px', fontSize: '10px' }} onClick={() => handleDeclineFriendRequest(req)}>Revoke</button>
                  )}
                </div>
                <span style={{ fontSize: '0.8rem' }}>Pending {canRevoke ? '' : '(Can revoke in 30m)'}</span>
              </div>
            );
          })}
          {outgoingSquadInvites.map(invite => (
            <div key={invite.id} className="card" style={{ opacity: 0.7 }}>
              <span>To {getDisplayNameByUid(invite.to)} (Squad Invite)</span>
              <button className="btn btn-danger" style={{ padding: '2px 6px', fontSize: '10px' }} onClick={() => handleWithdrawSquadInvite(invite)}>Withdraw</button>
            </div>
          ))}

          {(incomingFriendRequests.length === 0 && incomingSquadInvites.length === 0 && outgoingFriendRequests.length === 0 && outgoingSquadInvites.length === 0) && (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginBottom: '1rem', fontStyle: 'italic' }}>No pending requests.</p>
          )}

          <h2 className="section-title">My Squad</h2>
          <div className="squad-list">
            {userData?.squadId && (() => {
              const squadMembers = [userData, ...friendsData].filter(u => u.squadId === userData.squadId);
              const leaderUid = getSquadLeaderUid();
              return squadMembers
                .sort((a, b) => a.uid === leaderUid ? -1 : b.uid === leaderUid ? 1 : 0)
                .map(member => (
                  <div key={member.uid} className={`card ${member.uid === currentUser.uid ? 'current-user' : ''} `} onClick={() => { setSelectedMember(member); setSelectedMemberContext('squad'); }}>
                    <img src={member.photoURL!} className="avatar" alt="Avatar" />
                    <div>
                      <h3>
                        {leaderUid === member.uid && '👑 '}
                        {member.displayName}
                      </h3>
                      <p style={{ fontSize: '0.8rem', marginTop: '0.2rem', marginBottom: '0' }}>
                        {(member.ghostMode && member.ghostModeExpiry && member.ghostModeExpiry > Date.now()) ?
                          <span style={{ color: 'var(--text-muted)' }}>Ghost Mode 👻</span> :
                          (member.currentArea === 'The Wilds' ?
                            <>
                              Last Seen <span className="location-tag">{member.lastKnownArea || 'Unknown'}</span> <span style={{ color: '#666' }}>
                                ({(() => {
                                  const diff = (Date.now() - (member.lastUpdate || 0)) / 60000;
                                  if (diff < 2) return "Right Now";
                                  if (diff < 90) return `${Math.floor(diff)}m ago`;
                                  return `${Math.floor(diff / 60)}h ago`;
                                })()})
                              </span>
                            </> :
                            <>
                              Location: <span className="location-tag">{member.currentArea || 'Unknown'}</span> <span style={{ color: '#666' }}>
                                ({(() => {
                                  const diff = (Date.now() - (member.lastUpdate || 0)) / 60000;
                                  if (diff < 2) return "Right Now";
                                  if (diff < 90) return `${Math.floor(diff)}m ago`;
                                  return `${Math.floor(diff / 60)}h ago`;
                                })()})
                              </span>
                            </>
                          )
                        }
                      </p>
                      {member.statusMessage && (Date.now() - (member.statusTimestamp || 0) < 12 * 60 * 60 * 1000) && (
                        <p style={{ fontSize: '0.8rem', color: 'var(--primary)', marginTop: '0', fontStyle: 'italic' }}>
                          "{member.statusMessage}" <span style={{ color: '#666' }}>
                            ({(() => {
                              const diff = (Date.now() - (member.statusTimestamp || 0)) / 60000;
                              if (diff < 2) return "Right Now";
                              if (diff < 90) return `${Math.floor(diff)}m ago`;
                              return `${Math.floor(diff / 60)}h ago`;
                            })()})
                          </span>
                        </p>
                      )}
                    </div>
                  </div>
                ));
            })()}



            {/* Only allow adding friends if they are the leader */}
            {getSquadLeaderUid() === userData?.uid && (
              <div className="card" onClick={() => setActiveModal('inviteToSquad')} style={{ cursor: 'pointer', justifyContent: 'center' }}>
                <h3>+ Invite Friends to Squad</h3>
              </div>
            )}

            {/* Leave Squad Button for members (not owner) */}
            {userData?.squadId && userData?.squadOwnerId !== userData?.uid && (
              <button onClick={handleLeaveSquad} className="btn btn-danger w-full mt-4" style={{ border: '1px solid var(--error)', background: 'transparent' }}>
                Leave Squad
              </button>
            )}
          </div>

          <h2 className="section-title">All Friends</h2>
          <div className="squad-list">
            {friendsData.map(friend => (
              <div key={friend.uid} className="card" onClick={() => { setSelectedMember(friend); setSelectedMemberContext('friend'); }}>
                <img src={friend.photoURL || "/default-avatar.png"} className="avatar" alt="Avatar" />
                <div>
                  <h3>{friend.displayName}</h3>
                  <p><FriendStatus friend={friend} mySquadId={userData?.squadId} /></p>
                </div>
              </div>
            ))}
            {/* Reuse the Invite Friends modal logic to add new friends via email */}
            <div className="card" onClick={() => setActiveModal('addFriend')} style={{ cursor: 'pointer', justifyContent: 'center', marginTop: '1rem', borderStyle: 'dashed' }}>
              <p>+ Add Friend by Email</p>
            </div>
          </div>
        </>
      )
    }



    if (activeTab === 'profile') {
      const tier = hasActiveSubscription(userData) ? (userData?.tier || 'free') : 'free';
      return (
        <>
          <header>
            <div className="logo">Profile</div>
            {userData?.isDev && (
              <div className="user-controls" onClick={() => setActiveModal('settings')} style={{ cursor: 'pointer' }}>
                <FaCog size={24} color="var(--text-muted)" />
              </div>
            )}
          </header>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '1rem' }}>
            {userData?.photoURL && <img className="avatar-large" src={userData.photoURL} alt="Profile" />}
            <h1 style={{ margin: '0.5rem 0' }}>{userData?.displayName}</h1>
            <p style={{ color: 'var(--text-muted)' }}>{userData?.email}</p>

            <div style={{ marginTop: '2rem', width: '100%', borderTop: '1px solid #33333310', paddingTop: '1rem' }}>
              <div className="card" style={{ flexDirection: 'column', alignItems: 'flex-start', marginBottom: '1rem', width: '100%', boxSizing: 'border-box' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '1rem',
                    width: '100%',
                    boxSizing: 'border-box'
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.2rem' }}>💎</span>
                    <strong>Current Plan</strong>
                  </div>
                  <span style={{
                    background: 'rgba(187, 134, 252, 0.1)',
                    color: 'var(--primary)',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                    fontSize: '0.8rem'
                  }}>{tier}</span>
                </div>
                <p style={{ width: '100%', boxSizing: 'border-box' }}>
                  {tier === 'free' && "You are on the Free Tier. You can join squads but cannot create your own."}
                  {tier !== 'free' && `You can invite up to ${TIER_LIMITS[tier]} friends to your squad.`}
                </p>
              </div>

              {tier !== 'festival' && (
                <>
                  <button onClick={() => setActiveModal('upgrade')} className="btn btn-primary w-full" style={{ background: 'linear-gradient(45deg, var(--primary), var(--secondary))', marginBottom: '1rem' }}>
                    Upgrade Plan ⚡
                  </button>




                </>
              )}
              <hr style={{ borderColor: '#33333310', margin: '1rem 0', width: '100%' }} />

              {/* Live Location Toggle */}
              <div
                className="card"
                onClick={async () => {
                  const newValue = !(userData?.useGps ?? true);
                  if (newValue) {
                    setGpsError(null); // Clear error when turning GPS back on
                    setGpsTimeoutCount(0); // Reset timeout counter
                    setGpsHasLocation(false); // Reset location flag
                  } else {
                    setGpsHasLocation(false); // Clear location flag when turning off
                  }
                  await handleGpsToggle(newValue);
                }}
                style={{
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '1rem',
                  marginBottom: '1rem',
                  background: (userData?.useGps ?? true) ? 'rgba(3, 218, 198, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                  border: (userData?.useGps ?? true) ? '1px solid rgba(3, 218, 198, 0.3)' : '1px solid #333',
                  borderRadius: '12px',
                  transition: 'all 0.3s ease'
                }}
              >
                <div style={{ marginRight: '1rem', fontSize: '1.5rem' }}>📍</div>
                <div style={{ flex: 1 }}>
                  <h3 style={{ margin: 0, color: (userData?.useGps ?? true) ? '#03dac6' : 'white' }}>
                    Live Location
                  </h3>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#888' }}>
                    {(userData?.useGps ?? true)
                      ? "Active: Your location updates live as you move."
                      : "Tap to enable automatic GPS tracking."}
                  </p>
                  {gpsError && !userData?.useGps && (
                    <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#ff6b6b' }}>
                      {gpsError}
                    </p>
                  )}
                </div>
                <div style={{
                  width: '20px', height: '20px', borderRadius: '50%',
                  backgroundColor: (userData?.useGps ?? true) ? '#03dac6' : '#333',
                  border: '1px solid #555'
                }} />
              </div>

              {/* Ghost Mode Toggle */}
              {(() => {
                const isGhostActive = userData?.ghostMode && userData.ghostModeExpiry && userData.ghostModeExpiry > Date.now();
                const cooldownRemaining = (userData?.ghostModeCooldown || 0) - Date.now();
                const isInCooldown = !isGhostActive && cooldownRemaining > 0;

                return (
                  <div
                    className="card"
                    style={{
                      cursor: (tempDisableGhostBtn || isInCooldown) ? 'not-allowed' : 'pointer',
                      opacity: (tempDisableGhostBtn || isInCooldown) ? 0.6 : 1,
                      backgroundColor: isGhostActive ? '#333' : '#1e1e1e',
                      border: isGhostActive ? '2px solid #03dac6' : '1px solid #333',
                      alignItems: 'center',
                      marginBottom: '1rem'
                    }}
                    onClick={async () => {
                      if (tempDisableGhostBtn) return;
                      const now = Date.now();

                      if (isInCooldown) {
                        return showAlert(`Ghost mode is cooling down. Try again in ${Math.ceil(cooldownRemaining / 60000)} minutes.`);
                      }

                      if (!isGhostActive) {
                        // Turning ON
                        setTempDisableGhostBtn(true);
                        // Delay actual activation by 5 seconds
                        setTimeout(async () => {
                          try {
                            await updateDoc(getUserDocRef(currentUser!.uid), {
                              ghostMode: true,
                              ghostModeExpiry: Date.now() + 3600000,
                              ghostModeCooldown: null
                            });
                            setTempDisableGhostBtn(false);
                          } catch (err) { console.error(err); setTempDisableGhostBtn(false); }
                        }, 5000);
                      } else {
                        // Turning OFF -> Immediate disable + Cooldown
                        setTempDisableGhostBtn(true); // Short disable preventing double tap
                        try {
                          await updateDoc(getUserDocRef(currentUser!.uid), {
                            ghostMode: false,
                            ghostModeExpiry: null,
                            ghostModeCooldown: now + 600000 // 10 mins
                          });
                          setTimeout(() => setTempDisableGhostBtn(false), 1000);
                        } catch (err) { console.error(err); setTempDisableGhostBtn(false); }
                      }
                    }}
                  >
                    <div style={{ marginRight: '1rem', fontSize: '1.5rem' }}>👻</div>
                    <div style={{ flex: 1 }}>
                      <h3 style={{ margin: 0, color: isGhostActive ? '#03dac6' : 'white' }}>
                        {tempDisableGhostBtn && !isGhostActive ? 'Turning on Ghost Mode...' : (isInCooldown ? `Cooldown (${Math.ceil(cooldownRemaining / 60000)}m)` : 'Ghost Mode')}
                      </h3>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: '#888' }}>
                        {tempDisableGhostBtn && !isGhostActive
                          ? "Activating..."
                          : (isInCooldown
                            ? "Recharging..."
                            : (isGhostActive ? "Active: You are hidden from the map." : "Tap to mask your location for 1 hour."))}
                      </p>
                    </div>
                    <div style={{
                      width: '20px', height: '20px', borderRadius: '50%',
                      backgroundColor: isGhostActive ? '#03dac6' : '#333',
                      border: '1px solid #555'
                    }} />
                  </div>
                );
              })()}
              <hr style={{ borderColor: '#33333310', margin: '1rem 0', width: '100%' }} />

              {/* Support Buttons */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem' }}>
                <button
                  onClick={() => setActiveModal('install')}
                  className="btn btn-secondary"
                  style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: '8px' }}
                >
                  <span>📱</span> Install App
                </button>

                <button
                  onClick={() => navigate('/about')}
                  className="btn btn-secondary"
                  style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: '8px' }}
                >
                  <span>ℹ️</span> About App
                </button>
              </div>

              <button
                onClick={() => setActiveModal('support')}
                className="btn btn-secondary w-full"
                style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'center', gap: '8px' }}
              >
                <span>💬</span> Contact Support
              </button>

              {/* Admin Only: View All Tickets */}
              {userData?.isDev && (
                <>
                  <button
                    onClick={() => navigate('/admin/support')}
                    className="btn btn-secondary w-full"
                    style={{ marginBottom: '1rem', border: '1px solid var(--primary)', color: 'var(--primary)' }}
                  >
                    <span>🛡️</span> Manage Support Tickets
                  </button>

                </>
              )}

            </div>



            <button onClick={() => signOut(auth)} className="btn btn-danger w-full" style={{ backgroundColor: 'transparent', border: '1px solid var(--error)' }}>Sign Out</button>
            <div style={{ margin: '0 0 1rem 0', fontSize: '0.8rem', color: '#666', textAlign: 'center' }}>
              <hr style={{ borderColor: '#33333310', margin: '1rem 0', width: '100%' }} />
              <Link to="/terms" style={{ paddingTop: '0.1rem', color: '#888', textDecoration: 'none' }}>Terms of Service</Link>
            </div>
            <div style={{ marginTop: '2rem', fontSize: '0.8rem', color: '#666' }}>
            </div>
          </div>

          {/* Support System Rendering */}
          {(activeModal === 'support') && currentUser && (
            <SupportSystem
              currentUser={{
                uid: currentUser.uid,
                email: currentUser.email || undefined,
                displayName: currentUser.displayName || undefined
              }}
              visible={true}
              onClose={() => setActiveModal(null)}
              isDev={false}
            />
          )}
        </>
      )
    }
  } // End renderContent


  return (
    <div className="app-container">
      {showSplash && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: '#121212',
          zIndex: 9999,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          animation: 'fadeOut 0.5s ease-out 2s forwards' // Fades out not just vanishes
        }}>
          <img src="/logo-flash.png" alt="Splash" style={{ width: '120px', height: 'auto', objectFit: 'contain' }} />
        </div>
      )}
      {renderContent()}

      <nav className="bottom-nav">
        <button className={`nav-item ${activeTab === 'map' ? 'active' : ''}`} onClick={() => setActiveTab('map')}>
          <FaMap />
          <span>Map</span>
        </button>
        <button className={`nav-item ${activeTab === 'friends' ? 'active' : ''}`} onClick={() => setActiveTab('friends')} style={{ position: 'relative' }}>
          <FaUserFriends />
          <span>Friends</span>
          {(incomingFriendRequests.length > 0 || incomingSquadInvites.length > 0) && (
            <div style={{
              position: 'absolute',
              top: '3px',
              left: 'calc(50% - 22px)',
              width: '8px',
              height: '8px',
              backgroundColor: 'var(--error)',
              borderRadius: '50%',
              border: '1px solid #121212'
            }} />
          )}
        </button>

        <button className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => setActiveTab('profile')}>
          <FaUser />
          <span>Profile</span>
        </button>
      </nav>

      {/* Modals */}
      {
        selectedMember && (
          <div className="modal-overlay" onClick={() => setSelectedMember(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div style={{ textAlign: 'center' }}>
                <img src={selectedMember.photoURL!} alt="Avatar" className="avatar" style={{ width: 80, height: 80, marginBottom: '1rem' }} />
                <h2>{selectedMember.displayName}</h2>
                {selectedMemberContext !== 'friend' && <p>{selectedMember.currentArea || "Unknown Location"}</p>}

                {/* Status Update for Self */}
                {selectedMember.uid === userData?.uid && (
                  <div style={{ marginTop: '1rem', width: '100%' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
                      <input
                        type="text"
                        id="statusInputSelf"
                        placeholder="What's on your mind?"
                        className="input-field"
                        style={{ flex: 1, height: '44px', boxSizing: 'border-box' }}
                        defaultValue={userData?.statusMessage || ''}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') {
                            const val = (e.target as HTMLInputElement).value;
                            try {
                              await updateDoc(getUserDocRef(currentUser!.uid), {
                                statusMessage: val,
                                statusTimestamp: Date.now()
                              });
                              showAlert("Status updated!");
                              setSelectedMember(null);
                            } catch (err) { console.error(err); showAlert("Error updating status. Check permissions."); }
                          }
                        }}
                      />
                      <button onClick={async () => {
                        const input = document.getElementById('statusInputSelf') as HTMLInputElement;
                        const val = input.value;
                        try {
                          await updateDoc(getUserDocRef(currentUser!.uid), {
                            statusMessage: val,
                            statusTimestamp: Date.now()
                          });
                          showAlert("Status updated!");
                          setSelectedMember(null);
                        } catch (err) { console.error(err); showAlert("Error updating status. Check permissions."); }
                      }} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px', height: '44px', boxSizing: 'border-box' }}>➜</button>
                    </div>
                  </div>
                )}

                {/* Case 1: Friend is in MY squad and I am leader -> Kick */}
                {getSquadLeaderUid() === userData?.uid && selectedMember.squadId === userData?.squadId && selectedMember.uid !== userData?.uid && (
                  <button onClick={() => handleKickMember(selectedMember)} className="btn btn-danger w-full mt-4">Kick from Squad</button>
                )}

                {/* Case 2: Friend is NOT in MY squad (could be no squad or other squad) and I have capacity -> Invite */}
                {selectedMember.squadId !== userData?.squadId && userData?.squadId && getSquadLeaderUid() === userData?.uid && selectedMember.uid !== userData?.uid && (
                  <button onClick={() => {
                    if (userData?.tier === 'free') {
                      setAlertMessage("Free tier users cannot invite friends to a squad. Please upgrade to create a squad.");
                      setAlertIsUpgrade(true);
                      setActiveModal('alert');
                      return;
                    }
                    setSelectedMember(null);
                    handleInviteToSquad(selectedMember.uid);
                  }} className="btn btn-primary w-full mt-4">Invite to Squad</button>
                )}



                {/* Case 3: I want to remove them from my friend list (always available if not self) - ONLY IN FRIEND CONTEXT */}
                {selectedMember.uid !== userData?.uid && selectedMemberContext === 'friend' && (
                  <button onClick={() => {
                    // Remove friend logic
                    showConfirm(`Remove ${selectedMember.displayName} from friends ? `, async () => {
                      try {
                        await updateDoc(getUserDocRef(currentUser!.uid), { friends: arrayRemove(selectedMember.uid) });
                        setSelectedMember(null);
                        showAlert("Friend removed.");
                      } catch (e) { console.error(e); }
                    });
                  }} className="btn btn-danger w-full mt-4" style={{ background: 'transparent', border: '1px solid var(--error)' }}>Remove Friend</button>
                )}

                {selectedMember.uid === userData?.uid && userData?.squadOwnerId !== userData?.uid && (
                  <button onClick={handleLeaveSquad} className="btn btn-danger w-full mt-4">Leave Squad</button>
                )}
                <button onClick={() => setSelectedMember(null)} className="btn btn-secondary w-full mt-4">Close</button>
              </div>
            </div>
          </div>
        )
      }

      {activeModal === 'settings' && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="modal-header">Settings</h3>

            {userData?.isDev && (
              <div style={{ marginBottom: '2rem' }}>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Developer</h4>

                {/* Sandbox Mode */}
                <div className="card" onClick={() => setUseSandboxStripe(!useSandboxStripe)} style={{ cursor: 'pointer', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span>Use Sandbox Stripe Mode</span>
                  <div style={{
                    width: '40px', height: '20px', background: useSandboxStripe ? 'var(--primary)' : '#555',
                    borderRadius: '10px', position: 'relative', transition: 'background 0.3s'
                  }}>
                    <div style={{
                      width: '16px', height: '16px', background: 'white', borderRadius: '50%',
                      position: 'absolute', top: '2px', left: useSandboxStripe ? '22px' : '2px',
                      transition: 'left 0.3s'
                    }} />
                  </div>
                </div>

                {/* Show Zones */}
                <div className="card" onClick={() => setShowZones(!showZones)} style={{ cursor: 'pointer', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span>Show Zones</span>
                  <div style={{ width: '40px', height: '20px', background: showZones ? 'var(--primary)' : '#555', borderRadius: '10px', position: 'relative', transition: 'background 0.3s' }}>
                    <div style={{ width: '16px', height: '16px', background: 'white', borderRadius: '50%', position: 'absolute', top: '2px', left: showZones ? '22px' : '2px', transition: 'left 0.3s' }} />
                  </div>
                </div>

                {/* GPS Refresh Interval */}
                <div className="card" style={{ flexDirection: 'column', alignItems: 'flex-start', marginBottom: '0.5rem', padding: '1rem' }}>
                  <label style={{ fontSize: '0.9rem', marginBottom: '0.5rem', display: 'block' }}>
                    GPS Refresh Interval (seconds)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={gpsRefreshInterval}
                    onChange={async (e) => {
                      const val = parseInt(e.target.value);
                      if (val >= 1 && val <= 60) {
                        setGpsRefreshInterval(val);
                        try {
                          await setDoc(doc(db, 'config', 'gps'), { refreshInterval: val });
                          console.log(`GPS refresh interval updated to ${val} seconds`);
                        } catch (err) {
                          console.error("Failed to save GPS interval:", err);
                        }
                      }
                    }}
                    className="input-field"
                    style={{ width: '100%' }}
                  />
                  <small style={{ color: 'var(--text-muted)', marginTop: '0.5rem', fontSize: '0.75rem' }}>
                    How often to update GPS location (1-60 seconds). Lower = more frequent updates.
                  </small>
                </div>

                <button onClick={() => setActiveModal('locations')} className="btn btn-secondary w-full" style={{ marginBottom: '1rem' }}>
                  Manage Locations
                </button>
                <button onClick={() => {
                  setTempCalibration(mapCalibration || { north: 0, south: 0, east: 0, west: 0 });
                  setActiveModal('calibrateGps');
                }} className="btn btn-secondary w-full" style={{ marginBottom: '1rem' }}>
                  Calibrate Map GPS
                </button>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--primary)' }}>Override Tier</label>
                  <select
                    className="input-field"
                    value={userData?.tier || 'free'}
                    onChange={(e) => handleUpgrade(e.target.value as Tier, true)}
                  >
                    <option value="free">Free</option>
                    {PLANS.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button onClick={() => setActiveModal(null)} className="btn btn-primary">Done</button>
            </div>
          </div>
        </div>
      )
      }

      {activeModal === 'calibrateGps' && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="modal-header">Calibrate Map GPS</h3>
            <p className="text-muted" style={{ fontSize: '0.8rem', marginBottom: '1rem' }}>
              Enter coordinates manually or use GPS helper buttons.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '1rem' }}>
              <div style={{ gridColumn: '1 / -1', fontWeight: 'bold' }}>Top-Left (North-West)</div>
              <div>
                <label style={{ display: 'block', fontSize: '0.7rem' }}>North (Lat)</label>
                <input type="number" step="0.000001" className="input-field" value={tempCalibration.north}
                  onChange={e => setTempCalibration({ ...tempCalibration, north: parseFloat(e.target.value) })} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.7rem' }}>West (Lon)</label>
                <input type="number" step="0.000001" className="input-field" value={tempCalibration.west}
                  onChange={e => setTempCalibration({ ...tempCalibration, west: parseFloat(e.target.value) })} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <button onClick={() => {
                  if (!navigator.geolocation) return showAlert("GPS not supported");
                  navigator.geolocation.getCurrentPosition((pos) => {
                    setTempCalibration(prev => ({ ...prev, north: pos.coords.latitude, west: pos.coords.longitude }));
                  }, (err) => showAlert("GPS Error: " + err.message));
                }} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '4px' }}>
                  Get from Device GPS
                </button>
                <button onClick={() => setPickingLocationFor('NW')} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '4px', background: 'var(--primary)', color: 'black' }}>
                  Pick on Map 📍
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '1rem' }}>
              <div style={{ gridColumn: '1 / -1', fontWeight: 'bold' }}>Bottom-Right (South-East)</div>
              <div>
                <label style={{ display: 'block', fontSize: '0.7rem' }}>South (Lat)</label>
                <input type="number" step="0.000001" className="input-field" value={tempCalibration.south}
                  onChange={e => setTempCalibration({ ...tempCalibration, south: parseFloat(e.target.value) })} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.7rem' }}>East (Lon)</label>
                <input type="number" step="0.000001" className="input-field" value={tempCalibration.east}
                  onChange={e => setTempCalibration({ ...tempCalibration, east: parseFloat(e.target.value) })} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <button onClick={() => {
                  if (!navigator.geolocation) return showAlert("GPS not supported");
                  navigator.geolocation.getCurrentPosition((pos) => {
                    setTempCalibration(prev => ({ ...prev, south: pos.coords.latitude, east: pos.coords.longitude }));
                  }, (err) => showAlert("GPS Error: " + err.message));
                }} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '4px' }}>
                  Get from Device GPS
                </button>
                <button onClick={() => setPickingLocationFor('SE')} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '4px', background: 'var(--primary)', color: 'black' }}>
                  Pick on Map 📍
                </button>
              </div>
            </div>

            <button onClick={async () => {
              try {
                await setDoc(doc(db, 'config', 'map'), tempCalibration);
                setMapCalibration(tempCalibration); // Optimistic update
                showAlert("Calibration Saved!");
                setActiveModal(null);
              } catch (e) { console.error(e); showAlert("Failed to save."); }
            }} className="btn btn-primary w-full" style={{ marginBottom: '0.5rem' }}>Save Calibration</button>

            <button onClick={() => setActiveModal(null)} className="btn btn-secondary w-full">Close</button>
          </div>
        </div>
      )}

      {pickingLocationFor && (
        <LocationPicker
          initialLat={pickingLocationFor === 'NW' ? (tempCalibration.north || 53.9) : (tempCalibration.south || 53.9)}
          initialLon={pickingLocationFor === 'NW' ? (tempCalibration.west || -2.3) : (tempCalibration.east || -2.3)}
          onCancel={() => setPickingLocationFor(null)}
          onPick={(lat, lon) => {
            if (pickingLocationFor === 'NW') {
              setTempCalibration(prev => ({ ...prev, north: lat, west: lon }));
            } else {
              setTempCalibration(prev => ({ ...prev, south: lat, east: lon }));
            }
            setPickingLocationFor(null);
          }}
        />
      )}


      {
        activeModal === 'limitReached' && (
          <div className="modal-overlay" onClick={() => setActiveModal(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <h3 className="modal-header">Squad Limit Reached 🛑</h3>
              <p className="text-center" style={{ marginBottom: '1.5rem' }}>
                You have reached the limit of your <strong>{hasActiveSubscription(userData) ? (userData?.tier || 'free') : 'free'}</strong> plan.
                <br />
                Upgrade to invite more users!
              </p>
              <div className="modal-actions">
                <button onClick={() => setActiveModal(null)} className="btn btn-secondary">Okay</button>
                <button onClick={() => setActiveModal('upgrade')} className="btn btn-primary" style={{ background: 'linear-gradient(45deg, var(--primary), var(--secondary))' }}>Upgrade Plan ⚡</button>
              </div>
            </div>
          </div>
        )
      }

      {
        activeModal === 'updateStatus' && (
          <div className="modal-overlay" onClick={() => setActiveModal(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <h3 className="modal-header">Update Status</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  id="statusInputModal"
                  placeholder="What's happening?"
                  className="input-field"
                  defaultValue={userData?.statusMessage || ''}
                  autoFocus
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter') {
                      const val = (e.target as HTMLInputElement).value;
                      try {
                        await updateDoc(getUserDocRef(currentUser!.uid), {
                          statusMessage: val,
                          statusTimestamp: Date.now()
                        });
                        setActiveModal(null);
                        showAlert("Status updated!");
                      } catch (err) { console.error(err); showAlert("Error updating status. Check permissions/keys."); }
                    }
                  }}
                  style={{ height: '44px', boxSizing: 'border-box' }}
                />
                <button onClick={async () => {
                  const input = document.getElementById('statusInputModal') as HTMLInputElement;
                  const val = input.value;
                  try {
                    await updateDoc(getUserDocRef(currentUser!.uid), {
                      statusMessage: val,
                      statusTimestamp: Date.now()
                    });
                    setActiveModal(null);
                    showAlert("Status updated!");
                  } catch (e) { console.error(e); showAlert("Error updating status. Check permissions/keys."); }
                }} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px', height: '44px', boxSizing: 'border-box' }}>➜</button>
              </div>
              <div className="modal-actions">
                <button onClick={() => setActiveModal(null)} className="btn btn-secondary">Close</button>
              </div>
            </div>
          </div>
        )
      }



      {
        activeModal === 'upgrade' && (
          <div className="modal-overlay" onClick={() => setActiveModal(null)}>
            <div className="modal-content wide" onClick={e => e.stopPropagation()}>
              <h3 className="modal-header">Upgrade Plan</h3>
              <div className="pricing-grid">
                {useSandboxStripe && (
                  <div className="pricing-card" onClick={() => handleUpgrade('free')}>
                    <h3>Free</h3>
                    <p className="price">£0.00</p>
                    <p style={{ margin: '10px 0', fontSize: '0.9rem' }}>Max 0 Friends in Squad (Solo)</p>
                    <button className="btn btn-primary w-full">Select Free</button>
                  </div>
                )}
                {PLANS.filter(p => useSandboxStripe || p.limit > TIER_LIMITS[userData?.tier || 'free']).map(plan => (
                  <div key={plan.id} className="pricing-card" onClick={() => handleUpgrade(plan.id as Tier)}>
                    <h3>{plan.name}</h3>
                    <div style={{ margin: '8px 0', fontSize: '1.5rem', color: 'var(--primary)', letterSpacing: '4px' }}>
                      {plan.id === 'basic' && '👤👤'}
                      {plan.id === 'standard' && '👤👤👤👤'}
                      {plan.id === 'premium' && '👥👥👥👥'}
                      {plan.id === 'festival' && '🎪🎪🎪'}
                      {/* Or simpler representative icons */}
                    </div>
                    <p className="price">{plan.price}</p>
                    <p style={{ margin: '10px 0', fontSize: '0.9rem' }}>Max {plan.limit} Friends in Squad</p>
                    <button className="btn btn-primary w-full">Select</button>
                  </div>
                ))}
              </div>
              <div className="modal-actions">
                <button onClick={() => setActiveModal(null)} className="btn btn-secondary">Close</button>
              </div>
            </div>
          </div>
        )
      }

      {
        activeModal === 'checkIn' && (
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
        )
      }

      {
        activeModal === 'locations' && (
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
        )
      }

      {
        activeModal === 'areaName' && (
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
        )
      }

      {
        activeModal === 'renameArea' && (
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
        )
      }

      {
        activeModal === 'inviteToSquad' && (
          <div className="modal-overlay" onClick={() => setActiveModal(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <h3 className="modal-header">Invite to Squad</h3>

              {userData?.squadId && getSquadLeaderUid() === userData?.uid && (
                <div>
                  {/* Upgrade Prompt if 0 spots - MOVED ABOVE TITLE */}
                  {(() => {
                    const tier = hasActiveSubscription(userData) ? (userData?.tier || 'free') : 'free';
                    const limit = TIER_LIMITS[tier];
                    const currentCount = [userData, ...friendsData].filter(u => u.squadId === userData?.squadId).length - 1;
                    const pendingCount = outgoingSquadInvites.filter(inv => inv.from === currentUser.uid).length;
                    const spotsLeft = Math.max(0, limit - (currentCount + pendingCount));

                    if (spotsLeft === 0) {
                      return (
                        <div style={{ textAlign: 'center', padding: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', marginBottom: '16px', border: '1px solid #333' }}>
                          <p style={{ fontSize: '1rem', margin: '0 0 12px 0', fontWeight: 'bold' }}>You have 0 spots left.</p>
                          <button onClick={() => setActiveModal('upgrade')} className="btn btn-primary w-full" style={{ background: 'linear-gradient(45deg, var(--primary), var(--secondary))' }}>Upgrade Plan ⚡</button>
                        </div>
                      )
                    } else {
                      return (
                        <p style={{ marginBottom: '1rem', fontSize: '0.9rem', color: '#ccc' }}>
                          You have <strong>{spotsLeft}</strong> spots left.
                          <br />
                          <span style={{ fontSize: '0.8rem', color: '#888' }}>(Pending invites reserve a spot)</span>
                        </p>
                      )
                    }
                  })()}

                  <h4>Invite from Friends List</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '50vh', overflowY: 'auto' }}>
                    {friendsData.filter(f => f.squadId !== userData.squadId).length === 0 && <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>No available friends to invite.</p>}

                    {friendsData
                      .filter(f => f.squadId !== userData.squadId) // Only show friends NOT in my squad
                      .sort((a, b) => {
                        const aInvited = outgoingSquadInvites.some(inv => inv.to === a.uid);
                        const bInvited = outgoingSquadInvites.some(inv => inv.to === b.uid);
                        if (aInvited && !bInvited) return -1;
                        if (!aInvited && bInvited) return 1;
                        return 0;
                      })
                      .map(friend => {
                        const isInvited = outgoingSquadInvites.some(inv => inv.to === friend.uid);
                        // Recalculate spots for disable logic
                        const tier = hasActiveSubscription(userData) ? (userData?.tier || 'free') : 'free';
                        const limit = TIER_LIMITS[tier];
                        const currentCount = [userData, ...friendsData].filter(u => u.squadId === userData?.squadId).length - 1;
                        const pendingCount = outgoingSquadInvites.filter(inv => inv.from === currentUser.uid).length;
                        const spotsLeft = Math.max(0, limit - (currentCount + pendingCount));

                        // Find the invite object if isInvited
                        const inviteObj = outgoingSquadInvites.find(inv => inv.to === friend.uid && inv.from === currentUser.uid);

                        return (
                          <div key={friend.uid} className="card" style={{ justifyContent: 'space-between', padding: '0.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <img src={friend.photoURL || "/default-avatar.png"} className="avatar" style={{ width: 30, height: 30 }} alt="Avatar" />
                              <span>{friend.displayName}</span>
                            </div>
                            {isInvited ? (
                              <button
                                onClick={() => inviteObj && handleWithdrawSquadInvite(inviteObj)}
                                className="btn btn-danger"
                                style={{ padding: '4px 8px', fontSize: '0.8rem', background: 'transparent', border: '1px solid var(--error)' }}
                              >
                                Withdraw
                              </button>
                            ) : (
                              <button
                                onClick={() => handleInviteToSquad(friend.uid)}
                                className="btn btn-primary"
                                disabled={spotsLeft <= 0}
                                style={{ padding: '4px 8px', fontSize: '0.8rem', opacity: spotsLeft <= 0 ? 0.5 : 1, cursor: spotsLeft <= 0 ? 'not-allowed' : 'pointer' }}
                              >
                                Invite
                              </button>
                            )}
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}

              <div className="modal-actions" style={{ marginTop: '1rem', justifyContent: 'space-between' }}>
                {friendsData.filter(f => f.squadId !== userData?.squadId).length === 0 ? (
                  <button onClick={() => setActiveModal('addFriend')} className="btn btn-primary">Invite a Friend +</button>
                ) : <div />}
                <button onClick={() => setActiveModal(null)} className="btn btn-secondary">Close</button>
              </div>
            </div>
          </div>
        )
      }

      {
        activeModal === 'addFriend' && (
          <div className="modal-overlay" onClick={() => setActiveModal(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <h3 className="modal-header">Add Friend</h3>
              <div className="mt-4">
                <h4>Search User by Email</h4>
                <input type="email" value={friendEmail} onChange={e => setFriendEmail(e.target.value)} className="input-field" placeholder="friend@example.com" />
                <div style={{ display: 'flex', gap: '8px', marginTop: '1rem' }}>
                  <button onClick={() => setActiveModal(null)} className="btn btn-secondary" style={{ flex: '0 0 auto' }}>Close</button>
                  <button onClick={async () => {
                    if (!friendEmail || !currentUser) return;
                    try {
                      if (friendEmail.toLowerCase() === currentUser.email?.toLowerCase()) return;
                      const q = query(getPublicProfileCollection(), where("email", "==", friendEmail.toLowerCase()));
                      const querySnapshot = await getDocs(q);
                      if (querySnapshot.empty) { showAlert("User not found! Share your invite link to invite them.", true); return; }
                      const friendUid = querySnapshot.docs[0].id;

                      // Check if already friends
                      const userFriends = userData?.friends || [];
                      if (userFriends.includes(friendUid)) {
                        showAlert("You are already friends with this user!");
                        setFriendEmail('');
                      } else {
                        // Send Friend Request
                        await handleSendFriendRequest(friendUid);
                      }
                    } catch (e) { console.error(e); }
                  }} className="btn btn-primary" style={{ flex: 1 }}>Send Friend Request</button>
                </div>
              </div>
            </div>
          </div>
        )
      }


      {
        activeModal === 'alert' && (
          <div className="modal-overlay" onClick={() => setActiveModal(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <p className="text-center">{alertMessage}</p>
              <div className="modal-actions" style={{ justifyContent: 'center', gap: '8px' }}>
                <button onClick={() => { setActiveModal(null); setAlertIsUpgrade(false); setShowShareLink(false); }} className="btn btn-secondary">OK</button>
                {alertIsUpgrade && (
                  <button onClick={() => { setActiveModal('upgrade'); setAlertIsUpgrade(false); }} className="btn" style={{ background: 'linear-gradient(45deg, var(--primary), var(--secondary))', color: 'black', fontWeight: 'bold' }}>Upgrade Plan ⚡</button>
                )}
                {showShareLink && (
                  <button onClick={copyInviteLink} className="btn btn-primary">📋 Share Link</button>
                )}
              </div>
            </div>
          </div>
        )
      }

      {
        activeModal === 'confirm' && confirmAction && (
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
        )
      }

      {/* Install Instructions Modal */}
      {
        activeModal === 'install' && (
          <div className="modal-overlay" onClick={() => setActiveModal(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <h3 className="modal-header">Install App</h3>

              <p style={{ textAlign: 'center', marginBottom: '30px', color: '#ccc' }}>
                Install Herd Search to your home screen for the best experience, including full-screen map and easier access.
              </p>

              <div style={{ marginBottom: '30px' }}>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid #333', paddingBottom: '10px', marginBottom: '15px' }}>
                  <span style={{ fontSize: '1.5rem' }}>🍎</span> iOS (iPhone/iPad)
                </h4>
                <ol style={{ lineHeight: '1.8', paddingLeft: '20px' }}>
                  <li>Tap the <strong>Share</strong> button 📤 in Safari's toolbar.</li>
                  <li>Scroll down the share sheet.</li>
                  <li>Tap <strong>Add to Home Screen</strong>.</li>
                  <li>Tap <strong>Add</strong> in the top right corner.</li>
                </ol>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid #333', paddingBottom: '10px', marginBottom: '15px' }}>
                  <span style={{ fontSize: '1.5rem', color: '#3ddc84' }}>🤖</span> Android (Chrome)
                </h4>
                <ol style={{ lineHeight: '1.8', paddingLeft: '20px' }}>
                  <li>Tap the <strong>Menu</strong> button ⋮ (three dots) in Chrome.</li>
                  <li>Tap <strong>Install App</strong> or <strong>Add to Home screen</strong>.</li>
                  <li>Follow the on-screen prompts to install.</li>
                </ol>
              </div>

              <div className="modal-actions">
                <button onClick={() => setActiveModal(null)} className="btn btn-primary">Done</button>
              </div>
            </div>
          </div>
        )
      }


    </div >
  );
}
