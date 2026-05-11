import { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { FaTrash, FaEdit, FaPlus } from 'react-icons/fa';

export interface Stage {
    id: string;
    name: string;
    imageUrl: string;
    order: number;
}

const DEFAULT_STAGES = [
    { name: 'Main Stage', imageUrl: '/area-logos/Main Stage.png' },
    { name: 'Working Mens Club', imageUrl: '/area-logos/Working Mens Club.png' },
    { name: 'Factory', imageUrl: '/area-logos/The Factory.png' },
    { name: 'Bushrocker Hi-Fi', imageUrl: '/area-logos/Bushrocker Hi-Fi.png' },
    { name: 'Toil Trees', imageUrl: '/area-logos/Toil Trees.png' },
    { name: 'Garage', imageUrl: '/area-logos/Garage.png' },
    { name: 'The Ring', imageUrl: '/area-logos/The Ring.png' },
    { name: 'Fortress', imageUrl: '/area-logos/Fortress.png' },
    { name: 'Sunrise', imageUrl: '/area-logos/Sunrise.png' },
    { name: 'Launderette', imageUrl: '/area-logos/Launderette.png' },
    { name: 'Bubba Gumma', imageUrl: '/area-logos/BubbaGumma.png' },
    { name: 'Smoking Tentacles', imageUrl: '/area-logos/Smoking Tentacles.png' }
];

interface StageListProps {
    userData: any; // UserData type
    onSelectStage: (stage: Stage) => void;
    showAlert: (msg: string) => void;
}

export default function StageList({ userData, onSelectStage, showAlert }: StageListProps) {
    const [stages, setStages] = useState<Stage[]>([]);
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [editingStage, setEditingStage] = useState<Stage | null>(null);
    const [newStageName, setNewStageName] = useState('');
    const [newStageUrl, setNewStageUrl] = useState('');

    const isAdmin = userData?.email?.toLowerCase() === 'z4kbrindle@gmail.com' || userData?.isDev;

    useEffect(() => {
        loadStages();
    }, []);

    const loadStages = async () => {
        try {
            const snap = await getDocs(collection(db, 'whats_on_stages'));
            if (snap.empty) {
                // Populate default stages
                const promises = DEFAULT_STAGES.map((stage, index) => 
                    addDoc(collection(db, 'whats_on_stages'), { ...stage, order: index })
                );
                await Promise.all(promises);
                // Reload after population
                const newSnap = await getDocs(collection(db, 'whats_on_stages'));
                const loaded = newSnap.docs.map(d => ({ id: d.id, ...d.data() } as Stage));
                loaded.sort((a, b) => (a.order || 0) - (b.order || 0));
                setStages(loaded);
            } else {
                const loaded = snap.docs.map(d => ({ id: d.id, ...d.data() } as Stage));
                loaded.sort((a, b) => (a.order || 0) - (b.order || 0));
                setStages(loaded);
            }
        } catch (e) {
            console.error("Error loading stages", e);
            showAlert("Failed to load stages");
        } finally {
            setLoading(false);
        }
    };

    const handleSaveStage = async () => {
        if (!newStageName || !newStageUrl) return showAlert("Please enter name and image URL");
        
        try {
            if (editingStage) {
                await updateDoc(doc(db, 'whats_on_stages', editingStage.id), {
                    name: newStageName,
                    imageUrl: newStageUrl
                });
                showAlert("Stage updated");
            } else {
                await addDoc(collection(db, 'whats_on_stages'), {
                    name: newStageName,
                    imageUrl: newStageUrl,
                    order: stages.length
                });
                showAlert("Stage added");
            }
            setIsEditing(false);
            setEditingStage(null);
            setNewStageName('');
            setNewStageUrl('');
            loadStages();
        } catch (e) {
            console.error("Error saving stage", e);
            showAlert("Error saving stage");
        }
    };

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (confirm("Are you sure you want to delete this stage?")) {
            try {
                await deleteDoc(doc(db, 'whats_on_stages', id));
                showAlert("Stage deleted");
                loadStages();
            } catch (error) {
                console.error("Error deleting stage", error);
                showAlert("Error deleting stage");
            }
        }
    };

    const handleEdit = (e: React.MouseEvent, stage: Stage) => {
        e.stopPropagation();
        setEditingStage(stage);
        setNewStageName(stage.name);
        setNewStageUrl(stage.imageUrl);
        setIsEditing(true);
    };

    if (loading) {
        return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading stages...</div>;
    }

    return (
        <div style={{ padding: '1rem', paddingBottom: '100px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {stages.map((stage) => (
                    <div 
                        key={stage.id} 
                        onClick={() => onSelectStage(stage)}
                        style={{
                            background: '#222',
                            borderRadius: '16px',
                            overflow: 'hidden',
                            cursor: 'pointer',
                            position: 'relative',
                            boxShadow: '0 8px 16px rgba(0,0,0,0.4)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            display: 'flex',
                            alignItems: 'center',
                            minHeight: '100px',
                            transition: 'transform 0.2s, background 0.2s'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#2a2a2a';
                            e.currentTarget.style.transform = 'translateY(-2px)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#222';
                            e.currentTarget.style.transform = 'translateY(0)';
                        }}
                    >
                        {/* Logo Container */}
                        <div style={{ 
                            width: '100px', 
                            height: '100px', 
                            backgroundImage: `url("${stage.imageUrl}")`, 
                            backgroundSize: 'contain', 
                            backgroundRepeat: 'no-repeat',
                            backgroundPosition: 'center',
                            marginLeft: '10px',
                            flexShrink: 0
                        }} />

                        {/* Name Container */}
                        <div style={{ 
                            flex: 1, 
                            padding: '0 1.5rem', 
                            fontSize: '1.4rem', 
                            fontWeight: '800',
                            color: 'white',
                            letterSpacing: '0.5px'
                        }}>
                            {stage.name}
                        </div>
                        {isAdmin && (
                            <div style={{ position: 'absolute', top: '4px', right: '4px', display: 'flex', gap: '4px' }}>
                                <button onClick={(e) => handleEdit(e, stage)} className="btn icon-button" style={{ background: 'rgba(0,0,0,0.6)', padding: '6px' }}><FaEdit size={12} /></button>
                                <button onClick={(e) => handleDelete(e, stage.id)} className="btn icon-button" style={{ background: 'rgba(255,0,0,0.6)', padding: '6px' }}><FaTrash size={12} /></button>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {isAdmin && (
                <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'center' }}>
                    <button onClick={() => {
                        setEditingStage(null);
                        setNewStageName('');
                        setNewStageUrl('/area-logos/default.png');
                        setIsEditing(true);
                    }} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FaPlus /> Add New Stage
                    </button>
                </div>
            )}

            {isEditing && (
                <div className="modal-overlay" onClick={() => setIsEditing(false)}>
                    <div className="modal-content card" onClick={(e) => e.stopPropagation()} style={{ flexDirection: 'column' }}>
                        <h3 style={{ marginBottom: '1rem', textAlign: 'center' }}>{editingStage ? 'Edit Stage' : 'Add New Stage'}</h3>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem' }}>Stage Name</label>
                            <input 
                                type="text" 
                                className="input-field" 
                                value={newStageName} 
                                onChange={(e) => setNewStageName(e.target.value)} 
                                style={{ width: '100%', boxSizing: 'border-box' }}
                            />
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem' }}>Image URL (e.g. /area-logos/main.png)</label>
                            <input 
                                type="text" 
                                className="input-field" 
                                value={newStageUrl} 
                                onChange={(e) => setNewStageUrl(e.target.value)} 
                                style={{ width: '100%', boxSizing: 'border-box' }}
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button onClick={handleSaveStage} className="btn btn-primary" style={{ flex: 1 }}>Save</button>
                            <button onClick={() => setIsEditing(false)} className="btn btn-secondary" style={{ flex: 1 }}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
