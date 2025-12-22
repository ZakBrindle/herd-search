import { useState, useEffect, useRef } from 'react';
import {
    collection,
    query,
    orderBy,
    onSnapshot,
    addDoc,
    where
} from 'firebase/firestore';
import { db } from '../firebase';
import type { UserData } from '../contexts/AuthContext';
import { FaComments } from 'react-icons/fa';

interface ChatMessage {
    id: string;
    senderId: string;
    senderName: string;
    senderPhotoURL?: string;
    content: string;
    createdAt: number;
    type?: 'chat' | 'status_update' | 'vote_ended' | 'search_notification';
}

interface ChatTabProps {
    userData: UserData | null;
    squadId: string | null;
}

export default function ChatTab({ userData, squadId }: ChatTabProps) {
    const [allMessages, setAllMessages] = useState<ChatMessage[]>([]);
    const [displayedMessages, setDisplayedMessages] = useState<ChatMessage[]>([]);
    const [messagesToShow, setMessagesToShow] = useState(20);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesListRef = useRef<HTMLDivElement>(null);
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
        if (displayedMessages.length > 0 && messagesToShow === 20) {
            scrollToBottom();
        }
    }, [displayedMessages.length]);


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
                position: 'fixed',
                bottom: '74px', // Standard height of bottom nav
                left: 0,
                right: 0,
                padding: '12px',
                background: '#1e1e1e',
                display: 'flex',
                gap: '8px',
                borderTop: '1px solid #333',
                zIndex: 100,
                boxShadow: '0 -4px 10px rgba(0,0,0,0.5)'
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
                        color: 'white',
                        marginBottom: 0 // Override input-field margin
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
        </div >
    );
}
