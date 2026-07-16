import React, { useState, useEffect, useRef } from 'react';
import { theme } from '../App';

function CreateRoom({ onCreated, onBack }) {
  const [userName, setUserName] = useState('');
  const [meetingTime, setMeetingTime] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);

  useEffect(() => {
    const initMap = () => {
      if (!mapRef.current) return;
      const options = {
        center: new window.kakao.maps.LatLng(37.5665, 126.9780),
        level: 5,
      };
      mapInstanceRef.current = new window.kakao.maps.Map(mapRef.current, options);
      setMapReady(true);
    };
    if (window.kakao && window.kakao.maps) {
      window.kakao.maps.load(initMap);
    } else {
      const checkKakao = setInterval(() => {
        if (window.kakao && window.kakao.maps) {
          clearInterval(checkKakao);
          window.kakao.maps.load(initMap);
        }
      }, 300);
      return () => clearInterval(checkKakao);
    }
  }, []);

  const handleSearch = () => {
    if (!searchKeyword.trim()) return;
    if (!mapReady) { alert('지도 로딩 중이에요 🗺️'); return; }
    const ps = new window.kakao.maps.services.Places();
    ps.keywordSearch(searchKeyword, (data, status) => {
      if (status === window.kakao.maps.services.Status.OK) {
        setSearchResults(data.slice(0, 5));
      } else {
        alert('검색 결과가 없어요 🥲');
      }
    });
  };

  const handleSelectPlace = (place) => {
    const lat = parseFloat(place.y);
    const lon = parseFloat(place.x);
    setSelectedPlace({ name: place.place_name, lat, lon, address: place.address_name });
    setSearchResults([]);
    setSearchKeyword(place.place_name);
    const position = new window.kakao.maps.LatLng(lat, lon);
    mapInstanceRef.current.setCenter(position);
    mapInstanceRef.current.setLevel(3);
    if (markerRef.current) markerRef.current.setMap(null);
    markerRef.current = new window.kakao.maps.Marker({ position, map: mapInstanceRef.current });
  };

  const handleCreate = async () => {
    if (!userName || !selectedPlace || !meetingTime) {
      alert('모든 항목을 입력해주세요 🥺');
      return;
    }
    setLoading(true);
    const roomId = Math.random().toString(36).substr(2, 6).toUpperCase();
    const res = await fetch(`${process.env.REACT_APP_SERVER_URL || 'http://localhost:4000'}/room`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId,
        destination: { lat: selectedPlace.lat, lon: selectedPlace.lon, name: selectedPlace.name },
        meetingTime
      })
    });
    const data = await res.json();
    setLoading(false);
    if (data.success) onCreated({ roomId, userName, meetingTime, destination: selectedPlace });
  };

  return (
    <div>
      <button onClick={onBack} style={backBtn}>← 뒤로</button>
      <div style={card}>
        <h2 style={{ color: theme.text, marginTop: 0 }}>✨ 새 약속 만들기</h2>
        <div style={formStyle}>
          <label style={labelStyle}>내 이름</label>
          <input value={userName} onChange={e => setUserName(e.target.value)}
            placeholder="홍길동" style={inputStyle} />

          <label style={labelStyle}>약속 장소</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input value={searchKeyword} onChange={e => setSearchKeyword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="강남역 2번 출구" style={{ ...inputStyle, flex: 1 }} />
            <button onClick={handleSearch}
              style={{ padding: '0 16px', backgroundColor: theme.peach, color: '#fff', border: 'none', borderRadius: '14px', cursor: 'pointer', fontWeight: '700' }}>
              검색
            </button>
          </div>

          {searchResults.length > 0 && (
            <div style={{ border: '2px solid #FFD6C0', borderRadius: '14px', overflow: 'hidden' }}>
              {searchResults.map((place, i) => (
                <div key={i} onClick={() => handleSelectPlace(place)}
                  style={{ padding: '12px', cursor: 'pointer', borderBottom: i < searchResults.length - 1 ? '1px solid #FFE8D6' : 'none', background: '#fff' }}>
                  <p style={{ margin: 0, fontWeight: '700', color: theme.text, fontSize: '14px' }}>{place.place_name}</p>
                  <p style={{ margin: '2px 0 0', color: theme.subtext, fontSize: '12px' }}>{place.address_name}</p>
                </div>
              ))}
            </div>
          )}

          {selectedPlace && (
            <div style={{ background: '#FFE89A', borderRadius: '12px', padding: '10px 14px' }}>
              <p style={{ margin: 0, fontSize: '13px', fontWeight: '700', color: theme.text }}>📍 {selectedPlace.name}</p>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: theme.subtext }}>{selectedPlace.address}</p>
            </div>
          )}

          <div ref={mapRef} style={{ width: '100%', height: '200px', borderRadius: '14px', overflow: 'hidden', border: '2px solid #FFD6C0' }} />
          {!mapReady && <p style={{ textAlign: 'center', color: theme.subtext, fontSize: '13px', margin: 0 }}>🗺️ 지도 로딩 중...</p>}

          <label style={labelStyle}>약속 시간</label>
          <input type="datetime-local" value={meetingTime}
            onChange={e => setMeetingTime(e.target.value)} style={inputStyle} />

          <button onClick={handleCreate} disabled={loading}
            style={{ ...actionBtn, backgroundColor: loading ? '#ccc' : theme.accent }}>
            {loading ? '생성 중... 🌀' : '약속 만들기 🎉'}
          </button>
        </div>
      </div>
    </div>
  );
}

const card = { background: '#fff', borderRadius: '24px', padding: '24px', boxShadow: '0 4px 20px #FFB99744' };
const formStyle = { display: 'flex', flexDirection: 'column', gap: '10px' };
const labelStyle = { fontSize: '13px', fontWeight: '700', color: '#A07060' };
const inputStyle = { padding: '14px', borderRadius: '14px', border: '2px solid #FFD6C0', fontSize: '15px', outline: 'none', background: '#FFF5EE' };
const actionBtn = { padding: '16px', color: '#fff', border: 'none', borderRadius: '16px', fontSize: '16px', fontWeight: '700', cursor: 'pointer', marginTop: '8px' };
const backBtn = { background: 'none', border: 'none', fontSize: '15px', cursor: 'pointer', marginBottom: '12px', color: '#A07060' };

export default CreateRoom;