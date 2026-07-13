import { useState, useEffect, useRef } from 'react';
import {
    collection,
    query,
    orderBy,
    onSnapshot,
    addDoc,
    where,
    getDocs,
    doc,
    updateDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import type { UserData } from '../contexts/AuthContext';
import { FaComments, FaReply } from 'react-icons/fa';
const getPartyhatImg = (skin?: string): string => {
    if (skin === 'dino') return '/dino-hat.png';
    if (skin === 'princess') return '/princess-hat.png';
    if (skin === 'wizard') return '/wizard-hat.png';
    return '/party-hat.png';
};

const getTrafficconeImg = (skin?: string): string => {
    if (skin === 'green') return '/traffic-cone-green.png';
    if (skin === 'purple') return '/traffic-cone-purple.png';
    if (skin === 'rainbow') return '/traffic-cone-rainbow.png';
    return '/traffic-cone.png';
};

interface ChatMessage {
    id: string;
    senderId: string;
    senderName: string;
    senderPhotoURL?: string;
    content: string;
    createdAt: number;
    type?: 'chat' | 'status_update' | 'vote_ended' | 'search_notification';
    replyToId?: string;
    replyToName?: string;
    replyToContent?: string;
    reactions?: {
        [uid: string]: {
            emoji: string;
            displayName: string;
        }
    };
}

interface Vote {
    id: string;
    creatorId: string;
    creatorName: string;
    targetAreaId: string;
    targetAreaName: string;
    createdAt: number;
    votes: { [uid: string]: 'yes' | 'no' };
    completedAt?: number;
}

interface ChatTabProps {
    userData: UserData | null;
    squadId: string | null;
    activeVote?: Vote | null;
    onVote?: (voteVal: 'yes' | 'no') => Promise<void>;
    onSelectMemberByUid?: (uid: string) => void;
    squadMembers?: UserData[];
    chatHourlyLimit?: string;
}

export default function ChatTab({ userData, squadId, activeVote, onVote, onSelectMemberByUid, squadMembers = [], chatHourlyLimit = '10' }: ChatTabProps) {
    const getSenderData = (senderId: string, msg: ChatMessage): UserData => {
        if (userData && userData.uid === senderId) {
            return userData;
        }
        const member = squadMembers.find(m => m.uid === senderId);
        if (member) return member;
        return {
            uid: senderId,
            displayName: msg.senderName,
            photoURL: msg.senderPhotoURL,
            avatarEffects: []
        };
    };

    const renderSenderAvatar = (msg: ChatMessage) => {
        const sender = getSenderData(msg.senderId, msg);
        if (!sender.photoURL) {
            return (
                <div
                    onClick={() => onSelectMemberByUid?.(msg.senderId)}
                    style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        background: '#555',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.65rem',
                        color: '#fff',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                    }}
                >
                    {msg.senderName.substring(0, 2).toUpperCase()}
                </div>
            );
        }

        const isLeader = sender.squadId && sender.squadOwnerId === sender.uid;
        const hasSub = (sender.subscriptionExpiry && sender.subscriptionExpiry > Date.now()) || sender.isDev;
        const isEligibleForCrown = !!(hasSub && isLeader);
        const hasCrown = sender.avatarEffects?.includes('crown') && isEligibleForCrown;
        const hasHalo = sender.avatarEffects?.includes('halo');
        const hasPartyhat = sender.avatarEffects?.includes('partyhat');
        const hasTrafficcone = sender.avatarEffects?.includes('trafficcone');

        const spinClass = sender.avatarEffects?.includes('spin') ? 'spin-animate' : '';
        const glowClass = sender.avatarEffects?.includes('glow') ? 'glow-animate' : '';
        const rainbowClass = sender.avatarColor === 'rainbow' ? 'rainbow-animate' : '';

        return (
            <div 
                style={{ 
                    position: 'relative', 
                    width: '24px', 
                    height: '24px',
                    marginRight: '8px'
                }}
            >
                {/* Crown decoration */}
                {hasCrown && (
                    <span 
                        style={{
                            position: 'absolute',
                            top: '-9px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            fontSize: '9px',
                            zIndex: 6,
                            pointerEvents: 'none',
                            filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.5))'
                        }}
                    >
                        👑
                    </span>
                )}

                {/* Halo decoration */}
                {hasHalo && (
                    <img 
                        src={`/halo-${sender.avatarHaloSkin || 'birthday'}.png`} 
                        style={{
                            position: 'absolute',
                            top: '-7px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            width: '12px',
                            height: '12px',
                            zIndex: 5,
                            pointerEvents: 'none',
                            filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.5))'
                        }}
                        alt="Halo"
                    />
                )}

                {/* Partyhat decoration */}
                {hasPartyhat && (
                    <img 
                        src={getPartyhatImg(sender.avatarPartyhatSkin)} 
                        style={{
                            position: 'absolute',
                            top: '-8px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            width: '12px',
                            height: '12px',
                            zIndex: 5,
                            pointerEvents: 'none',
                            filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.5))'
                        }}
                        alt="Party Hat"
                    />
                )}

                {/* Traffic Cone decoration */}
                {hasTrafficcone && (
                    <img 
                        src={getTrafficconeImg(sender.avatarTrafficconeSkin)} 
                        style={{
                            position: 'absolute',
                            top: '-8px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            width: '12px',
                            height: '12px',
                            zIndex: 5,
                            pointerEvents: 'none',
                            filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.5))'
                        }}
                        alt="Traffic Cone"
                    />
                )}

                {/* Custom Animated Avatar Wrapper */}
                <div
                    className={`${spinClass} ${glowClass} ${rainbowClass}`}
                    onClick={() => onSelectMemberByUid?.(msg.senderId)}
                    style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        border: '2px solid',
                        borderColor: sender.avatarColor === 'rainbow' ? 'transparent' : (sender.avatarColor || '#555'),
                        background: '#333',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        boxSizing: 'border-box'
                    }}
                >
                    <img
                        src={sender.photoURL}
                        alt={msg.senderName}
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            borderRadius: '50%',
                            border: 'none',
                            margin: 0
                        }}
                    />
                </div>
            </div>
        );
    };

    const handleToggleReaction = async (msg: ChatMessage, emoji: string) => {
        if (!userData || !squadId) return;
        const msgRef = doc(db, 'squads', squadId, 'messages', msg.id);
        
        const currentReaction = msg.reactions?.[userData.uid];
        let updatedReactions = { ...(msg.reactions || {}) };

        if (currentReaction && currentReaction.emoji === emoji) {
            delete updatedReactions[userData.uid];
        } else {
            updatedReactions[userData.uid] = {
                emoji: emoji,
                displayName: userData.displayName || 'Squad Member'
            };
        }

        try {
            await updateDoc(msgRef, {
                reactions: updatedReactions
            });
            setActiveMessageForAction(prev => {
                if (prev && prev.id === msg.id) {
                    return { ...prev, reactions: updatedReactions };
                }
                return prev;
            });
        } catch (error) {
            console.error("Error toggling reaction: ", error);
        }
    };

    const [allMessages, setAllMessages] = useState<ChatMessage[]>([]);
    const [displayedMessages, setDisplayedMessages] = useState<ChatMessage[]>([]);
    const [messagesToShow, setMessagesToShow] = useState(20);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [activeMessageForAction, setActiveMessageForAction] = useState<ChatMessage | null>(null);
    const [replyToMessage, setReplyToMessage] = useState<ChatMessage | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesListRef = useRef<HTMLDivElement>(null);

    const scrollToMessage = (targetId: string) => {
        const element = document.getElementById(`msg-${targetId}`);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const bubble = element.querySelector('.chat-bubble-inner') as HTMLElement;
            if (bubble) {
                const originalBg = bubble.style.backgroundColor;
                const originalTransition = bubble.style.transition;
                
                bubble.style.transition = 'background-color 0.3s ease';
                bubble.style.backgroundColor = 'rgba(255, 215, 0, 0.4)'; // Golden highlight flash
                
                setTimeout(() => {
                    bubble.style.transition = 'background-color 0.8s ease';
                    bubble.style.backgroundColor = originalBg;
                    setTimeout(() => {
                        bubble.style.transition = originalTransition;
                    }, 800);
                }, 1200);
            }
        } else {
            alert("Original message is further up. Scroll up and click 'Load more' to view older messages.");
        }
    };
    const DAY_IN_MS = 24 * 60 * 60 * 1000;
    const SEVEN_DAYS_MS = 7 * DAY_IN_MS;

    useEffect(() => {
        if (!squadId) {
            setLoading(false);
            return;
        }

        // Query messages from the last 7 days
        const sevenDaysAgo = Date.now() - SEVEN_DAYS_MS;

        const q = query(
            collection(db, 'squads', squadId, 'messages'),
            where('createdAt', '>', sevenDaysAgo),
            orderBy('createdAt', 'asc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const msgs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as ChatMessage[];
            setAllMessages(msgs);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [squadId]);

    // Update displayed messages when allMessages or messagesToShow changes
    useEffect(() => {
        if (allMessages.length === 0) {
            setDisplayedMessages([]);
            return;
        }

        // Show the last N messages
        const startIndex = Math.max(0, allMessages.length - messagesToShow);
        setDisplayedMessages(allMessages.slice(startIndex));
    }, [allMessages, messagesToShow]);

    // Auto-scroll when new messages arrive (but not when loading more)
    useEffect(() => {
        if ((displayedMessages.length > 0 || activeVote) && messagesToShow === 20) {
            scrollToBottom();
        }
    }, [displayedMessages.length, activeVote]);


    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const loadMoreMessages = () => {
        const previousScrollHeight = messagesListRef.current?.scrollHeight || 0;
        setMessagesToShow(prev => prev + 20);

        // Maintain scroll position after loading more
        setTimeout(() => {
            if (messagesListRef.current) {
                const newScrollHeight = messagesListRef.current.scrollHeight;
                messagesListRef.current.scrollTop = newScrollHeight - previousScrollHeight;
            }
        }, 50);
    };

    const handleSendMessage = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!newMessage.trim() || !userData || !squadId) return;

        const msgContent = newMessage.trim();
        setNewMessage(''); // Optimistic clear

        const currentReplyTo = replyToMessage;
        setReplyToMessage(null);

        try {
            // Check hourly limit (resets every calendar hour)
            if (chatHourlyLimit !== 'Unlimited') {
                const limitNum = parseInt(chatHourlyLimit, 10);
                const currentHour = Math.floor(Date.now() / (3600 * 1000));
                let currentCount = 0;

                if (userData.chatHourStart === currentHour) {
                    currentCount = userData.chatCountThisHour || 0;
                }

                if (currentCount >= limitNum) {
                    alert(`Hourly chat limit reached (${limitNum} messages/hour). Resets next hour!`);
                    setNewMessage(msgContent); // Restore
                    return;
                }

                // Increment hourly count
                await updateDoc(doc(db, 'users', userData.uid), {
                    chatHourStart: currentHour,
                    chatCountThisHour: currentCount + 1
                });
            }

            const messageData: any = {
                senderId: userData.uid,
                senderName: userData.displayName || 'Unknown',
                senderPhotoURL: userData.photoURL || '',
                content: msgContent,
                createdAt: Date.now()
            };

            if (currentReplyTo) {
                messageData.replyToId = currentReplyTo.id;
                messageData.replyToName = currentReplyTo.senderName;
                messageData.replyToContent = currentReplyTo.content;
            }

            await addDoc(collection(db, 'squads', squadId, 'messages'), messageData);

            // --- Send Push Notifications ---
            try {
                // Fetch other squad members' tokens
                const q = query(collection(db, 'users'), where('squadId', '==', squadId));
                const snap = await getDocs(q);
                const tokens = snap.docs
                    .map(d => d.data())
                    .filter(u => u.uid !== userData.uid && u.fcmToken)
                    .map(u => u.fcmToken);

                if (tokens.length > 0) {
                    fetch('/api/send-notification', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            tokens,
                            title: `New Message from ${userData.displayName?.split(' ')[0]}`,
                            body: msgContent.length > 50 ? msgContent.substring(0, 47) + '...' : msgContent,
                            data: {
                                type: 'chat',
                                squadId: squadId
                            }
                        })
                    }).catch(err => console.error("Notification API failed:", err));
                }
            } catch (e) {
                console.warn("Could not send push notifications:", e);
            }

            scrollToBottom();
        } catch (error) {
            console.error("Error sending message:", error);
            alert("Error sending message. Please try again.");
            setNewMessage(msgContent); // Restore
        }
    };

    const formatTime = (timestamp: number) => {
        return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const getDayLabel = (timestamp: number) => {
        const date = new Date(timestamp);
        const today = new Date();
        if (date.toDateString() === today.toDateString()) return "Today";
        return date.toLocaleDateString();
    };

    return (
        <div className="chat-container" style={{
            display: 'flex',
            flexDirection: 'column',
            height: 'calc(100vh - 80px)', // Full height minus nav bar
            position: 'absolute', // Break out of flow if needed, or stick to flex
            top: 0,
            left: 0,
            right: 0,
            bottom: '80px',
            background: 'var(--bg-color)', // Ensure background covers
            zIndex: 50
        }}>
            <header style={{
                padding: '16px',
                borderBottom: '1px solid #333',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                background: 'rgba(18, 18, 18, 0.95)',
                backdropFilter: 'blur(10px)',
                position: 'sticky',
                top: 0,
                zIndex: 10
            }}>
                <div className="logo" style={{ fontSize: '1.2rem' }}>Squad Chat</div>
                <FaComments size={20} color="var(--primary)" />
            </header>

            <div ref={messagesListRef} className="messages-list" style={{
                flex: 1,
                overflowY: 'auto',
                padding: '16px 16px 100px 16px', // Extra bottom padding for input area
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
            }}>
                {loading && <p style={{ textAlign: 'center', color: '#666' }}>Loading messages...</p>}
                {!loading && allMessages.length === 0 && (
                    <div style={{ textAlign: 'center', color: '#888', marginTop: '2rem' }}>
                        <p>No messages yet.</p>
                        <p style={{ fontSize: '0.8rem' }}>Start the conversation with your squad!</p>
                    </div>
                )}

                {/* Load More Button */}
                {!loading && allMessages.length > messagesToShow && (
                    <div style={{ textAlign: 'center', margin: '10px 0' }}>
                        <button
                            onClick={loadMoreMessages}
                            className="btn"
                            style={{
                                background: '#333',
                                color: 'var(--primary)',
                                padding: '8px 16px',
                                borderRadius: '20px',
                                border: '1px solid var(--primary)',
                                fontSize: '0.85rem',
                                fontWeight: '600'
                            }}
                        >
                            Load more
                        </button>
                    </div>
                )}

                {!loading && allMessages.length > 0 && allMessages.length <= messagesToShow && displayedMessages.length === allMessages.length && (
                    <div style={{ textAlign: 'center', margin: '10px 0' }}>
                        <span style={{
                            color: '#666',
                            fontSize: '0.75rem',
                            fontStyle: 'italic'
                        }}>
                            All chats loaded
                        </span>
                    </div>
                )}

                {displayedMessages.map((msg, index) => {
                    const isMe = msg.senderId === userData?.uid;
                    const prevMsg = displayedMessages[index - 1];

                    const showDateHeader = !prevMsg || getDayLabel(prevMsg.createdAt) !== getDayLabel(msg.createdAt);

                    // Grouping logic:
                    // 1. Same sender
                    // 2. Less than 5 minutes between messages (optional, like logic)
                    // 3. User requested: "If a person sends 5 messages in a row, it says their name and image at the top once"

                    const isSameSenderAsPrev = prevMsg && prevMsg.senderId === msg.senderId;

                    // We also need to cap grouping at 5 messages.
                    // So if we are the 6th message, we restart the header.
                    let consecutiveCount = 0;
                    let tempIdx = index - 1;
                    while (tempIdx >= 0 && displayedMessages[tempIdx].senderId === msg.senderId) {
                        consecutiveCount++;
                        tempIdx--;
                    }
                    const shouldBreakGroup = (consecutiveCount % 5 === 0);

                    // If date header is shown, we MUST show the message header too (break group)
                    // ALSO: If the previous message was a status update OR vote ended, we must show the header because the flow was broken visually
                    const prevWasSystem = prevMsg && (prevMsg.type === 'status_update' || prevMsg.type === 'vote_ended');
                    const showHeader = !isSameSenderAsPrev || shouldBreakGroup || showDateHeader || prevWasSystem;

                    // If it is a status update, render it differently
                    if (msg.type === 'status_update') {
                        return (
                            <div key={msg.id} style={{ display: 'flex', justifyContent: 'center', margin: '16px 0' }}>
                                <div style={{
                                    background: '#FFF9C4', // Pastel Yellow
                                    padding: '6px 16px',
                                    borderRadius: '20px',
                                    fontSize: '0.8rem',
                                    color: '#444',
                                    fontWeight: '500',
                                    border: '1px solid #F0E68C',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
                                }}>
                                    Status update by {msg.senderName}: {msg.content}
                                </div>
                            </div>
                        );
                    }

                    // If it is a vote ended message or search notification, render it differently
                    if (msg.type === 'vote_ended' || msg.type === 'search_notification') {
                        const isSearch = msg.type === 'search_notification';
                        return (
                            <div key={msg.id} style={{ display: 'flex', justifyContent: 'center', margin: '16px 0' }}>
                                <div style={{
                                    background: isSearch ? '#FFF9C4' : '#E1BEE7', // Pastel Yellow for Search, Purple for Vote
                                    padding: '6px 16px',
                                    borderRadius: '20px',
                                    fontSize: '0.8rem',
                                    color: '#444',
                                    fontWeight: isSearch ? '500' : '600',
                                    border: isSearch ? '1px solid #F0E68C' : '1px solid #D1C4E9',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
                                }}>
                                    {msg.content}
                                </div>
                            </div>
                        );
                    }

                    return (
                        <div key={msg.id} id={`msg-${msg.id}`} style={{ display: 'flex', flexDirection: 'column' }}>
                            {showDateHeader && (
                                <div style={{ textAlign: 'center', margin: '12px 0', fontSize: '0.75rem', color: '#666' }}>
                                    <span style={{ background: '#222', padding: '4px 8px', borderRadius: '12px' }}>
                                        {getDayLabel(msg.createdAt)}
                                    </span>
                                </div>
                            )}

                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: isMe ? 'flex-end' : 'flex-start',
                                marginBottom: '2px'
                            }}>
                                {/* Message Header (Avatar + Name) */}
                                {showHeader && (
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        marginTop: index === 0 ? '0' : '12px',
                                        marginBottom: '4px',
                                        flexDirection: isMe ? 'row-reverse' : 'row'
                                    }}>
                                        {renderSenderAvatar(msg)}
                                        <span
                                            onClick={() => onSelectMemberByUid?.(msg.senderId)}
                                            style={{ fontSize: '0.75rem', color: '#aaa', cursor: 'pointer' }}
                                            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--primary)'}
                                            onMouseLeave={(e) => e.currentTarget.style.color = '#aaa'}
                                        >
                                            {msg.senderName}
                                        </span>
                                        <span style={{ fontSize: '0.65rem', color: '#555' }}>{formatTime(msg.createdAt)}</span>
                                    </div>
                                )}

                                {/* Small yellow reply context text attached above bubble */}
                                {msg.replyToId && (
                                    <div
                                        onClick={() => scrollToMessage(msg.replyToId!)}
                                        style={{
                                            fontSize: '0.75rem',
                                            color: '#FFD700',
                                            cursor: 'pointer',
                                            marginBottom: '2px',
                                            marginLeft: isMe ? '0' : '32px',
                                            marginRight: isMe ? '32px' : '0',
                                            alignSelf: isMe ? 'flex-end' : 'flex-start',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            background: 'rgba(255, 215, 0, 0.08)',
                                            padding: '4px 8px',
                                            borderRadius: '6px',
                                            border: '1px solid rgba(255, 215, 0, 0.2)',
                                            maxWidth: '75%',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            transition: 'background 0.2s ease',
                                            userSelect: 'none'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 215, 0, 0.18)'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 215, 0, 0.08)'}
                                    >
                                        <span>↩ Reply to {msg.replyToName?.split(' ')[0]}'s message: {msg.replyToContent?.substring(0, 20)}{msg.replyToContent && msg.replyToContent.length > 20 ? '...' : ''}</span>
                                    </div>
                                )}

                                {/* Chat Bubble */}
                                <div
                                    className="chat-bubble-inner"
                                    onClick={() => {
                                        if (msg.type !== 'status_update' && msg.type !== 'vote_ended' && msg.type !== 'search_notification') {
                                            setActiveMessageForAction(msg);
                                        }
                                    }}
                                    onTouchStart={(e) => {
                                        const timer = setTimeout(() => {
                                            if (msg.type !== 'status_update' && msg.type !== 'vote_ended' && msg.type !== 'search_notification') {
                                                setActiveMessageForAction(msg);
                                            }
                                        }, 600);
                                        (e.currentTarget as any)._holdTimer = timer;
                                    }}
                                    onTouchEnd={(e) => {
                                        if ((e.currentTarget as any)._holdTimer) {
                                            clearTimeout((e.currentTarget as any)._holdTimer);
                                            delete (e.currentTarget as any)._holdTimer;
                                        }
                                    }}
                                    onMouseDown={(e) => {
                                        const timer = setTimeout(() => {
                                            if (msg.type !== 'status_update' && msg.type !== 'vote_ended' && msg.type !== 'search_notification') {
                                                setActiveMessageForAction(msg);
                                            }
                                        }, 600);
                                        (e.currentTarget as any)._holdTimer = timer;
                                    }}
                                    onMouseUp={(e) => {
                                        if ((e.currentTarget as any)._holdTimer) {
                                            clearTimeout((e.currentTarget as any)._holdTimer);
                                            delete (e.currentTarget as any)._holdTimer;
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.transform = 'scale(1)';
                                        e.currentTarget.style.filter = 'brightness(1)';
                                        if ((e.currentTarget as any)._holdTimer) {
                                            clearTimeout((e.currentTarget as any)._holdTimer);
                                            delete (e.currentTarget as any)._holdTimer;
                                        }
                                    }}
                                    style={{
                                        maxWidth: '75%',
                                        padding: '8px 12px',
                                        borderRadius: '12px',
                                        borderTopRightRadius: isMe && !showHeader ? '4px' : '12px',
                                        borderTopLeftRadius: !isMe && !showHeader ? '4px' : '12px',
                                        backgroundColor: isMe ? 'var(--primary)' : '#333', // User primary color for me
                                        color: isMe ? '#000' : '#fff',
                                        position: 'relative',
                                        wordWrap: 'break-word',
                                        marginLeft: isMe ? '0' : '32px',
                                        marginRight: isMe ? '32px' : '0',
                                        cursor: 'pointer',
                                        transition: 'transform 0.15s ease, filter 0.15s ease',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.transform = 'scale(1.02)';
                                        e.currentTarget.style.filter = 'brightness(1.1)';
                                    }}
                                >
                                    {msg.content}
                                </div>

                                {/* Emoji Reaction Pill Counter */}
                                {(() => {
                                    const reactionsMap = msg.reactions || {};
                                    const emojiCounts: { [emoji: string]: number } = {};
                                    Object.values(reactionsMap).forEach(r => {
                                        emojiCounts[r.emoji] = (emojiCounts[r.emoji] || 0) + 1;
                                    });
                                    if (Object.keys(emojiCounts).length === 0) return null;
                                    return (
                                        <div 
                                            style={{ 
                                                display: 'flex', 
                                                gap: '6px', 
                                                marginTop: '4px',
                                                marginLeft: isMe ? 'auto' : '32px',
                                                marginRight: isMe ? '32px' : 'auto',
                                                flexWrap: 'wrap',
                                                justifyContent: isMe ? 'flex-end' : 'flex-start',
                                                userSelect: 'none'
                                            }}
                                        >
                                            {Object.entries(emojiCounts).map(([emoji, count]) => (
                                                <div 
                                                    key={emoji}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (msg.type !== 'status_update' && msg.type !== 'vote_ended' && msg.type !== 'search_notification') {
                                                            setActiveMessageForAction(msg);
                                                        }
                                                    }}
                                                    style={{
                                                        background: 'rgba(255, 255, 255, 0.08)',
                                                        border: '1px solid rgba(255, 255, 255, 0.1)',
                                                        borderRadius: '12px',
                                                        padding: '2px 8px',
                                                        fontSize: '0.75rem',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                        color: '#fff',
                                                        fontWeight: 'bold',
                                                        cursor: 'pointer',
                                                        transition: 'transform 0.1s ease'
                                                    }}
                                                    onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
                                                    onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                                                >
                                                    <span>{emoji}</span>
                                                    <span style={{ fontSize: '0.7rem', color: 'var(--primary)' }}>{count}</span>
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />

                {/* Active Vote Widget at the bottom of the chat */}
                {activeVote && !activeVote.completedAt && (
                    <div className="card" style={{
                        margin: '16px 0',
                        backgroundColor: '#1a1a1a',
                        border: '1px solid var(--primary)',
                        padding: '20px',
                        borderRadius: '16px',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '12px',
                        animation: 'fadeIn 0.5s ease-out'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--primary)', fontWeight: 'bold', letterSpacing: '1px' }}>Active Squad Vote</span>
                            <span>📋</span>
                        </div>
                        <h3 style={{ margin: 0, fontSize: '1.2rem', textAlign: 'center' }}>
                            Go to <span style={{ color: 'var(--primary)' }}>{activeVote.targetAreaName}</span>?
                        </h3>

                        <div style={{ display: 'flex', gap: '10px', width: '100%', marginTop: '8px' }}>
                            {/* Yes Button */}
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <button
                                    onClick={() => onVote?.('yes')}
                                    className="btn"
                                    style={{
                                        width: '100%',
                                        background: activeVote.votes[userData?.uid || ''] === 'yes' ? 'var(--primary)' : '#333',
                                        color: activeVote.votes[userData?.uid || ''] === 'yes' ? 'black' : 'white',
                                        padding: '12px',
                                        fontWeight: 'bold',
                                        border: 'none'
                                    }}
                                >
                                    Lets Go
                                </button>
                                <div style={{ fontSize: '0.75rem', textAlign: 'center', opacity: 0.7 }}>
                                    {Object.values(activeVote.votes).filter(v => v === 'yes').length} votes
                                </div>
                            </div>

                            {/* No Button */}
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <button
                                    onClick={() => onVote?.('no')}
                                    className="btn"
                                    style={{
                                        width: '100%',
                                        background: activeVote.votes[userData?.uid || ''] === 'no' ? 'var(--error)' : '#333',
                                        color: activeVote.votes[userData?.uid || ''] === 'no' ? 'white' : 'white',
                                        padding: '12px',
                                        fontWeight: 'bold',
                                        border: 'none'
                                    }}
                                >
                                    F*** That
                                </button>
                                <div style={{ fontSize: '0.75rem', textAlign: 'center', opacity: 0.7 }}>
                                    {Object.values(activeVote.votes).filter(v => v === 'no').length} votes
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="input-area" style={{
                position: 'fixed',
                bottom: '74px', // Standard height of bottom nav
                left: 0,
                right: 0,
                background: '#1e1e1e',
                display: 'flex',
                flexDirection: 'column',
                borderTop: '1px solid #333',
                zIndex: 100,
                boxShadow: '0 -4px 10px rgba(0,0,0,0.5)'
            }}>
                {replyToMessage && (
                    <div style={{
                        background: '#FFF9C4', // Pastel Yellow background
                        padding: '8px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '10px',
                        borderBottom: '1px solid #F0E68C',
                    }}>
                        <span style={{ fontSize: '0.8rem', color: '#444', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            Replying to {replyToMessage.senderName.split(' ')[0]}'s message: {replyToMessage.content.substring(0, 30)}{replyToMessage.content.length > 30 ? '...' : ''}
                        </span>
                        <button
                            onClick={() => setReplyToMessage(null)}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: '#e53935',
                                cursor: 'pointer',
                                fontSize: '1.1rem',
                                padding: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                fontWeight: 'bold'
                            }}
                        >
                            ✖
                        </button>
                    </div>
                )}
                <div style={{ display: 'flex', gap: '8px', padding: '12px' }}>
                    <input
                        type="text"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                        placeholder="Message squad..."
                        className="input-field"
                        style={{
                            flex: 1,
                            borderRadius: '24px',
                            padding: '10px 16px',
                            border: 'none',
                            background: '#333',
                            color: 'white',
                            marginBottom: 0, // Override input-field margin
                            fontSize: '16px' // Prevent iOS Zoom
                        }}
                    />
                    <button
                        onClick={() => handleSendMessage()}
                        className="btn"
                        style={{
                            borderRadius: '50%',
                            width: '42px',
                            height: '42px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'var(--primary)',
                            border: 'none',
                            color: 'black'
                        }}
                    >
                        <span style={{ fontSize: '1.2rem', marginTop: '-2px' }}>➤</span>
                    </button>
                </div>
            </div>

            {/* Custom Premium Message Options Popup */}
            {activeMessageForAction && (
                <div 
                    className="modal-overlay" 
                    onClick={() => setActiveMessageForAction(null)} 
                    style={{ 
                        position: 'fixed', 
                        top: 0, 
                        left: 0, 
                        right: 0, 
                        bottom: 0, 
                        background: 'rgba(0,0,0,0.6)', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        zIndex: 1100,
                        backdropFilter: 'blur(4px)'
                    }}
                >
                    <div 
                        onClick={e => e.stopPropagation()} 
                        style={{
                            background: '#1e1e1e',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '16px',
                            padding: '28px 24px 24px 24px',
                            maxWidth: '320px',
                            width: '90%',
                            textAlign: 'center',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                            animation: 'scaleUp 0.2s ease-out',
                            position: 'relative'
                        }}
                    >
                        {/* Cancel Cross Button in Top Right */}
                        <button
                            onClick={() => setActiveMessageForAction(null)}
                            style={{
                                position: 'absolute',
                                top: '12px',
                                right: '12px',
                                background: 'none',
                                border: 'none',
                                color: '#888',
                                fontSize: '1.25rem',
                                cursor: 'pointer',
                                transition: 'color 0.2s',
                                lineHeight: '1',
                                padding: '4px'
                            }}
                            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
                            onMouseLeave={e => e.currentTarget.style.color = '#888'}
                        >
                            ✕
                        </button>

                        <h4 style={{ margin: '0 0 12px 0', fontSize: '1.2rem', color: '#fff', fontWeight: 'bold' }}>Message Options</h4>
                        <p style={{ 
                            fontSize: '0.85rem', 
                            color: '#aaa', 
                            marginBottom: '20px',
                            fontStyle: 'italic',
                            wordBreak: 'break-word',
                            maxHeight: '80px',
                            overflowY: 'auto',
                            background: 'rgba(255,255,255,0.03)',
                            padding: '8px',
                            borderRadius: '6px'
                        }}>
                            "{activeMessageForAction.content}"
                        </p>

                        {/* Who Reacted With What Emoji Detail List */}
                        {activeMessageForAction.reactions && Object.keys(activeMessageForAction.reactions).length > 0 && (
                            <div style={{
                                textAlign: 'left',
                                marginBottom: '20px',
                                background: 'rgba(255,255,255,0.02)',
                                border: '1px solid rgba(255,255,255,0.05)',
                                borderRadius: '12px',
                                padding: '12px',
                                maxHeight: '120px',
                                overflowY: 'auto'
                            }}>
                                <div style={{ fontSize: '0.75rem', color: '#888', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.5px' }}>
                                    Reactions
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {Object.entries(activeMessageForAction.reactions).map(([uid, r]) => {
                                        return (
                                            <div key={uid} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                                <span style={{ color: '#ccc', fontWeight: '500' }}>{r.displayName}</span>
                                                <span style={{ fontSize: '1.1rem' }}>{r.emoji}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* 6 Emoji Reaction Selector Bar */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            background: 'rgba(255, 255, 255, 0.05)',
                            padding: '8px 10px',
                            borderRadius: '24px',
                            marginBottom: '16px',
                            border: '1px solid rgba(255, 255, 255, 0.08)'
                        }}>
                            {['👍', '❤️', '😂', '😮', '😢', '👎'].map(emoji => {
                                const hasReacted = activeMessageForAction.reactions?.[userData?.uid || '']?.emoji === emoji;
                                return (
                                    <button
                                        key={emoji}
                                        onClick={() => handleToggleReaction(activeMessageForAction, emoji)}
                                        style={{
                                            background: hasReacted ? 'rgba(255, 255, 255, 0.15)' : 'none',
                                            border: 'none',
                                            fontSize: '1.3rem',
                                            cursor: 'pointer',
                                            padding: '4px',
                                            borderRadius: '8px',
                                            transition: 'transform 0.15s ease, background 0.15s ease',
                                            transform: hasReacted ? 'scale(1.2)' : 'scale(1)'
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.3)'}
                                        onMouseLeave={e => e.currentTarget.style.transform = hasReacted ? 'scale(1.2)' : 'scale(1)'}
                                    >
                                        {emoji}
                                    </button>
                                );
                            })}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <button
                                onClick={() => {
                                    setReplyToMessage(activeMessageForAction);
                                    setActiveMessageForAction(null);
                                }}
                                className="btn"
                                style={{
                                    background: 'linear-gradient(45deg, var(--primary), var(--secondary))',
                                    color: 'black',
                                    padding: '12px',
                                    fontWeight: 'bold',
                                    borderRadius: '8px',
                                    border: 'none',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px',
                                    cursor: 'pointer',
                                    width: '100%'
                                }}
                            >
                                <FaReply /> Reply
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
}
