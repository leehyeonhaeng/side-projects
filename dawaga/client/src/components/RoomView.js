import React, { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { theme } from '../App';

const TRANSPORT_OPTIONS = [
  { key: 'walk', label: '🚶 도보' },
  { key: 'transit', label: '🚇 대중교통' },
  { key: 'car', label: '🚗 자동차' },
];

const NUDGE_MODES = [
  { key: 'friend', label: '👫 친구' },
  { key: 'sarcastic', label: '😇 돌려까기' },
  { key: 'office', label: '💼 직장인' },
];

function RoomView({ roomData, onBack }) {
  const { roomId, userName, meetingTime } = roomData;
  const [members, setMembers] = useState({});
  const [myInfo, setMyInfo] = useState(null);
  const [isActive, setIsActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState('');
  const [transport, setTransport] = useState('walk');
  const [socketRef, setSocketRef] = useState(null);
  const [nudgeMode, setNudgeMode] = useState('friend');
  const [nudgeMessage, setNudgeMessage] = useState('');
  const [nudgeTarget, setNudgeTarget] = useState('all');
  const [nudgeLog, setNudgeLog] = useState([]);
  const [showNudge, setShowNudge] = useState(false);
  const notified30 = useRef(false);
  const notified10 = useRef(false);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    const checkActive = () => {
      const now = new Date();
      const meeting = new Date(meetingTime);
      const diff = meeting - now;
      const oneHour = 60 * 60 * 1000;
      const thirtyMin = 30 * 60 * 1000;
      const tenMin = 10 * 60 * 1000;

      setIsActive(diff <= oneHour && diff >= -oneHour);

      if (diff <= thirtyMin && diff > thirtyMin - 15000 && !notified30.current) {
        notified30.current = true;
        sendNotification('⏰ 약속 30분 전이에요!', '슬슬 준비하고 출발하세요 🏃');
      }
      if (diff <= tenMin && diff > tenMin - 15000 && !notified10.current) {
        notified10.current = true;
        sendNotification('🚨 약속 10분 전이에요!', '빨리빨리!! 서두르세요 🔥');
      }

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

  const sendNotification = (title, body) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  };

  useEffect(() => {
    if (!isActive) return;
    const s = io('http://localhost:4000');
    setSocketRef(s);
    s.emit('join_room', { roomId, userName });

    s.on('member_updated', ({ socketId, userName: name, abstractInfo, bearing, transport: t }) => {
      setMembers(prev => ({ ...prev, [socketId]: { userName: name, abstractInfo, bearing, transport: t } }));
    });
    s.on('my_info', setMyInfo);
    s.on('member_left', ({ socketId, userName: name }) => {
      setMembers(prev => { const u = { ...prev }; delete u[socketId]; return u; });
      setNudgeLog(prev => [...prev, { type: 'system', message: `${name}이 나갔어요` }]);
    });
    s.on('member_joined', ({ userName: name }) => {
      setNudgeLog(prev => [...prev, { type: 'system', message: `${name}이 들어왔어요 🎉` }]);
    });
    s.on('receive_nudge', ({ fromName, toName, message, isAll }) => {
      setNudgeLog(prev => [...prev, { type: 'nudge', fromName, toName, message, isAll }]);
      sendNotification(`📣 ${fromName}의 독촉!`, message);
    });

    const sendLocation = (t) => {
      navigator.geolocation.getCurrentPosition((pos) => {
        s.emit('update_location', { roomId, lat: pos.coords.latitude, lon: pos.coords.longitude, transport: t });
      });
    };
    sendLocation(transport);
    const locTimer = setInterval(() => sendLocation(transport), 10000);
    return () => { clearInterval(locTimer); s.disconnect(); };
  }, [isActive, roomId, userName]);

  const handleTransportChange = (t) => {
    setTransport(t);
    if (socketRef) {
      navigator.geolocation.getCurrentPosition((pos) => {
        socketRef.emit('update_location', { roomId, lat: pos.coords.latitude, lon: pos.coords.longitude, transport: t });
      });
    }
  };

  const handleGetRandomNudge = async () => {
    const res = await fetch(`http://localhost:4000/nudge/${nudgeMode}`);
    const data = await res.json();
    setNudgeMessage(data.message);
  };

  const handleSendNudge = () => {
    if (!nudgeMessage.trim() || !socketRef) return;
    const isAll = nudgeTarget === 'all';
    socketRef.emit('send_nudge', {
      roomId, fromName: userName,
      toName: isAll ? '전체' : nudgeTarget,
      message: nudgeMessage, isAll
    });
    setNudgeLog(prev => [...prev, { type: 'nudge', fromName: userName, toName: isAll ? '전체' : nudgeTarget, message: nudgeMessage, isAll, isMine: true }]);
    setNudgeMessage('');
  };

  const getTransportLabel = (t) => TRANSPORT_OPTIONS.find(o => o.key === t)?.label || '🚶 도보';

  return (
    <div style={{
      minHeight: '100vh',
      background: `linear-gradient(160deg, #FFF5EE 0%, #FFE8D6 100%)`,
      fontFamily: "'Segoe UI', sans-serif",
      padding: '24px',
      maxWidth: '420px',
      margin: '0 auto',
    }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: '15px', cursor: 'pointer', color: '#A07060', marginBottom: '8px' }}>
        ← 뒤로
      </button>

      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <p style={{ color: theme.subtext, fontSize: '13px', margin: 0 }}>방 코드</p>
        <h2 style={{ color: theme.text, fontSize: '28px', margin: '4px 0', letterSpacing: '4px', fontWeight: '800' }}>{roomId}</h2>
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
        <p style={{ margin: '8px 0 0', color: theme.accent, fontWeight: '600', fontSize: '14px' }}>{timeLeft}</p>
      </div>

      {!isActive ? (
        <div style={{ ...card('#FFE89A'), textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '15px', color: theme.text }}>⏰ 약속 1시간 전부터<br />위치 공유가 켜져요!</p>
        </div>
      ) : (
        <>
          {/* 교통수단 선택 */}
          <div style={card('#fff')}>
            <p style={{ ...subLabel, marginBottom: '10px' }}>이동 수단</p>
            <div style={{ display: 'flex', gap: '8px' }}>
              {TRANSPORT_OPTIONS.map(opt => (
                <button key={opt.key} onClick={() => handleTransportChange(opt.key)} style={{
                  flex: 1, padding: '10px 6px', borderRadius: '14px',
                  border: transport === opt.key ? `2px solid ${theme.accent}` : '2px solid #FFD6C0',
                  background: transport === opt.key ? '#FFE8D6' : '#FFF5EE',
                  cursor: 'pointer', fontSize: '12px',
                  fontWeight: transport === opt.key ? '700' : '400', color: theme.text
                }}>{opt.label}</button>
              ))}
            </div>
          </div>

          {/* 내 나침반 */}
          {myInfo && (
            <div style={{ ...card('#fff'), textAlign: 'center' }}>
              <p style={subLabel}>나의 방향</p>
              <div style={{ fontSize: '64px', display: 'inline-block', transform: `rotate(${myInfo.bearing}deg)`, transition: 'transform 0.5s ease', margin: '8px 0' }}>🧭</div>
              <p style={{ margin: '4px 0 0', fontWeight: '700', color: theme.accent, fontSize: '18px' }}>{myInfo.abstractInfo}</p>
              <p style={{ margin: '4px 0 0', color: theme.subtext, fontSize: '13px' }}>{getTransportLabel(transport)}</p>
            </div>
          )}

          {/* 멤버 현황 */}
          <h3 style={{ color: theme.text, marginBottom: '10px' }}>👥 멤버 현황</h3>
          {Object.keys(members).length === 0 ? (
            <div style={{ ...card('#FFF5EE'), textAlign: 'center' }}>
              <p style={{ color: theme.subtext, margin: 0 }}>아직 다른 멤버가 없어요 🥲</p>
            </div>
          ) : (
            Object.values(members).map((m, i) => (
              <div key={i} style={card('#fff')}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontWeight: '700', color: theme.text }}>👤 {m.userName}</span>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: theme.subtext }}>{getTransportLabel(m.transport)}</p>
                  </div>
                  <span style={{ fontSize: '32px', display: 'inline-block', transform: `rotate(${m.bearing}deg)`, transition: 'transform 0.5s ease' }}>🧭</span>
                </div>
                <p style={{ margin: '8px 0 0', color: theme.accent, fontWeight: '600' }}>{m.abstractInfo}</p>
              </div>
            ))
          )}

          {/* 독촉 메시지 */}
          <div style={card('#fff')}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <p style={subLabel}>📣 독촉 메시지</p>
              <button onClick={() => setShowNudge(!showNudge)} style={{
                background: theme.accent, color: '#fff', border: 'none',
                borderRadius: '12px', padding: '6px 12px', fontSize: '12px',
                fontWeight: '700', cursor: 'pointer'
              }}>{showNudge ? '닫기' : '보내기'}</button>
            </div>

            {showNudge && (
              <>
                {/* 모드 선택 */}
                <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                  {NUDGE_MODES.map(m => (
                    <button key={m.key} onClick={() => setNudgeMode(m.key)} style={{
                      flex: 1, padding: '8px 4px', borderRadius: '12px',
                      border: nudgeMode === m.key ? `2px solid ${theme.accent}` : '2px solid #FFD6C0',
                      background: nudgeMode === m.key ? '#FFE8D6' : '#FFF5EE',
                      cursor: 'pointer', fontSize: '11px',
                      fontWeight: nudgeMode === m.key ? '700' : '400', color: theme.text
                    }}>{m.label}</button>
                  ))}
                </div>

                {/* 대상 선택 */}
                <select value={nudgeTarget} onChange={e => setNudgeTarget(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '12px', border: '2px solid #FFD6C0', background: '#FFF5EE', marginBottom: '10px', fontSize: '14px' }}>
                  <option value="all">전체에게 보내기</option>
                  {Object.values(members).map((m, i) => (
                    <option key={i} value={m.userName}>{m.userName}에게만</option>
                  ))}
                </select>

                {/* 랜덤 메시지 */}
                <button onClick={handleGetRandomNudge} style={{
                  width: '100%', padding: '10px', borderRadius: '12px',
                  border: '2px solid #FFD6C0', background: '#FFF5EE',
                  cursor: 'pointer', fontSize: '13px', color: theme.subtext,
                  marginBottom: '8px', fontWeight: '600'
                }}>🎲 랜덤 메시지 뽑기</button>

                {/* 메시지 입력 */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input value={nudgeMessage} onChange={e => setNudgeMessage(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSendNudge()}
                    placeholder="메시지 입력 or 랜덤 뽑기"
                    style={{ flex: 1, padding: '12px', borderRadius: '12px', border: '2px solid #FFD6C0', background: '#FFF5EE', fontSize: '13px', outline: 'none' }} />
                  <button onClick={handleSendNudge} style={{
                    padding: '0 16px', background: theme.accent, color: '#fff',
                    border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: '700'
                  }}>발사 🚀</button>
                </div>
              </>
            )}

            {/* 독촉 로그 */}
            {nudgeLog.length > 0 && (
              <div style={{ marginTop: '12px', maxHeight: '150px', overflowY: 'auto' }}>
                {nudgeLog.map((log, i) => (
                  <div key={i} style={{
                    padding: '8px 10px', borderRadius: '10px', marginBottom: '6px',
                    background: log.type === 'system' ? '#FFF5EE' : log.isMine ? '#FFE89A' : '#FFD6C0',
                    fontSize: '13px', color: theme.text
                  }}>
                    {log.type === 'system' ? (
                      <span style={{ color: theme.subtext }}>{log.message}</span>
                    ) : (
                      <>
                        <span style={{ fontWeight: '700' }}>{log.fromName}</span>
                        {' → '}
                        <span style={{ fontWeight: '700' }}>{log.toName}</span>
                        <p style={{ margin: '4px 0 0' }}>{log.message}</p>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
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
  background: bg, borderRadius: '20px', padding: '18px',
  marginBottom: '14px', boxShadow: '0 2px 12px #FFB99733',
});

const subLabel = { margin: 0, fontSize: '12px', fontWeight: '700', color: '#A07060', textTransform: 'uppercase', letterSpacing: '1px' };

export default RoomView;