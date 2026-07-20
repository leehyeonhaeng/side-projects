import React, { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { theme } from '../App';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:4000';

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

function MemberDetailModal({ member, onClose }) {
  if (!member) return null;
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px'
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: '28px', padding: '28px',
        width: '100%', maxWidth: '360px',
        boxShadow: '0 8px 40px rgba(0,0,0,0.2)'
      }} onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0, color: theme.text, fontSize: '20px' }}>👤 {member.userName}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: theme.subtext }}>✕</button>
        </div>

        <div style={{ textAlign: 'center', margin: '20px 0' }}>
          {member.arrived ? (
            <div style={{ fontSize: '80px' }}>✅</div>
          ) : (
            <div style={{
              fontSize: '100px', display: 'inline-block',
              transform: `rotate(${member.bearing || 0}deg)`,
              transition: 'transform 0.5s ease',
            }}>🧭</div>
          )}
        </div>

        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          {member.arrived ? (
            <span style={{ background: '#E8F5E9', color: '#4CAF50', padding: '8px 20px', borderRadius: '20px', fontWeight: '700', fontSize: '16px' }}>
              🎉 도착 완료!
            </span>
          ) : (
            <span style={{ background: '#FFE8D6', color: theme.accent, padding: '8px 20px', borderRadius: '20px', fontWeight: '700', fontSize: '18px' }}>
              {member.abstractInfo || '위치 확인 중...'}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={detailRow}>
            <span style={detailLabel}>이동 수단</span>
            <span style={detailValue}>{TRANSPORT_OPTIONS.find(o => o.key === member.transport)?.label || '🚶 도보'}</span>
          </div>
          {member.etaMinutes !== null && member.etaMinutes !== undefined && !member.arrived && (
            <div style={detailRow}>
              <span style={detailLabel}>도착 예정</span>
              <span style={{ ...detailValue, color: theme.accent, fontWeight: '800' }}>{member.etaMinutes}분 후</span>
            </div>
          )}
          {member.distance !== undefined && !member.arrived && (
            <div style={detailRow}>
              <span style={detailLabel}>남은 거리</span>
              <span style={detailValue}>
                {member.distance < 1000
                  ? `${Math.round(member.distance)}m`
                  : `${(member.distance / 1000).toFixed(1)}km`}
              </span>
            </div>
          )}
          {member.arrived && member.lateMinutes !== undefined && (
            <div style={detailRow}>
              <span style={detailLabel}>지각비</span>
              <span style={{ ...detailValue, color: member.lateMinutes > 0 ? '#FF4444' : '#4CAF50', fontWeight: '800' }}>
                {member.lateMinutes > 0 ? `${(member.lateMinutes * 500).toLocaleString()}원 (${member.lateMinutes}분)` : '없음 👏'}
              </span>
            </div>
          )}
        </div>

        <button onClick={onClose} style={{
          width: '100%', marginTop: '20px', padding: '14px',
          background: theme.accent, color: '#fff', border: 'none',
          borderRadius: '16px', fontSize: '15px', fontWeight: '700', cursor: 'pointer'
        }}>닫기</button>
      </div>
    </div>
  );
}

const detailRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#FFF5EE', borderRadius: '12px' };
const detailLabel = { fontSize: '13px', color: '#A07060', fontWeight: '600' };
const detailValue = { fontSize: '14px', color: '#5A3E36', fontWeight: '700' };

function RoomView({ roomData, onBack }) {
  const { roomId, userName, meetingTime } = roomData;
  const [members, setMembers] = useState({});
  const [myInfo, setMyInfo] = useState(null);
  const [isActive, setIsActive] = useState(false);
  const [isPastMeeting, setIsPastMeeting] = useState(false);
  const [timeLeft, setTimeLeft] = useState('');
  const [transport, setTransport] = useState('walk');
  const [socketRef, setSocketRef] = useState(null);
  const [nudgeMode, setNudgeMode] = useState('friend');
  const [nudgeMessage, setNudgeMessage] = useState('');
  const [nudgeTarget, setNudgeTarget] = useState('all');
  const [nudgeLog, setNudgeLog] = useState([]);
  const [showNudge, setShowNudge] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [lateFees, setLateFees] = useState({});
  const [myLateFee, setMyLateFee] = useState(null);
  const [selectedMember, setSelectedMember] = useState(null);
  const notified30 = useRef(false);
  const notified10 = useRef(false);
  const lateTimer = useRef(null);
  const [lateSeconds, setLateSeconds] = useState(0);

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
      setIsPastMeeting(diff < 0);

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

  useEffect(() => {
    if (isPastMeeting && !arrived) {
      lateTimer.current = setInterval(() => {
        const now = new Date();
        const meeting = new Date(meetingTime);
        const diffSec = Math.floor((now - meeting) / 1000);
        setLateSeconds(diffSec > 0 ? diffSec : 0);
      }, 1000);
    } else {
      clearInterval(lateTimer.current);
    }
    return () => clearInterval(lateTimer.current);
  }, [isPastMeeting, arrived, meetingTime]);

  const sendNotification = (title, body) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  };

  useEffect(() => {
    if (!isActive) return;
    const s = io(SERVER_URL);
    setSocketRef(s);
    s.emit('join_room', { roomId, userName });

    s.on('existing_members', ({ members: existingMembers }) => {
      const membersMap = {};
      existingMembers.forEach(m => { membersMap[m.socketId] = m; });
      setMembers(membersMap);
    });

    s.on('member_updated', ({ socketId, userName: name, abstractInfo, bearing, transport: t, etaMinutes, distance }) => {
      setMembers(prev => ({ ...prev, [socketId]: { ...prev[socketId], userName: name, abstractInfo, bearing, transport: t, etaMinutes, distance } }));
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
      setNudgeLog(prev => [...prev, {
        type: 'nudge', fromName, toName, message, isAll,
        isMine: fromName === userName
      }]);
      if (fromName !== userName) {
        sendNotification(`📣 ${fromName}의 독촉!`, message);
      }
    });
    s.on('member_arrived', ({ socketId, userName: name, lateMinutes, lateFee }) => {
      setMembers(prev => ({
        ...prev,
        [socketId]: { ...prev[socketId], arrived: true, lateMinutes, lateFee }
      }));
      const msg = lateMinutes > 0
        ? `${name} 도착! 지각비 ${lateFee.toLocaleString()}원 💸`
        : `${name} 도착! 칼같이 왔네요 👏`;
      setNudgeLog(prev => [...prev, { type: 'system', message: msg }]);
      sendNotification('📍 멤버 도착!', msg);
    });
    s.on('latefee_updated', ({ lateFees: fees }) => setLateFees(fees));

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

  const handleArrive = () => {
    if (!socketRef || arrived) return;
    socketRef.emit('arrive', { roomId });
    setArrived(true);
    const now = new Date();
    const meeting = new Date(meetingTime);
    const lateMin = Math.max(0, Math.floor((now - meeting) / 60000));
    setMyLateFee(lateMin * 500);
  };

  const handleGetRandomNudge = async () => {
    const res = await fetch(`${SERVER_URL}/nudge/${nudgeMode}`);
    const data = await res.json();
    setNudgeMessage(data.message);
  };

  const handleSendNudge = () => {
    if (!nudgeMessage.trim() || !socketRef) return;
    const isAll = nudgeTarget === 'all';
    socketRef.emit('send_nudge', { roomId, fromName: userName, toName: isAll ? '전체' : nudgeTarget, message: nudgeMessage, isAll });
    setNudgeMessage('');
  };

  const getTransportLabel = (t) => TRANSPORT_OPTIONS.find(o => o.key === t)?.label || '🚶 도보';
  const currentLateFee = Math.floor(lateSeconds / 60) * 500;

  return (
    <div style={{
      minHeight: '100vh',
      background: `linear-gradient(160deg, #FFF5EE 0%, #FFE8D6 100%)`,
      fontFamily: "'Segoe UI', sans-serif",
      padding: '24px',
      maxWidth: '420px',
      margin: '0 auto',
    }}>
      <MemberDetailModal member={selectedMember} onClose={() => setSelectedMember(null)} />

      <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: '15px', cursor: 'pointer', color: '#A07060', marginBottom: '8px' }}>
        ← 뒤로
      </button>

      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <p style={{ color: theme.subtext, fontSize: '13px', margin: 0 }}>방 코드</p>
        <h2 style={{ color: theme.text, fontSize: '28px', margin: '4px 0', letterSpacing: '4px', fontWeight: '800' }}>{roomId}</h2>
      </div>

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
          {isPastMeeting && !arrived && (
            <div style={{ ...card('#FFD6C0'), textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: '13px', fontWeight: '700', color: theme.text }}>💸 지각비 누적 중...</p>
              <p style={{ margin: '8px 0', fontSize: '36px', fontWeight: '800', color: '#FF4444' }}>
                {currentLateFee.toLocaleString()}원
              </p>
              <p style={{ margin: '0 0 12px', fontSize: '12px', color: theme.subtext }}>
                {Math.floor(lateSeconds / 60)}분 {lateSeconds % 60}초 지각 중 · 분당 500원
              </p>
              <button onClick={handleArrive} style={{
                padding: '12px 24px', background: '#FF4444', color: '#fff',
                border: 'none', borderRadius: '16px', fontSize: '15px',
                fontWeight: '700', cursor: 'pointer'
              }}>📍 나 도착했어!</button>
            </div>
          )}

          {arrived && (
            <div style={{ ...card('#FFE89A'), textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: '20px' }}>🎉 도착 완료!</p>
              {myLateFee > 0 ? (
                <p style={{ margin: '8px 0 0', fontWeight: '700', color: '#FF4444', fontSize: '18px' }}>
                  지각비: {myLateFee.toLocaleString()}원 💸
                </p>
              ) : (
                <p style={{ margin: '8px 0 0', fontWeight: '700', color: '#4CAF50', fontSize: '16px' }}>
                  제 시간에 도착! 👏
                </p>
              )}
            </div>
          )}

          {!isPastMeeting && !arrived && (
            <div style={{ textAlign: 'center', marginBottom: '14px' }}>
              <button onClick={handleArrive} style={{
                padding: '12px 32px', background: '#4CAF50', color: '#fff',
                border: 'none', borderRadius: '16px', fontSize: '15px',
                fontWeight: '700', cursor: 'pointer', boxShadow: '0 4px 12px #4CAF5044'
              }}>📍 나 도착했어!</button>
            </div>
          )}

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

          {myInfo && (
            <div style={{ ...card('#fff'), textAlign: 'center' }}>
              <p style={subLabel}>나의 방향</p>
              <div style={{
                fontSize: '64px', display: 'inline-block',
                transform: arrived ? 'none' : `rotate(${myInfo.bearing}deg)`,
                transition: 'transform 0.5s ease', margin: '8px 0'
              }}>
                {arrived ? '✅' : '🧭'}
              </div>
              <p style={{ margin: '4px 0 0', fontWeight: '700', color: theme.accent, fontSize: '18px' }}>
                {arrived ? '도착 완료!' : myInfo.abstractInfo}
              </p>
              <p style={{ margin: '4px 0 0', color: theme.subtext, fontSize: '13px' }}>
                {getTransportLabel(transport)}
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
              <div key={i} style={{ ...card('#fff'), cursor: 'pointer' }}
                onClick={() => setSelectedMember(m)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: '700', color: theme.text }}>👤 {m.userName}</span>
                      {m.arrived && (
                        <span style={{ fontSize: '11px', background: '#E8F5E9', color: '#4CAF50', padding: '2px 8px', borderRadius: '10px', fontWeight: '700' }}>
                          ✅ 도착
                        </span>
                      )}
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: theme.subtext }}>
                      {getTransportLabel(m.transport)} · {m.abstractInfo || '위치 확인 중...'}
                    </p>
                    {lateFees[m.userName] && lateFees[m.userName].lateFee > 0 && (
                      <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#FF4444', fontWeight: '700' }}>
                        💸 {lateFees[m.userName].lateFee.toLocaleString()}원
                      </p>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      fontSize: '28px', display: 'inline-block',
                      transform: m.arrived ? 'none' : `rotate(${m.bearing || 0}deg)`,
                      transition: 'transform 0.5s ease'
                    }}>{m.arrived ? '✅' : '🧭'}</span>
                    <span style={{ fontSize: '12px', color: theme.subtext }}>›</span>
                  </div>
                </div>
              </div>
            ))
          )}

          {Object.keys(lateFees).length > 0 && (
            <div style={card('#fff')}>
              <p style={{ ...subLabel, marginBottom: '10px' }}>💸 지각비 정산 현황</p>
              {Object.entries(lateFees).map(([name, info], i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #FFE8D6' }}>
                  <span style={{ fontWeight: '700', color: theme.text }}>👤 {name}</span>
                  <span style={{ fontWeight: '700', color: info.lateFee > 0 ? '#FF4444' : '#4CAF50' }}>
                    {info.lateFee > 0 ? `${info.lateFee.toLocaleString()}원 💸` : '제 시간 👏'}
                  </span>
                </div>
              ))}
              <p style={{ margin: '10px 0 0', textAlign: 'right', fontSize: '13px', color: theme.subtext }}>
                총 지각비: <strong style={{ color: '#FF4444' }}>
                  {Object.values(lateFees).reduce((sum, f) => sum + f.lateFee, 0).toLocaleString()}원
                </strong>
              </p>
            </div>
          )}

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

                <select value={nudgeTarget} onChange={e => setNudgeTarget(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '12px', border: '2px solid #FFD6C0', background: '#FFF5EE', marginBottom: '10px', fontSize: '14px' }}>
                  <option value="all">전체에게 보내기</option>
                  {Object.values(members).map((m, i) => (
                    <option key={i} value={m.userName}>{m.userName}에게만</option>
                  ))}
                </select>

                <button onClick={handleGetRandomNudge} style={{
                  width: '100%', padding: '10px', borderRadius: '12px',
                  border: '2px solid #FFD6C0', background: '#FFF5EE',
                  cursor: 'pointer', fontSize: '13px', color: theme.subtext,
                  marginBottom: '8px', fontWeight: '600'
                }}>🎲 랜덤 메시지 뽑기</button>

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
        <p style={{ margin: '0 0 10px', fontSize: '14px', color: theme.text }}>
          친구에게 방 코드 <strong style={{ letterSpacing: '2px' }}>{roomId}</strong> 를 알려주세요 💌
        </p>
        <button onClick={() => {
          const url = `${window.location.origin}?room=${roomId}`;
          navigator.clipboard.writeText(url);
          alert('링크가 복사됐어요! 친구에게 보내주세요 🔗');
        }} style={{
          padding: '10px 20px', background: theme.accent, color: '#fff',
          border: 'none', borderRadius: '14px', fontSize: '14px',
          fontWeight: '700', cursor: 'pointer'
        }}>
          🔗 초대 링크 복사
        </button>
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