import React, { useState } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet's default icon path issues in React
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

interface LocationPickerProps {
    initialLat: number;
    initialLon: number;
    onPick: (lat: number, lon: number) => void;
    onCancel: () => void;
}

const LocationMarker = ({ position, setPosition }: { position: L.LatLng, setPosition: (p: L.LatLng) => void }) => {
    const map = useMap();

    useMapEvents({
        click(e) {
            setPosition(e.latlng);
            map.flyTo(e.latlng, map.getZoom());
        },
    });

    return position === null ? null : (
        <Marker position={position} />
    );
};

const LocationPicker: React.FC<LocationPickerProps> = ({ initialLat, initialLon, onPick, onCancel }) => {
    // Default to a reasonable location if 0,0 (e.g. Manchester/Beat-Herder area ~53.9, -2.3)
    // Or user's current GPS if available? For now use initial or fallback.
    const startLat = initialLat || 53.922;
    const startLon = initialLon || -2.316;

    const [position, setPosition] = useState<L.LatLng>(new L.LatLng(startLat, startLon));

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2000, background: 'rgba(0,0,0,0.8)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: '90%', height: '80%', background: 'white', borderRadius: '8px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '10px', background: '#333', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0 }}>Pick Location</h3>
                    <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'white', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
                </div>
                <div style={{ flex: 1 }}>
                    <MapContainer center={[startLat, startLon]} zoom={13} style={{ height: '100%', width: '100%' }}>
                        <TileLayer
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        />
                        <LocationMarker position={position} setPosition={setPosition} />
                    </MapContainer>
                </div>
                <div style={{ padding: '10px', background: '#f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <small>Lat: {position.lat.toFixed(6)}</small><br />
                        <small>Lon: {position.lng.toFixed(6)}</small>
                    </div>
                    <button
                        onClick={() => onPick(position.lat, position.lng)}
                        className="btn btn-primary"
                        style={{ padding: '8px 16px' }}
                    >
                        Use This Location
                    </button>
                </div>
            </div>
        </div>
    );
};

export default LocationPicker;
