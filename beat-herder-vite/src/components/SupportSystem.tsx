import { useState, useEffect, useRef } from 'react';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, arrayUnion, type DocumentData, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { FaPaperPlane, FaTimes, FaTicketAlt, FaTrash } from 'react-icons/fa';

export type TicketType = 'problem' | 'suggestion' | 'general';
export type TicketStatus = 'open' | 'closed';

export interface TicketMessage {
    senderId: string;
    senderName: string;
    text: string;
    timestamp: number;
}

export interface Ticket extends DocumentData {
    id: string;
    userId: string;
    userEmail: string;
    type: TicketType;
    subject: string;
    status: TicketStatus;
    createdAt: number;
    lastUpdate: number;
    messages: TicketMessage[];
}

interface SupportSystemProps {
    currentUser: { uid: string; email?: string; displayName?: string };
    isDev?: boolean;
    visible: boolean;
    onClose: () => void;
}

const SupportSystem = ({ currentUser, isDev = false, visible, onClose }: SupportSystemProps) => {
    const [view, setView] = useState<'list' | 'create' | 'chat'>('list');
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);

    // New Ticket State
    const [newType, setNewType] = useState<TicketType>('general');
    const [newSubject, setNewSubject] = useState('');
    const [newMessage, setNewMessage] = useState('');

    // Chat State
    const [chatInput, setChatInput] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // --- Listen for Tickets ---
    useEffect(() => {
        if (!visible || !currentUser) return;

        let q = query(
            collection(db, 'support_tickets'),
            where('userId', '==', currentUser.uid)
        );

        // If Admin, fetch all tickets (requires Firestore Index maybe, or just client-side filter if small app)
        // Actually, rules allow reading all if admin. But standard query filters by 'userId'. 
        // To see ALL, we need a separate query or remove the where clause.
        if (isDev) {
            q = query(collection(db, 'support_tickets'));
        }

        const unsub = onSnapshot(q, (snapshot) => {
            const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Ticket[];
            // Sort by last update
            docs.sort((a, b) => b.lastUpdate - a.lastUpdate);
            setTickets(docs);

            // Update active ticket if open
            if (activeTicket) {
                const updated = docs.find(t => t.id === activeTicket.id);
                if (updated) setActiveTicket(updated);
            }
        });

        return () => unsub();
    }, [visible, currentUser, isDev, activeTicket?.id]); // Note: dependency on activeTicket.id to re-sync chat

    // Scroll to bottom of chat
    useEffect(() => {
        if (view === 'chat') {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [activeTicket, view]);

    const handleCreateTicket = async () => {
        if (!newSubject.trim() || !newMessage.trim()) return alert('Please fill in fields.');

        const initialMsg: TicketMessage = {
            senderId: currentUser.uid,
            senderName: currentUser.displayName || currentUser.email || 'User',
            text: newMessage,
            timestamp: Date.now()
        };

        try {
            await addDoc(collection(db, 'support_tickets'), {
                userId: currentUser.uid,
                userEmail: currentUser.email,
                type: newType,
                subject: newSubject,
                status: 'open',
                createdAt: Date.now(),
                lastUpdate: Date.now(),
                messages: [initialMsg]
            });
            setView('list');
            setNewSubject('');
            setNewMessage('');
        } catch (e) {
            console.error(e);
            alert('Failed to send ticket.');
        }
    };

    const handleSendMessage = async () => {
        if (!activeTicket || !chatInput.trim()) return;

        const msg: TicketMessage = {
            senderId: currentUser.uid,
            senderName: isDev ? 'Admin Support' : (currentUser.displayName || 'User'),
            text: chatInput,
            timestamp: Date.now()
        };

        try {
            const ref = doc(db, 'support_tickets', activeTicket.id);
            await updateDoc(ref, {
                messages: arrayUnion(msg),
                lastUpdate: Date.now()
            });
            setChatInput('');
        } catch (e) {
            console.error(e);
        }
    };

    const handleDeleteTicket = async (ticketId: string) => {
        if (!confirm('Delete this ticket permanently?')) return;
        try {
            await deleteDoc(doc(db, 'support_tickets', ticketId));
            if (activeTicket?.id === ticketId) {
                setView('list');
                setActiveTicket(null);
            }
        } catch (e) { console.error(e); }
    };

    const handleCloseTicket = async () => {
        if (!activeTicket) return;
        try {
            await updateDoc(doc(db, 'support_tickets', activeTicket.id), {
                status: activeTicket.status === 'open' ? 'closed' : 'open'
            });
        } catch (e) { console.error(e); }
    };

    if (!visible) return null;

    return (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
            <div className="modal-content" style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>

                {/* Header */}
                <div className="modal-header" style={{ height: '60px', padding: '0 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #333' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FaTicketAlt color="var(--primary)" />
                        <h3 style={{ margin: 0 }}>{isDev ? 'Admin Support Dashboard' : 'Customer Support'}</h3>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.2rem', cursor: 'pointer' }}><FaTimes /></button>
                </div>

                {/* Body */}
                <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

                    {/* List View */}
                    {view === 'list' && (
                        <div style={{ padding: '1rem', overflowY: 'auto', flex: 1 }}>
                            <button onClick={() => setView('create')} className="btn btn-primary w-full" style={{ marginBottom: '1rem' }}>+ Create New Ticket</button>

                            {tickets.length === 0 ? (
                                <p style={{ textAlign: 'center', color: '#666', marginTop: '2rem' }}>No tickets found.</p>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                                    {tickets.map(t => (
                                        <div key={t.id} className="card" onClick={() => { setActiveTicket(t); setView('chat'); }} style={{ cursor: 'pointer', borderLeft: t.status === 'open' ? '4px solid var(--primary)' : '4px solid #555' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                <strong>{t.subject}</strong>
                                                <span style={{ fontSize: '0.8rem', color: t.status === 'open' ? 'var(--primary)' : '#666', textTransform: 'uppercase' }}>{t.status}</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '0.8rem', color: '#aaa' }}>
                                                <span>{new Date(t.lastUpdate).toLocaleDateString()}</span>
                                                {isDev && <span>{t.userEmail}</span>}
                                            </div>
                                            <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '4px' }}>
                                                {t.messages[t.messages.length - 1]?.text.substring(0, 40)}...
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Create View */}
                    {view === 'create' && (
                        <div style={{ padding: '1rem', overflowY: 'auto', flex: 1 }}>
                            <h4 style={{ marginBottom: '1rem' }}>New Ticket</h4>
                            <select
                                value={newType}
                                onChange={e => setNewType(e.target.value as TicketType)}
                                className="input-field"
                                style={{ marginBottom: '1rem', width: '100%' }}
                            >
                                <option value="general">General Inquiry</option>
                                <option value="problem">Report a Problem</option>
                                <option value="suggestion">Suggestion / Feedback</option>
                            </select>

                            <input
                                className="input-field"
                                placeholder="Subject"
                                value={newSubject}
                                onChange={e => setNewSubject(e.target.value)}
                                style={{ marginBottom: '1rem', width: '100%', boxSizing: 'border-box' }}
                            />

                            <textarea
                                className="input-field"
                                placeholder="Describe your issue..."
                                rows={5}
                                value={newMessage}
                                onChange={e => setNewMessage(e.target.value)}
                                style={{ marginBottom: '1rem', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' }}
                            />

                            <div style={{ display: 'flex', gap: '1rem' }}>
                                <button onClick={() => setView('list')} className="btn btn-secondary w-full">Cancel</button>
                                <button onClick={handleCreateTicket} className="btn btn-primary w-full">Submit</button>
                            </div>
                        </div>
                    )}

                    {/* Chat View */}
                    {view === 'chat' && activeTicket && (
                        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

                            {/* Chat Header */}
                            <div style={{ padding: '0.5rem 1rem', background: '#1f1f1f', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <button onClick={() => setView('list')} className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem' }}>&larr; Back</button>
                                    <div>
                                        <div style={{ fontWeight: 'bold' }}>{activeTicket.subject}</div>
                                        <div style={{ fontSize: '0.7rem', color: '#aaa' }}>{activeTicket.type} • {isDev ? activeTicket.userEmail : 'Support'}</div>
                                    </div>
                                </div>

                                {/* Admin Controls */}
                                {isDev && (
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button onClick={handleCloseTicket} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '4px 8px' }}>
                                            {activeTicket.status === 'open' ? 'Close Ticket' : 'Re-open'}
                                        </button>
                                        <button onClick={() => handleDeleteTicket(activeTicket.id)} className="btn btn-danger" style={{ fontSize: '0.8rem', padding: '4px 8px' }}>
                                            <FaTrash />
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Messages Area */}
                            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {activeTicket.messages.map((m, idx) => {
                                    const isMe = m.senderId === currentUser.uid;
                                    // If isDev (Admin) is viewing:
                                    //   If message is from Admin (me), it's right.
                                    //   If message is from User, it's left.
                                    // If User is viewing:
                                    //   If message is from User (me), it's right.
                                    //   If message is from Admin, it's left.

                                    // Simplified: isMe always means "the sender is the current logged-in user".
                                    return (
                                        <div key={idx} style={{
                                            alignSelf: isMe ? 'flex-end' : 'flex-start',
                                            maxWidth: '80%',
                                            background: isMe ? 'var(--primary)' : '#333',
                                            color: isMe ? '#000' : '#fff',
                                            padding: '8px 12px',
                                            borderRadius: '12px',
                                            borderBottomRightRadius: isMe ? '2px' : '12px',
                                            borderTopLeftRadius: isMe ? '12px' : '2px'
                                        }}>
                                            <div style={{ fontSize: '0.7rem', fontWeight: 'bold', marginBottom: '2px', opacity: 0.7 }}>
                                                {m.senderName}
                                            </div>
                                            <div>{m.text}</div>
                                            <div style={{ fontSize: '0.6rem', textAlign: 'right', marginTop: '4px', opacity: 0.5 }}>
                                                {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </div>
                                    )
                                })}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Input Area */}
                            {activeTicket.status === 'open' ? (
                                <div style={{ padding: '0.8rem', background: '#1e1e1e', borderTop: '1px solid #333', display: 'flex', gap: '8px' }}>
                                    <input
                                        className="input-field"
                                        style={{ flex: 1, margin: 0 }}
                                        value={chatInput}
                                        onChange={e => setChatInput(e.target.value)}
                                        placeholder="Type a reply..."
                                        onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                                    />
                                    <button onClick={handleSendMessage} className="btn btn-primary" style={{ padding: '0 1rem', display: 'flex', alignItems: 'center' }}>
                                        <FaPaperPlane />
                                    </button>
                                </div>
                            ) : (
                                <div style={{ padding: '1rem', textAlign: 'center', background: '#222', color: '#777', fontStyle: 'italic' }}>
                                    This ticket is closed.
                                    {isDev && <button onClick={handleCloseTicket} style={{ marginLeft: '10px', background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline' }}>Re-open</button>}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SupportSystem;
