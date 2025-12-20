import { useState, useEffect, useRef } from 'react';
import {
    collection,
    query,
    orderBy,
    onSnapshot,
    addDoc,
    where,
    limit
} from 'firebase/firestore';
import { db } from '../firebase';
import type { UserData } from '../contexts/AuthContext';
import { FaPaperPlane, FaComments } from 'react-icons/fa';

interface ChatMessage {
    id: string;
    senderId: string;
    senderName: string;
    senderPhotoURL?: string;
    content: string;
    createdAt: number;
}

interface ChatTabProps {
    userData: UserData | null;
    squadId: string | null;
}

export default function ChatTab({ userData, squadId }: ChatTabProps) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const messagesEndRef = useRef<HTMLDivElement>(null);
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
            orderBy('createdAt', 'asc'),
            limit(100) // Safety limit
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const msgs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as ChatMessage[];
            setMessages(msgs);
            setLoading(false);
            scrollToBottom();
        });

        return () => unsubscribe();
    }, [squadId]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSendMessage = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!newMessage.trim() || !userData || !squadId) return;

        const msgContent = newMessage.trim();
        setNewMessage(''); // Optimistic clear

        try {
            await addDoc(collection(db, 'squads', squadId, 'messages'), {
                senderId: userData.uid,
                senderName: userData.displayName || 'Unknown',
                senderPhotoURL: userData.photoURL || '',
                content: msgContent,
                createdAt: Date.now()
            });
            scrollToBottom();
        } catch (error) {
            console.error("Error sending message:", error);
            // Ideally show an error toast here or restore the message
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
            height: 'calc(100vh - 140px)', // Adjust for header and bottom nav
            position: 'relative'
        }}>
            <header style={{
                padding: '16px',
                borderBottom: '1px solid #333',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
            }}>
                <div className="logo" style={{ fontSize: '1.2rem' }}>Squad Chat</div>
                <FaComments size={20} color="var(--primary)" />
            </header>

            <div className="messages-list" style={{
                flex: 1,
                overflowY: 'auto',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
            }}>
                {loading && <p style={{ textAlign: 'center', color: '#666' }}>Loading messages...</p>}
                {!loading && messages.length === 0 && (
                    <div style={{ textAlign: 'center', color: '#888', marginTop: '2rem' }}>
                        <p>No messages yet.</p>
                        <p style={{ fontSize: '0.8rem' }}>Start the conversation with your squad!</p>
                    </div>
                )}

                {messages.map((msg, index) => {
                    const isMe = msg.senderId === userData?.uid;
                    const prevMsg = messages[index - 1];

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
                    while (tempIdx >= 0 && messages[tempIdx].senderId === msg.senderId) {
                        consecutiveCount++;
                        tempIdx--;
                    }
                    const shouldBreakGroup = (consecutiveCount % 5 === 0);

                    // If date header is shown, we MUST show the message header too (break group)
                    const showHeader = !isSameSenderAsPrev || shouldBreakGroup || showDateHeader;

                    return (
                        <div key={msg.id} style={{ display: 'flex', flexDirection: 'column' }}>
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
                                        {msg.senderPhotoURL ? (
                                            <img src={msg.senderPhotoURL} style={{ width: '24px', height: '24px', borderRadius: '50%' }} alt="ava" />
                                        ) : (
                                            <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#555' }} />
                                        )}
                                        <span style={{ fontSize: '0.75rem', color: '#aaa' }}>{msg.senderName}</span>
                                        <span style={{ fontSize: '0.65rem', color: '#555' }}>{formatTime(msg.createdAt)}</span>
                                    </div>
                                )}

                                {/* Chat Bubble */}
                                <div style={{
                                    maxWidth: '75%',
                                    padding: '8px 12px',
                                    borderRadius: '12px',
                                    borderTopRightRadius: isMe && !showHeader ? '4px' : '12px',
                                    borderTopLeftRadius: !isMe && !showHeader ? '4px' : '12px',
                                    backgroundColor: isMe ? 'var(--primary)' : '#333', // User primary color for me
                                    color: isMe ? '#000' : '#fff',
                                    position: 'relative',
                                    wordWrap: 'break-word',
                                    marginLeft: isMe ? '0' : (showHeader ? '32px' : '32px'), // Indent to align with text if no header?
                                    marginRight: isMe ? (showHeader ? '32px' : '32px') : '0',  // Actually let's keep bubbles aligned
                                }}>
                                    {/*
                     Design Tweaks:
                     If showHeader is true aka "New Group", we have the avatar row.
                     The bubble should be below it.
                     But if we are continuing a group, we don't have avatar.
                     The bubbles should align vertically.
                     Since we put avatar in a separate flex row above, the bubbles are naturally below.
                     However, for 'me' messages, we might want them right aligned.
                     For 'other' messages, left aligned.
                 */}
                                    {msg.content}
                                </div>
                            </div>
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="input-area" style={{
                padding: '12px',
                background: '#1e1e1e',
                display: 'flex',
                gap: '8px',
                borderTop: '1px solid #333'
            }}>
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
                        color: 'white'
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
                        color: 'black',
                        border: 'none'
                    }}
                >
                    <FaPaperPlane size={16} />
                </button>
            </div>
        </div>
    );
}
