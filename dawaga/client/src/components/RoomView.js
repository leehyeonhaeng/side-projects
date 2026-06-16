import React, { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { theme } from '../App';

function RoomView({ roomData, onBack }) {
  const { roomId, userName, meetingTime } = roomData;
  const [members, setMembers] = useState({});
  const [myInfo, setMyInfo] = useState(null);
  const [isActive, setIsActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const checkActive = () => {
      const now = new Date();
      const meeting = new Date(meetingTime);
      const diff = meeting - now;
      const oneHour = 60 * 60 * 1000;
      setIsActive(diff <= oneHour && diff >= -oneHour);
      if (diff > 0) {
        const h = Math.floor(diff / oneHour);
        const m = Math.floor((diff % oneHour) / 60000);
        setTimeLeft(h > 0 ? `${h}시간 ${m}분 후` : `${m}분 후`);
      } else {
        setTimeLeft(`약속 시간 ${Math.floor(Math.abs(diff) / 60000)}분 경과`);
      }
    };
    checkActive();
    const timer = setInterval(checkActive, 10000);
    return () => clearInterval(timer);
  }, [meetingTime]);

  useEffect(() => {
    if (!isActive) return;
    const s = io('http://localhost:4000');
    s.emit('join_room', { roomId, userName });
    s.on('member_updated', ({ socketId, userName: name, abstractInfo, bearing }) => {
      setMembers(prev => ({ ...prev, [socketId]: { userName: name, abstractInfo, bearing } }));
    });
    s.on('my_info', setMyInfo);
    s.on('member_left', ({ socketId }) => {
      setMembers(prev => { const u = { ...prev }; delete u[socketId]; return u; });
    });

    const sendLocation = () => {
      navigator.geolocation.getCurrentPosition((pos) => {
        s.emit('update_location', { roomId, lat: pos.coords.latitude, lon: pos.coords.longitude });
      });
    };
    sendLocation();
    const locTimer = setInterval(sendLocation, 10000);
    return () => { clearInterval(locTimer); s.disconnect(); };
  }, [isActive, roomId, userName]);

  return (
    <div style={{
      minHeight: '100vh',
      background: `linear-gradient(160deg, #FFF5EE 0%, #FFE8D6 100%)`,
      fontFamily: "'Segoe UI', sans-serif",
      padding: '24px',
      maxWidth: '420px',
      margin: '0 auto',
    }}>
      {/* 뒤로가기 */}
      <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: '15px', cursor: 'pointer', color: '#A07060', marginBottom: '8px' }}>
        ← 뒤로
      </button>

      {/* 헤더 */}
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <p style={{ color: theme.subtext, fontSize: '13px', margin: 0 }}>방 코드</p>
        <h2 style={{ color: theme.text, fontSize: '28px', margin: '4px 0', letterSpacing: '4px', fontWeight: '800' }}>
          {roomId}
        </h2>
      </div>

      {/* 약속 시간 카드 */}
      <div style={card('#fff')}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p style={subLabel}>약속 시간</p>
            <p style={{ margin: '4px 0 0', fontWeight: '700', color: theme.text }}>
              {new Date(meetingTime).toLocaleString('ko-KR')}
            </p>
          </div>
          <div style={{
            background: isActive ? '#FFE89A' : '#FFD6C0',
            borderRadius: '20px', padding: '6px 14px',
            fontSize: '13px', fontWeight: '700', color: theme.text
          }}>
            {isActive ? '🟢 활성화' : '⏸ 대기중'}
          </div>
        </div>
        <p style={{ margin: '8px 0 0', color: theme.accent, fontWeight: '600', fontSize: '14px' }}>
          {timeLeft}
        </p>
      </div>

      {!isActive ? (
        <div style={{ ...card('#FFE89A'), textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '15px', color: theme.text }}>
            ⏰ 약속 1시간 전부터<br />위치 공유가 켜져요!
          </p>
        </div>
      ) : (
        <>
          {myInfo && (
            <div style={{ ...card('#fff'), textAlign: 'center' }}>
              <p style={subLabel}>나의 방향</p>
              <div style={{
                fontSize: '64px',
                display: 'inline-block',
                transform: `rotate(${myInfo.bearing}deg)`,
                transition: 'transform 0.5s ease',
                margin: '8px 0'
              }}>
                🧭
              </div>
              <p style={{ margin: '8px 0 0', fontWeight: '700', color: theme.accent, fontSize: '18px' }}>
                {myInfo.abstractInfo}
              </p>
            </div>
          )}

          <h3 style={{ color: theme.text, marginBottom: '10px' }}>👥 멤버 현황</h3>
          {Object.keys(members).length === 0 ? (
            <div style={{ ...card('#FFF5EE'), textAlign: 'center' }}>
              <p style={{ color: theme.subtext, margin: 0 }}>아직 다른 멤버가 없어요 🥲</p>
            </div>
          ) : (
            Object.values(members).map((m, i) => (
              <div key={i} style={card('#fff')}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: '700', color: theme.text }}>👤 {m.userName}</span>
                  <span style={{
                    fontSize: '32px',
                    display: 'inline-block',
                    transform: `rotate(${m.bearing}deg)`,
                    transition: 'transform 0.5s ease'
                  }}>🧭</span>
                </div>
                <p style={{ margin: '8px 0 0', color: theme.accent, fontWeight: '600' }}>
                  {m.abstractInfo}
                </p>
              </div>
            ))
          )}
        </>
      )}

      <div style={{ ...card('#FFD6C0'), textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: '14px', color: theme.text }}>
          친구에게 방 코드 <strong style={{ letterSpacing: '2px' }}>{roomId}</strong> 를 알려주세요 💌
        </p>
      </div>
    </div>
  );
}

const card = (bg) => ({
  background: bg,
  borderRadius: '20px',
  padding: '18px',
  marginBottom: '14px',
  boxShadow: '0 2px 12px #FFB99733',
});

const subLabel = { margin: 0, fontSize: '12px', fontWeight: '700', color: '#A07060', textTransform: 'uppercase', letterSpacing: '1px' };

export default RoomView;