'use strict';
/* ────────────────────────────────────────────────
   STATE / DB SIMULATION
──────────────────────────────────────────────── */
const DB_DEFAULTS = {
  currentUser: null,
  currentRole: 'driver',
  currentPark: null,
  currentBooking: null,
  sessionActive: false,
  sessionTimer: null,
  sessionStart: null,
  sessionDuration: 0, // minutes
  bookingStep: 1,
  selectedVehicle: null,
  selectedDuration: null,
  selectedSlot: null,
  selectedBookingType: 'now',
  generatedOTP: '',
  mobileNumber: '',
  resendInterval: null,

  parks: [
    { id:'P001', name:'Anna Nagar Parking Hub', addr:'Anna Nagar Main Rd', city:'Madurai', total:40, available:28, price:30, dailyPrice:200, dist:0.8, amenities:['cctv','security','ev','prebook'], ev:true, hours:'6:00 AM – 11:00 PM', rating:4.5, reviews:18, emoji:'🏢', color:'#10b981' },
    { id:'P002', name:'Race Course Complex', addr:'Race Course Road', city:'Madurai', total:20, available:7, price:20, dailyPrice:150, dist:1.5, amenities:['cctv','covered'], ev:false, hours:'24 Hours', rating:4.2, reviews:31, emoji:'🅿️', color:'#f59e0b' },
    { id:'P003', name:'Meenakshi Temple Parking', addr:'South Veli Street', city:'Madurai', total:60, available:0, price:25, dailyPrice:180, dist:1.2, amenities:['cctv','security','wheelchair'], ev:false, hours:'5:00 AM – 10:00 PM', rating:4.7, reviews:52, emoji:'🛕', color:'#ef4444' },
    { id:'P004', name:'Bypass EV Park', addr:'Madurai Bypass Rd', city:'Madurai', total:30, available:22, price:40, dailyPrice:280, dist:3.1, amenities:['cctv','security','ev','covered','wheelchair','prebook'], ev:true, hours:'24 Hours', rating:4.8, reviews:9, emoji:'⚡', color:'#8b5cf6' },
    { id:'P005', name:'Town Hall Multi-Level', addr:'West Veli Street', city:'Madurai', total:80, available:35, price:35, dailyPrice:220, dist:2.0, amenities:['cctv','security','covered','prebook','wheelchair'], ev:false, hours:'6:00 AM – 10:00 PM', rating:4.3, reviews:44, emoji:'🏛️', color:'#10b981' }
  ],

  vehicles: [
    { id:'V001', type:'car', name:'Honda City', reg:'TN 59 AB 1234', icon:'🚗' },
    { id:'V002', type:'bike', name:'Royal Enfield', reg:'TN 59 CD 5678', icon:'🏍️' },
    { id:'V003', type:'ev', name:'Tata Nexon EV', reg:'TN 59 EV 9999', icon:'⚡🚗' }
  ],

  bookings: [
    { id:'BKG-001', parkId:'P001', parkName:'Anna Nagar Parking Hub', slot:'A-12', vehicle:'TN 59 AB 1234', type:'car', start:'09:00 AM', end:'11:00 AM', duration:'2 hrs', amount:60, status:'active', date:'Today' },
    { id:'BKG-002', parkId:'P004', parkName:'Bypass EV Park', slot:'EV-03', vehicle:'TN 59 EV 9999', type:'ev', start:'02:00 PM', end:'04:00 PM', duration:'2 hrs', amount:80, status:'upcoming', date:'Today' },
    { id:'BKG-003', parkId:'P002', parkName:'Race Course Complex', slot:'B-07', vehicle:'TN 59 AB 1234', type:'car', start:'10:00 AM', end:'12:00 PM', duration:'2 hrs', amount:40, status:'completed', date:'Yesterday' },
    { id:'BKG-004', parkId:'P001', parkName:'Anna Nagar Parking Hub', slot:'A-08', vehicle:'TN 59 CD 5678', type:'bike', start:'03:00 PM', end:'05:00 PM', duration:'2 hrs', amount:20, status:'completed', date:'2 days ago' }
  ],
  walletBalance: 250
};

let DB = { ...DB_DEFAULTS };

async function initDB() {
  try {
    const res = await fetch('http://localhost:5000/api/sync');
    if (res.ok) {
      const data = await res.json();
      if (data.bookings || data.vehicles) {
        DB = { ...DB, ...data };
      }
    }
  } catch (e) {
    console.log("Backend not reachable, falling back to localStorage");
    const saved = localStorage.getItem('parklink_db');
    if (saved) {
      try { DB = { ...DB, ...JSON.parse(saved) }; } catch(err) {}
    }
  }
  
  DB.sessionTimer = null;
  DB.resendInterval = null;
  
  // Refresh UI if home is active
  if (document.getElementById('home').classList.contains('active')) {
    initHome();
  }
}

function saveDB() {
  const toSave = { ...DB };
  toSave.sessionTimer = null;
  toSave.resendInterval = null;
  
  // Save locally as backup
  localStorage.setItem('parklink_db', JSON.stringify(toSave));
  
  // Sync to backend
  fetch('http://localhost:5000/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toSave)
  }).catch(() => {}); // ignore network errors if backend is down
}

initDB();

// Auto-save DB every 2 seconds to persist state changes everywhere
setInterval(saveDB, 2000);

/* ────────────────────────────────────────────────
   MAP MARKER POSITIONS (% of container)
──────────────────────────────────────────────── */
const MARKER_POS = {
  P001: { x: 28, y: 22 },
  P002: { x: 55, y: 38 },
  P003: { x: 42, y: 55 },
  P004: { x: 72, y: 65 },
  P005: { x: 35, y: 72 }
};

/* ────────────────────────────────────────────────
   NAVIGATION
──────────────────────────────────────────────── */
let screenHistory = [];

function goTo(id, anim='anim-in') {
  const prev = document.querySelector('.screen.active');
  const next = document.getElementById(id);
  if (!next || prev === next) return;
  if (prev) prev.classList.remove('active');
  next.classList.remove('anim-in','anim-back');
  next.classList.add('active');
  requestAnimationFrame(() => next.classList.add(anim));
  screenHistory.push(id);
  // Init screens
  if (id === 'home') initHome();
  if (id === 'bookings') initBookings('active');
  if (id === 'owner') initOwner();
  if (id === 'admin') initAdmin();
  if (id === 'qr-ticket') initQRTicket();
}

function goBack() {
  screenHistory.pop();
  const prev = screenHistory[screenHistory.length-1] || 'home';
  const curr = document.querySelector('.screen.active');
  const target = document.getElementById(prev);
  if (curr) curr.classList.remove('active');
  target.classList.remove('anim-in','anim-back');
  target.classList.add('active');
  requestAnimationFrame(() => target.classList.add('anim-back'));
  if (prev === 'home') initHome();
}

/* ────────────────────────────────────────────────
   TOAST SYSTEM
──────────────────────────────────────────────── */
function toast(msg, type='info', icon='ℹ️') {
  const wrap = document.getElementById('toastWrap');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<div class="toast-icon">${icon}</div><div>${msg}</div>`;
  wrap.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 250);
  }, 3200);
}

/* ────────────────────────────────────────────────
   LOADER
──────────────────────────────────────────────── */
function showLoader(text='Please wait…') {
  document.getElementById('loaderText').textContent = text;
  document.getElementById('globalLoader').classList.remove('hidden');
}
function hideLoader() {
  document.getElementById('globalLoader').classList.add('hidden');
}

/* ────────────────────────────────────────────────
   MODALS
──────────────────────────────────────────────── */
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

/* ────────────────────────────────────────────────
   SPLASH → ONBOARDING
──────────────────────────────────────────────── */
let obCurrent = 0;
setTimeout(() => goTo('onboarding'), 2600);

function obNextSlide() {
  const wrap = document.getElementById('obWrap');
  if (obCurrent < 2) {
    obCurrent++;
    wrap.scrollTo({ left: obCurrent * wrap.offsetWidth, behavior:'smooth' });
    document.querySelectorAll('.ob-dot').forEach((d,i) => d.classList.toggle('active', i===obCurrent));
    if (obCurrent === 2) document.getElementById('obNext').textContent = 'Get Started →';
  } else {
    goTo('login');
  }
}

/* ────────────────────────────────────────────────
   LOGIN / AUTH BACKEND SIMULATION
──────────────────────────────────────────────── */
function setRole(role, btn) {
  DB.currentRole = role;
  document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function googleLogin() {
  showLoader('Connecting to Google…');
  setTimeout(() => {
    hideLoader();
    const names = ['Arun Kumar','Priya Nair','Ramesh S','Kavitha M'];
    DB.currentUser = { name: names[Math.floor(Math.random()*names.length)], phone:'+91 98765 43210', method:'google' };
    toast('Google login successful!', 'success', '✅');
    routeByRole();
  }, 1800);
}

function appleLogin() {
  showLoader('Connecting to Apple…');
  setTimeout(() => {
    hideLoader();
    DB.currentUser = { name:'User', phone:'', method:'apple' };
    toast('Apple login successful!', 'success', '✅');
    routeByRole();
  }, 1800);
}

async function sendOTP() {
  const num = document.getElementById('mobileInput').value.trim();
  if (!/^\d{10}$/.test(num)) { toast('Enter a valid 10-digit mobile number','error','❌'); return; }
  DB.mobileNumber = num;
  showLoader('Sending OTP…');

  try {
    const res = await fetch('http://localhost:5000/api/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: num })
    });
    const data = await res.json();
    hideLoader();

    if (res.ok) {
      document.getElementById('loginStep1').classList.add('hidden');
      document.getElementById('loginStep2').classList.remove('hidden');
      document.getElementById('otpSentMsg').textContent = `OTP sent to +91 ${num.slice(0,3)}****${num.slice(7)}`;
      toast(`OTP sent to +91 ${num}! Check your terminal console.`, 'success', '📱');
      document.querySelectorAll('.otp-box')[0].focus();
      startResendTimer();
    } else {
      toast(data.error || 'Failed to send OTP', 'error', '❌');
    }
  } catch (err) {
    hideLoader();
    // Fallback to client-side OTP if server is unreachable
    DB.generatedOTP = Math.floor(100000 + Math.random()*900000).toString();
    document.getElementById('loginStep1').classList.add('hidden');
    document.getElementById('loginStep2').classList.remove('hidden');
    document.getElementById('otpSentMsg').textContent = `OTP sent to +91 ${num.slice(0,3)}****${num.slice(7)}`;
    toast(`OTP: ${DB.generatedOTP} (Offline mode)`, 'info', '📱');
    document.querySelectorAll('.otp-box')[0].focus();
    startResendTimer();
  }
}

async function verifyOTP() {
  const boxes = document.querySelectorAll('.otp-box');
  const entered = Array.from(boxes).map(b=>b.value).join('');
  if (entered.length < 6) { toast('Enter complete 6-digit OTP','warn','⚠️'); return; }
  showLoader('Verifying OTP…');

  try {
    const res = await fetch('http://localhost:5000/api/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: DB.mobileNumber, otp: entered })
    });
    const data = await res.json();
    hideLoader();

    if (res.ok) {
      document.getElementById('otpError').classList.add('hidden');
      boxes.forEach(b => b.classList.add('filled'));
      DB.currentUser = { name: 'Arun Kumar', phone:`+91 ${DB.mobileNumber}`, method:'otp' };
      toast('OTP verified successfully!','success','✅');
      setTimeout(() => routeByRole(), 700);
    } else {
      document.getElementById('otpError').classList.remove('hidden');
      boxes.forEach(b => { b.value=''; b.classList.remove('filled'); });
      boxes[0].focus();
      toast(data.error || 'Wrong OTP. Try again','error','❌');
    }
  } catch (err) {
    hideLoader();
    // Fallback to client-side verification
    if (DB.generatedOTP && entered === DB.generatedOTP) {
      document.getElementById('otpError').classList.add('hidden');
      boxes.forEach(b => b.classList.add('filled'));
      DB.currentUser = { name: 'Arun Kumar', phone:`+91 ${DB.mobileNumber}`, method:'otp' };
      toast('OTP verified successfully!','success','✅');
      setTimeout(() => routeByRole(), 700);
    } else {
      document.getElementById('otpError').classList.remove('hidden');
      boxes.forEach(b => { b.value=''; b.classList.remove('filled'); });
      boxes[0].focus();
      toast('Wrong OTP. Try again','error','❌');
    }
  }
}

function routeByRole() {
  if (DB.currentRole === 'owner') { goTo('owner','anim-in'); return; }
  if (DB.currentRole === 'admin') { goTo('admin','anim-in'); return; }
  goTo('home','anim-in');
  updateProfileUI();
}

function startResendTimer() {
  clearInterval(DB.resendInterval);
  let secs = 30;
  document.getElementById('resendCount').textContent = secs;
  document.getElementById('resendTimer').classList.remove('hidden');
  document.getElementById('resendBtn').classList.add('hidden');
  DB.resendInterval = setInterval(() => {
    secs--;
    document.getElementById('resendCount').textContent = secs;
    if (secs <= 0) {
      clearInterval(DB.resendInterval);
      document.getElementById('resendTimer').classList.add('hidden');
      document.getElementById('resendBtn').classList.remove('hidden');
    }
  }, 1000);
}

async function resendOTP() {
  showLoader('Resending OTP…');
  try {
    const res = await fetch('http://localhost:5000/api/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: DB.mobileNumber })
    });
    hideLoader();
    if (res.ok) {
      toast('New OTP sent! Check your terminal console.', 'success', '📱');
    } else {
      toast('Failed to resend OTP', 'error', '❌');
    }
  } catch (err) {
    hideLoader();
    DB.generatedOTP = Math.floor(100000 + Math.random()*900000).toString();
    toast(`New OTP: ${DB.generatedOTP} (Offline)`, 'info', '📱');
  }
  startResendTimer();
  document.querySelectorAll('.otp-box').forEach(b => { b.value=''; b.classList.remove('filled'); });
  document.getElementById('otpError').classList.add('hidden');
}

function backToMobile() {
  document.getElementById('loginStep2').classList.add('hidden');
  document.getElementById('loginStep1').classList.remove('hidden');
  clearInterval(DB.resendInterval);
}

function otpMove(el, idx) {
  if (el.value.length >= 1) {
    el.classList.add('filled');
    const boxes = document.querySelectorAll('.otp-box');
    if (idx < 5) boxes[idx+1].focus();
    else verifyOTP();
  }
}

function otpBack(e, idx) {
  if (e.key === 'Backspace') {
    const boxes = document.querySelectorAll('.otp-box');
    boxes[idx].value = '';
    boxes[idx].classList.remove('filled');
    if (idx > 0) boxes[idx-1].focus();
  }
}

function signOut() {
  DB.currentUser = null;
  DB.sessionActive = false;
  if (DB.sessionTimer) clearInterval(DB.sessionTimer);
  // Reset login
  document.getElementById('loginStep1').classList.remove('hidden');
  document.getElementById('loginStep2').classList.add('hidden');
  document.getElementById('mobileInput').value = '';
  document.querySelectorAll('.otp-box').forEach(b=>b.value='');
  goTo('login','anim-in');
  toast('Signed out successfully','info','👋');
}

/* ────────────────────────────────────────────────
   HOME — MAP & LIST
──────────────────────────────────────────────── */
let mapInterval = null;

function initHome() {
  const user = DB.currentUser;
  if (user) {
    document.getElementById('homeUserName').textContent = (user.name || 'User') + ' 👋';
    document.getElementById('homeAvatar').textContent = (user.name||'U')[0].toUpperCase();
  }
  renderMapMarkers();
  renderParkList(DB.parks);
  if (!mapInterval) {
    mapInterval = setInterval(() => {
      DB.parks.forEach(p => {
        if (p.available > 0) {
          const delta = (Math.random() > 0.5 ? 1 : -1);
          p.available = Math.max(0, Math.min(p.total, p.available + delta));
        }
      });
      renderMapMarkers();
      renderParkList(DB.parks);
    }, 8000);
  }
}

function getParkColor(p) {
  if (p.ev && p.amenities.includes('ev')) return 'ev';
  if (p.available === 0) return 'red';
  if (p.available / p.total < 0.3) return 'amber';
  return 'green';
}

function renderMapMarkers() {
  const container = document.getElementById('mapMarkers');
  if (!container) return;
  container.innerHTML = '';
  // Only show approved parks on the map
  const activeParks = DB.parks.filter(p => p.status !== 'pending');
  activeParks.forEach(p => {
    const pos = MARKER_POS[p.id] || { x:50, y:50 };
    const cls = getParkColor(p);
    const label = p.ev ? '⚡' : (p.available === 0 ? '🔴' : p.available <= 5 ? '🟡' : '🟢');
    const div = document.createElement('div');
    div.className = `map-marker marker-${cls}`;
    div.style.cssText = `left:${pos.x}%;top:${pos.y}%;`;
    div.innerHTML = `<div class="marker-pin">${label} ${p.available}</div>`;
    div.onclick = (e) => { e.stopPropagation(); showMapPopup(p, pos); };
    container.appendChild(div);
  });
}

function showMapPopup(park, pos) {
  const popup = document.getElementById('mapPopup');
  const cls = getParkColor(park);
  const clsColor = cls === 'green' ? 'badge-green' : cls === 'amber' ? 'badge-amber' : cls === 'red' ? 'badge-red' : 'badge-ev';
  popup.innerHTML = `
    <button class="map-popup-close" onclick="document.getElementById('mapPopup').classList.add('hidden')">✕</button>
    <div style="font-size:15px;font-weight:700;margin-bottom:4px;padding-right:20px">${park.name}</div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">${park.addr}</div>
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <span class="badge ${clsColor}">${park.available} slots</span>
      <span class="badge badge-blue">₹${park.price}/hr</span>
      ${park.ev ? '<span class="badge badge-ev">⚡ EV</span>' : ''}
    </div>
    <button class="btn btn-primary btn-sm" style="width:100%" onclick="openParkDetail('${park.id}')">Book Now →</button>
  `;
  popup.style.left = `${Math.min(pos.x, 65)}%`;
  popup.style.top = `${Math.max(pos.y - 40, 10)}%`;
  popup.classList.remove('hidden');
}

function renderParkList(parks) {
  const el = document.getElementById('parkList');
  if (!el) return;
  // Only show approved parks in the list
  const activeParks = parks.filter(p => p.status !== 'pending');
  el.innerHTML = activeParks.map(p => {
    const cls = getParkColor(p);
    const clsBadge = cls === 'green' ? 'badge-green' : cls === 'amber' ? 'badge-amber' : cls === 'red' ? 'badge-red' : 'badge-ev';
    const fillPct = Math.round((1 - p.available/p.total)*100);
    const fillColor = p.available===0 ? 'var(--red)' : p.available/p.total < 0.3 ? 'var(--amber)' : 'var(--green)';
    return `
    <div class="park-card" onclick="openParkDetail('${p.id}')">
      <div class="park-card-top">
        <div class="park-icon" style="background:${p.color}20">${p.emoji}</div>
        <div class="park-info">
          <div class="park-name">${p.name}</div>
          <div class="park-addr">📍 ${p.addr} · ${p.dist} km</div>
          <div class="park-badges">
            <span class="badge ${clsBadge}">${p.available > 0 ? p.available+' free' : 'Full'}</span>
            <span class="badge badge-blue">₹${p.price}/hr</span>
            ${p.ev ? '<span class="badge badge-ev">⚡ EV</span>' : ''}
            ${p.amenities.includes('cctv') ? '<span class="badge" style="background:#f0f4ff;color:#64748b">📹 CCTV</span>' : ''}
          </div>
        </div>
      </div>
      <div class="slot-bar"><div class="slot-fill" style="width:${fillPct}%;background:${fillColor}"></div></div>
      <div class="park-stats">
        <div class="park-stat"><div class="park-stat-val">${p.available}</div><div class="park-stat-lbl">Available</div></div>
        <div class="park-stat"><div class="park-stat-val">${p.total}</div><div class="park-stat-lbl">Total</div></div>
        <div class="park-stat"><div class="park-stat-val">₹${p.price}</div><div class="park-stat-lbl">Per Hour</div></div>
        <div class="park-stat"><div class="park-stat-val">⭐${p.rating}</div><div class="park-stat-lbl">Rating</div></div>
      </div>
    </div>`;
  }).join('');
}

function switchView(view) {
  document.getElementById('mapView').classList.toggle('hidden', view !== 'map');
  document.getElementById('listView').classList.toggle('hidden', view !== 'list');
  document.getElementById('mapViewBtn').classList.toggle('active', view === 'map');
  document.getElementById('listViewBtn').classList.toggle('active', view === 'list');
}

function filterParks(type, el) {
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  let filtered = [...DB.parks];
  if (type === 'nearest') filtered.sort((a,b) => a.dist - b.dist);
  else if (type === 'cheapest') filtered.sort((a,b) => a.price - b.price);
  else if (type === 'available') filtered = filtered.filter(p => p.available > 0);
  else if (type === 'ev') filtered = filtered.filter(p => p.ev);
  else if (type === 'cctv') filtered = filtered.filter(p => p.amenities.includes('cctv'));
  renderParkList(filtered);
}

function onSearch(val) {
  if (val.length < 2) { renderParkList(DB.parks); return; }
  const filtered = DB.parks.filter(p =>
    p.name.toLowerCase().includes(val.toLowerCase()) ||
    p.addr.toLowerCase().includes(val.toLowerCase())
  );
  renderParkList(filtered);
}

function doSearch() {
  const val = document.getElementById('searchInput').value.trim();
  if (!val) { toast('Enter a location to search','warn','🔍'); return; }
  showLoader(`Finding parking near "${val}"…`);
  setTimeout(() => {
    hideLoader();
    switchView('list');
    onSearch(val);
    toast(`Showing results near ${val}`,'success','📍');
  }, 1200);
}

function centerMap() {
  toast('Centering on your location…','info','📍');
  const markers = document.getElementById('mapMarkers');
  if (markers) { markers.style.animation='none'; setTimeout(()=>markers.style.animation='', 100); }
}

/* ────────────────────────────────────────────────
   PARK DETAIL
──────────────────────────────────────────────── */
function openParkDetail(parkId) {
  DB.currentPark = DB.parks.find(p => p.id === parkId);
  if (!DB.currentPark) return;
  const p = DB.currentPark;
  document.getElementById('detailName').textContent = p.name;
  document.getElementById('detailAddr').textContent = p.addr + ', ' + p.city;
  document.getElementById('detailEmoji').textContent = p.emoji;
  document.getElementById('detailHero').style.background = `linear-gradient(135deg, ${p.color}88, ${p.color})`;
  document.getElementById('dStatAvail').textContent = p.available;
  document.getElementById('dStatTotal').textContent = p.total;
  document.getElementById('dStatPrice').textContent = '₹'+p.price;
  document.getElementById('dStatDist').textContent = p.dist;

  const amenityMap = { cctv:'📹 CCTV', security:'👮 Security', ev:'⚡ EV Charging', covered:'🏠 Covered', wheelchair:'♿ Accessible', prebook:'📅 Pre-book' };
  const grid = document.getElementById('amenityGrid');
  grid.innerHTML = Object.entries(amenityMap).map(([k,v]) => {
    const has = p.amenities.includes(k);
    return `<div class="amenity-item" style="${has?'':'opacity:0.4'}"><span>${v}</span>${has?'<span style="margin-left:auto;color:var(--green);font-size:12px;font-weight:700">✓</span>':''}</div>`;
  }).join('');

  document.getElementById('hoursInfo').innerHTML = `
    <div class="row justify-between mt8"><span>Mon – Sat</span><span class="fw-700">${p.hours}</span></div>
    <div class="row justify-between mt8"><span>Sunday</span><span class="fw-700">${p.hours === '24 Hours' ? '24 Hours' : '8:00 AM – 9:00 PM'}</span></div>
  `;

  const reviews = [
    { name:'Arun K', stars:5, text:'Great parking facility, well maintained and easy to find.' },
    { name:'Priya M', stars:4, text:'Convenient location but can get crowded on weekends.' },
    { name:'Ramesh S', stars:5, text:'EV charging worked perfectly. Highly recommended!' }
  ].slice(0, 2);
  document.getElementById('reviewsList').innerHTML = reviews.map(r => `
    <div class="review-item">
      <div class="review-header">
        <div class="review-avatar">${r.name[0]}</div>
        <div><div style="font-size:13px;font-weight:700">${r.name}</div><div class="review-stars">${'★'.repeat(r.stars)}${'☆'.repeat(5-r.stars)}</div></div>
      </div>
      <div class="review-text">${r.text}</div>
    </div>`).join('');

  // Close popup if open
  document.getElementById('mapPopup')?.classList.add('hidden');
  goTo('detail','anim-in');
}

function navigate() {
  const p = DB.currentPark;
  toast(`Opening maps for ${p ? p.name : 'parking'}…`, 'info', '🧭');
  if (p) {
    const query = encodeURIComponent(`${p.name}, ${p.addr}, ${p.city}`);
    window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, '_blank');
  }
}

/* ────────────────────────────────────────────────
   BOOKING FLOW
──────────────────────────────────────────────── */
function startBooking() {
  const p = DB.currentPark;
  if (!p) return;
  if (p.available === 0) { toast('No slots available at this location','error','❌'); return; }
  DB.bookingStep = 1;
  DB.selectedVehicle = null;
  DB.selectedDuration = null;
  DB.selectedSlot = null;
  DB.selectedBookingType = 'now';
  renderBookingStep(1);
  goTo('booking','anim-in');
}

function renderBookingStep(step) {
  // Update step bar
  [1,2,3].forEach(i => {
    const el = document.getElementById(`step-${i}`);
    el.classList.remove('active','done');
    if (i < step) el.classList.add('done');
    if (i === step) el.classList.add('active');
    if (i < step) el.querySelector('.step-num').textContent = '✓';
    else el.querySelector('.step-num').textContent = i;
  });

  const body = document.getElementById('bookingBody');
  const p = DB.currentPark;

  if (step === 1) {
    body.innerHTML = `
      <div style="font-size:18px;font-weight:800;margin-bottom:4px">Select Vehicle</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Booking for ${p.name}</div>
      <div class="vehicle-select" id="vehicleSelect">
        ${DB.vehicles.map(v => `
          <div class="vehicle-card ${v.type === 'ev' && !p.ev ? 'hidden' : ''}" onclick="selectVehicle('${v.id}',this)" id="vcard-${v.id}">
            <div class="vehicle-icon">${v.icon}</div>
            <div class="vehicle-info"><div class="vehicle-name">${v.name}</div><div class="vehicle-reg">${v.reg}</div></div>
            <div class="vehicle-radio"></div>
          </div>`).join('')}
      </div>
      <button class="btn" style="margin-top:12px;background:var(--surface);color:var(--blue);font-weight:700" onclick="openModal('addVehicleModal')">+ Add New Vehicle</button>`;
  }

  if (step === 2) {
    body.innerHTML = `
      <div style="font-size:18px;font-weight:800;margin-bottom:4px">Booking Type & Duration</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px">How long will you park?</div>
      <div class="booking-type-tabs">
        <div class="btype-tab active" onclick="setBType('now',this)" id="bt-now"><div class="btype-icon">🚀</div><div class="btype-lbl">Park Now</div></div>
        <div class="btype-tab" onclick="setBType('prebook',this)" id="bt-prebook"><div class="btype-icon">📅</div><div class="btype-lbl">Pre-book</div></div>
        <div class="btype-tab" onclick="setBType('daily',this)" id="bt-daily"><div class="btype-icon">🌙</div><div class="btype-lbl">Daily Pass</div></div>
      </div>
      <div style="font-size:15px;font-weight:700;margin-bottom:12px" id="durLabel">Select Duration</div>
      <div class="duration-grid" id="durGrid">
        ${['30 min','1 hr','2 hrs','3 hrs','4 hrs','8 hrs'].map(d => `
          <div class="dur-btn" onclick="selectDuration('${d}',this)">${d}</div>`).join('')}
      </div>
      <div style="margin-top:16px">
        <div style="font-size:14px;font-weight:700;margin-bottom:8px">Select Slot</div>
        <button class="btn" style="background:var(--blue-light);color:var(--blue);font-weight:700;border:none" onclick="openSlotPicker()">
          ${DB.selectedSlot ? `✅ ${DB.selectedSlot} Selected — Change` : '🅿️ Choose a Slot'}
        </button>
      </div>`;
  }

  if (step === 3) {
    const v = DB.vehicles.find(v2 => v2.id === DB.selectedVehicle);
    const dur = DB.selectedDuration || '1 hr';
    const hrs = parseFloat(dur) || (dur.includes('30') ? 0.5 : 1);
    const total = DB.selectedBookingType === 'daily' ? p.dailyPrice : Math.round(p.price * hrs);
    DB.currentBooking = {
      id: 'BKG-' + Date.now(),
      parkId: p.id, parkName: p.name, parkAddr: p.addr,
      slot: DB.selectedSlot || autoAssignSlot(),
      vehicle: v ? v.reg : 'Unknown',
      vehicleType: v ? v.type : 'car',
      duration: dur, amount: total,
      start: new Date(), status: 'upcoming',
      durationMins: DB.selectedBookingType === 'daily' ? 1440 : Math.round(hrs * 60)
    };
    const startTime = new Date(); 
    const endTime = new Date(startTime.getTime() + DB.currentBooking.durationMins * 60000);
    const fmtTime = (d) => d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
    body.innerHTML = `
      <div style="font-size:18px;font-weight:800;margin-bottom:4px">Booking Summary</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Review your booking details</div>
      <div class="booking-summary">
        <div class="bsum-row"><span class="bsum-lbl">Parking</span><span class="bsum-val">${p.name}</span></div>
        <div class="bsum-row"><span class="bsum-lbl">Slot</span><span class="bsum-val">🅿️ ${DB.currentBooking.slot}</span></div>
        <div class="bsum-row"><span class="bsum-lbl">Vehicle</span><span class="bsum-val">${DB.currentBooking.vehicle}</span></div>
        <div class="bsum-row"><span class="bsum-lbl">Entry</span><span class="bsum-val">${fmtTime(startTime)}</span></div>
        <div class="bsum-row"><span class="bsum-lbl">Exit</span><span class="bsum-val">${fmtTime(endTime)}</span></div>
        <div class="bsum-row"><span class="bsum-lbl">Duration</span><span class="bsum-val">${dur}</span></div>
        <div class="bsum-row bsum-total"><span class="bsum-lbl">Total</span><span class="bsum-val">₹${total}</span></div>
      </div>
      <div style="margin-top:14px;padding:14px;background:var(--surface);border-radius:12px;font-size:14px">
        <div style="font-weight:700;margin-bottom:8px">Payment Method</div>
        <label style="display:flex;align-items:center;gap:10px;margin-bottom:10px;cursor:pointer">
          <input type="radio" name="payMethod" value="wallet" checked style="accent-color:var(--blue);width:18px;height:18px">
          <span style="flex:1">ParkLink Wallet</span>
          <span style="font-weight:700;color:${(DB.walletBalance||0) >= total ? 'var(--green)' : 'var(--red)'}">₹${DB.walletBalance||0}</span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <input type="radio" name="payMethod" value="arrival" style="accent-color:var(--blue);width:18px;height:18px">
          <span style="flex:1;color:var(--text-muted)">Pay on Arrival</span>
        </label>
      </div>`;
    document.getElementById('bookingNextBtn').textContent = '✅ Confirm Booking';
  }
}

function selectVehicle(id, el) {
  document.querySelectorAll('.vehicle-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  DB.selectedVehicle = id;
}

function submitNewVehicle() {
  const type = document.getElementById('newVehicleType').value;
  const name = document.getElementById('newVehicleName').value.trim();
  const reg = document.getElementById('newVehicleReg').value.trim();
  if (!name || !reg) { toast('Please enter vehicle name and registration number', 'warn', '⚠️'); return; }
  
  const iconMap = { car: '🚗', bike: '🏍️', ev: '⚡🚗' };
  const newV = {
    id: 'V' + Date.now(),
    type: type,
    name: name,
    reg: reg.toUpperCase(),
    icon: iconMap[type] || '🚗'
  };
  
  DB.vehicles.push(newV);
  closeModal('addVehicleModal');
  toast('Vehicle added successfully!', 'success', '✅');
  
  // Clear modal inputs
  document.getElementById('newVehicleName').value = '';
  document.getElementById('newVehicleReg').value = '';
  
  // If we are currently in booking step 1, re-render it
  if (DB.bookingStep === 1) renderBookingStep(1);
  
  // Re-render vehicle modal if it's open
  if (document.getElementById('vehicleModal').classList.contains('open')) openVehicleModal();
}

function openVehicleModal() {
  const list = document.getElementById('vehicleModalList');
  if (DB.vehicles.length === 0) {
    list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted)">No vehicles added yet</div>`;
  } else {
    list.innerHTML = DB.vehicles.map(v => `
      <div class="card mb12" style="display:flex;align-items:center;gap:12px">
        <div style="font-size:24px;width:40px;height:40px;background:var(--surface);border-radius:50%;display:flex;align-items:center;justify-content:center">${v.icon}</div>
        <div style="flex:1">
          <div style="font-size:15px;font-weight:700">${v.name}</div>
          <div style="font-size:12px;color:var(--text-muted);font-weight:600">${v.reg}</div>
        </div>
      </div>
    `).join('');
  }
  openModal('vehicleModal');
}

function openSettings(title) {
  document.getElementById('settingsModalTitle').innerText = title || '⚙️ Settings';
  openModal('settingsModal');
}

function openWallet() {
  document.getElementById('walletBalanceDisplay').innerText = '₹' + (DB.walletBalance || 0);
  document.getElementById('addMoneyInput').value = '';
  openModal('walletModal');
}

function addMoney() {
  const amt = parseInt(document.getElementById('addMoneyInput').value);
  if (!amt || amt <= 0) { toast('Please enter a valid amount', 'warn', '⚠️'); return; }
  
  DB.walletBalance = (DB.walletBalance || 0) + amt;
  document.getElementById('walletBalanceDisplay').innerText = '₹' + DB.walletBalance;
  
  // Update Profile Badge
  const badge = document.getElementById('profileWalletBadge');
  if (badge) badge.innerText = '₹' + DB.walletBalance;
  
  saveDB();
  toast(`₹${amt} added to wallet successfully!`, 'success', '💸');
  closeModal('walletModal');
}

let activeReviewParkId = null;
let activeReviewStars = 5;

function openReviewModal(parkId, parkName) {
  activeReviewParkId = parkId;
  activeReviewStars = 5;
  document.getElementById('reviewParkName').textContent = parkName;
  document.getElementById('reviewText').value = '';
  setReviewRating(5);
  openModal('reviewModal');
}

function setReviewRating(stars) {
  activeReviewStars = stars;
  const starEls = document.getElementById('reviewStars').children;
  for (let i = 0; i < 5; i++) {
    starEls[i].style.color = (i < stars) ? '#f59e0b' : '#cbd5e1';
  }
}

function submitReview() {
  if (!activeReviewParkId) return;
  const p = DB.parks.find(x => x.id === activeReviewParkId);
  if (p) {
    p.reviews = (p.reviews || 0) + 1;
    // Simple average calculation
    p.rating = (((p.rating || 5.0) * (p.reviews - 1)) + activeReviewStars) / p.reviews;
    p.rating = Math.round(p.rating * 10) / 10; // 1 decimal place
    saveDB();
    toast('Thanks for your review!','success','⭐');
  }
  closeModal('reviewModal');
}

function toggleDarkMode() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark ? '' : 'dark');
  const btn = document.getElementById('darkModeSwitch');
  if (btn) btn.classList.toggle('dark', !isDark);
  DB.darkMode = !isDark;
  saveDB();
}

// Restore dark mode on page load
if (DB.darkMode) {
  document.documentElement.setAttribute('data-theme', 'dark');
  const btn = document.getElementById('darkModeSwitch');
  if (btn) btn.classList.add('dark');
}

function selectDuration(d, el) {
  document.querySelectorAll('.dur-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  DB.selectedDuration = d;
}

function setBType(type, el) {
  DB.selectedBookingType = type;
  document.querySelectorAll('.btype-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  const lbl = document.getElementById('durLabel');
  if (type === 'daily') { lbl.textContent = `Daily Pass — ₹${DB.currentPark.dailyPrice}`; }
  else if (type === 'prebook') { lbl.textContent = 'Select Duration (Pre-book)'; }
  else { lbl.textContent = 'Select Duration'; }
}

function openSlotPicker() {
  const p = DB.currentPark;
  const grid = document.getElementById('slotGrid');
  // Generate slot layout
  const slots = [];
  for (let i=1; i<=25; i++) {
    const isEv = p.ev && i > 20;
    const isOccupied = Math.random() > (p.available/p.total) && i > 2;
    slots.push({ num: (isEv ? 'EV' : (i<=10 ? 'A' : 'B')) + '-' + String(i<=10?i:i-10).padStart(2,'0'), ev:isEv, occupied:isOccupied });
  }
  grid.innerHTML = slots.map((s,i) => `
    <div class="slot-item ${s.occupied ? 'slot-occupied' : s.ev ? 'slot-ev' : 'slot-available'} ${DB.selectedSlot===s.num?'slot-selected':''}"
         onclick="${s.occupied?'':'selectSlotItem(this,\''+s.num+'\')'}">
      ${s.num}
    </div>`).join('');
  openModal('slotModal');
}

function selectSlotItem(el, slot) {
  document.querySelectorAll('.slot-item.slot-selected').forEach(s => {
    s.classList.remove('slot-selected');
    s.classList.add(s.dataset.ev ? 'slot-ev' : 'slot-available');
  });
  el.classList.remove('slot-available','slot-ev');
  el.classList.add('slot-selected');
  DB.selectedSlot = slot;
}

function confirmSlot() {
  if (!DB.selectedSlot) { toast('Please select a slot first','warn','⚠️'); return; }
  closeModal('slotModal');
  toast(`Slot ${DB.selectedSlot} selected`,'success','✅');
  renderBookingStep(2); // re-render to show selected slot
}

function autoAssignSlot() {
  const p = DB.currentPark;
  const prefix = p.ev ? 'EV' : 'A';
  return prefix + '-' + String(Math.floor(Math.random()*12)+1).padStart(2,'0');
}

function bookingNext() {
  if (DB.bookingStep === 1) {
    if (!DB.selectedVehicle) { toast('Please select a vehicle','warn','⚠️'); return; }
    DB.bookingStep = 2;
    renderBookingStep(2);
    document.getElementById('bookingBody').scrollTop = 0;
  } else if (DB.bookingStep === 2) {
    if (!DB.selectedDuration && DB.selectedBookingType !== 'daily') { toast('Please select a duration','warn','⚠️'); return; }
    if (!DB.selectedSlot) { DB.selectedSlot = autoAssignSlot(); }
    DB.bookingStep = 3;
    renderBookingStep(3);
    document.getElementById('bookingBody').scrollTop = 0;
    document.getElementById('bookingNextBtn').textContent = '✅ Confirm Booking';
  } else if (DB.bookingStep === 3) {
    confirmBooking();
  }
}

function confirmBooking() {
  const payMethod = document.querySelector('input[name="payMethod"]:checked').value;
  const amt = DB.currentBooking.amount;

  if (payMethod === 'wallet') {
    if ((DB.walletBalance || 0) < amt) {
      toast('Insufficient Wallet Balance! Please Add Money or choose Pay on Arrival.', 'error', '✕');
      return;
    }
    DB.walletBalance -= amt;
    const badge = document.getElementById('profileWalletBadge');
    if (badge) badge.innerText = '₹' + DB.walletBalance;
  }

  showLoader('Confirming booking…');
  setTimeout(() => {
    hideLoader();
    // Update park availability
    const p = DB.parks.find(pk => pk.id === DB.currentPark.id);
    if (p && p.available > 0) p.available--;
    // Add to bookings
    DB.bookings.unshift({ ...DB.currentBooking, status:'upcoming', date:'Today' });
    document.getElementById('bookingNotif').style.display = 'block';
    toast('Booking confirmed! QR ticket ready','success','🎫');
    goTo('qr-ticket','anim-in');
  }, 1800);
}

/* ────────────────────────────────────────────────
   QR TICKET
──────────────────────────────────────────────── */
function initQRTicket() {
  const b = DB.currentBooking;
  if (!b) return;
  const startTime = new Date(b.start || Date.now());
  const endTime = new Date(startTime.getTime() + (b.durationMins||120) * 60000);
  const fmt = (d) => d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
  const fmtDate = (d) => d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});

  document.getElementById('tParkName').textContent = b.parkName;
  document.getElementById('tBookingId').textContent = 'ID: ' + b.id;
  document.getElementById('tSlot').textContent = b.slot;
  document.getElementById('tVehicle').textContent = b.vehicle;
  document.getElementById('tEntry').textContent = fmt(startTime);
  document.getElementById('tExit').textContent = fmt(endTime);
  document.getElementById('tDuration').textContent = b.duration || '2 Hrs';
  document.getElementById('tAmount').textContent = '₹' + b.amount;

  // Generate QR
  const qrData = JSON.stringify({
    id: b.id, park: b.parkName, addr: b.parkAddr,
    slot: b.slot, vehicle: b.vehicle,
    entry: fmt(startTime), exit: fmt(endTime),
    dur: b.duration, amt: '₹'+b.amount
  });
  const qrEl = document.getElementById('qr-canvas');
  qrEl.innerHTML = '';
  if (typeof QRCode !== 'undefined') {
    new QRCode(qrEl, { text: qrData, width:180, height:180, colorDark:'#0f172a', colorLight:'#ffffff', correctLevel: QRCode.CorrectLevel.M });
  } else {
    qrEl.innerHTML = '<div style="width:180px;height:180px;background:var(--surface);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:48px">📲</div>';
  }

  // Session data
  document.getElementById('sessionParkName').textContent = b.parkName;
  document.getElementById('sSlot').textContent = b.slot;
  document.getElementById('sVehicle').textContent = (b.vehicleType||'car').toUpperCase();
  document.getElementById('sessionTimeRemain').textContent = `Expires at ${fmt(endTime)}`;
  DB.sessionStart = null;
  DB.sessionDuration = b.durationMins || 120;
}

function downloadTicket() {
  const b = DB.currentBooking;
  if (!b) return;
  const content = `PARKLINK TICKET\n------------------\nID: ${b.id}\nPark: ${b.parkName}\nSlot: ${b.slot}\nVehicle: ${b.vehicle}\nAmount: ₹${b.amount}\n`;
  const blob = new Blob([content], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ParkLink_Ticket_${b.id}.txt`;
  a.click();
  toast('Ticket downloaded successfully', 'success', '⬇');
}

function shareTicket() {
  const text = `My parking at ${DB.currentBooking?.parkName}, Slot: ${DB.currentBooking?.slot}`;
  if (navigator.share) {
    navigator.share({ title:'ParkLink Ticket', text: text });
  } else {
    navigator.clipboard.writeText(text);
    toast('Ticket info copied to clipboard','success','📋');
  }
}

function downloadReceipt(bookingId) {
  const b = DB.bookings.find(bk => bk.id === bookingId);
  if (!b) return;
  const content = `PARKLINK RECEIPT\n------------------\nBooking ID: ${b.id}\nDate: ${new Date().toLocaleDateString()}\nLocation: ${b.parkName}\nVehicle: ${b.vehicle}\nTotal Paid: ₹${b.amount}\n\nThank you for using ParkLink!`;
  const blob = new Blob([content], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Receipt_${b.id}.txt`;
  a.click();
  toast('Receipt downloaded', 'success', '🧾');
}

/* ────────────────────────────────────────────────
   SESSION
──────────────────────────────────────────────── */
function startSession() {
  if (DB.sessionTimer) clearInterval(DB.sessionTimer);
  DB.sessionStart = Date.now();
  DB.sessionActive = true;
  updateSessionDisplay();
  DB.sessionTimer = setInterval(updateSessionDisplay, 1000);
}

function updateSessionDisplay() {
  if (!DB.sessionStart) return;
  const elapsed = Math.floor((Date.now() - DB.sessionStart) / 1000);
  const totalSecs = DB.sessionDuration * 60;
  const remaining = Math.max(0, totalSecs - elapsed);
  const fmt = (s) => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  const timerEl = document.getElementById('timerDisplay');
  const remainEl = document.getElementById('sRemain');
  const circle = document.getElementById('timerCircle');
  if (timerEl) timerEl.textContent = fmt(elapsed);
  if (remainEl) remainEl.textContent = fmt(remaining);
  if (circle) {
    const circumference = 552.9;
    const progress = elapsed / totalSecs;
    circle.style.strokeDashoffset = circumference * (1 - Math.min(progress, 1));
  }
  if (remaining === 300) toast('⚠️ 5 minutes remaining!','warn','⏰');
  if (remaining === 0) { clearInterval(DB.sessionTimer); toast('Parking session expired','warn','⏱️'); }
}

// Auto-start session when screen becomes active
const sessionObs = new MutationObserver(() => {
  if (document.getElementById('session')?.classList.contains('active')) {
    if (!DB.sessionActive) startSession();
  }
});
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('session');
  if (el) sessionObs.observe(el, { attributes:true, attributeFilter:['class'] });
});

function extendParking() {
  DB.sessionDuration += 60;
  toast('Session extended by 1 hour','success','⏱️');
}

function confirmEndParking() {
  if (confirm('End parking session now?')) {
    clearInterval(DB.sessionTimer);
    DB.sessionActive = false;
    DB.sessionStart = null;
    const b = DB.bookings[0];
    if (b) b.status = 'completed';
    const p = DB.parks.find(pk => pk.id === DB.currentBooking?.parkId);
    if (p) p.available = Math.min(p.total, p.available+1);
    toast('Parking ended. Have a safe journey!','success','✅');
    goTo('home');
  }
}

/* ────────────────────────────────────────────────
   BOOKINGS HISTORY
──────────────────────────────────────────────── */
function initBookings(tab='active') {
  showBookingTab(tab, document.querySelector('.tab-btn'));
}

function showBookingTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else document.querySelectorAll('.tab-btn')[['active','upcoming','history'].indexOf(tab)].classList.add('active');
  const filtered = tab === 'history' ? DB.bookings.filter(b=>b.status==='completed') : DB.bookings.filter(b=>b.status===tab);
  const el = document.getElementById('bookingsList');
  if (filtered.length === 0) {
    el.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--text-muted)"><div style="font-size:48px;margin-bottom:12px">📋</div><div style="font-weight:700;margin-bottom:6px">No ${tab} bookings</div><div style="font-size:13px">Your ${tab} bookings will appear here</div></div>`;
    return;
  }
  el.innerHTML = filtered.map(b => {
    const statusBadge = b.status === 'active' ? 'badge-green' : b.status === 'upcoming' ? 'badge-blue' : 'badge-dark' ;
    return `
    <div class="booking-item">
      <div class="booking-item-header">
        <div><div class="bi-name">${b.parkName}</div><div class="bi-meta">📍 ${b.date}</div></div>
        <span class="badge ${statusBadge}">${b.status.charAt(0).toUpperCase()+b.status.slice(1)}</span>
      </div>
      <div class="booking-item-body">
        <div class="bi-detail"><div class="bi-lbl">Slot</div><div class="bi-val">${b.slot}</div></div>
        <div class="bi-detail"><div class="bi-lbl">Vehicle</div><div class="bi-val" style="font-family:var(--font-mono);font-size:12px">${b.vehicle}</div></div>
        <div class="bi-detail"><div class="bi-lbl">Amount</div><div class="bi-val" style="color:var(--blue)">₹${b.amount}</div></div>
      </div>
      <div class="booking-item-actions">
        ${b.status==='active'?`<button class="btn btn-sm btn-primary" onclick="goTo('session','anim-in')">View Session</button>`:''}
        ${b.status==='upcoming'?`<button class="btn btn-sm" style="background:var(--blue-light);color:var(--blue)" onclick="goTo('qr-ticket','anim-in')">View Ticket</button>`:''}
        ${b.status==='completed'?`<button class="btn btn-sm" style="background:var(--surface);color:var(--text-muted)" onclick="rebookParking('${b.parkId}')">Re-book</button>`:''}
        ${b.status==='completed'?`<button class="btn btn-sm" style="background:#ffedd5;color:#9a3412;margin-left:auto;border:1px solid #fdba74" onclick="openReviewModal('${b.parkId}','${b.parkName}')">★ Rate</button>`:''}
        ${b.status==='completed'?`<button class="btn btn-sm" style="background:var(--surface);color:var(--text-muted);margin-left:8px" onclick="downloadReceipt('${b.id}')">Receipt</button>`:''}
      </div>
    </div>`;
  }).join('');
}

function rebookParking(parkId) {
  const p = DB.parks.find(pk => pk.id === parkId);
  if (p) { DB.currentPark = p; goTo('booking','anim-in'); renderBookingStep(1); DB.bookingStep=1; }
}

/* ────────────────────────────────────────────────
   PROFILE
──────────────────────────────────────────────── */
function updateProfileUI() {
  const u = DB.currentUser;
  if (!u) return;
  const name = u.name || 'User';
  document.getElementById('profileName').textContent = name;
  document.getElementById('profilePhone').textContent = u.phone || '';
  document.getElementById('profileAvatar').textContent = name[0].toUpperCase();
  document.getElementById('homeUserName').textContent = name + ' 👋';
  document.getElementById('homeAvatar').textContent = name[0].toUpperCase();
  if (DB.currentRole === 'admin') {
    document.getElementById('adminMenuSection').style.display = 'block';
    document.getElementById('ownerMenuSection').style.display = 'none';
  }
}

/* ────────────────────────────────────────────────
   OWNER DASHBOARD
──────────────────────────────────────────────── */
function initOwner() {
  // Calculate real stats from DB
  const totalBookings = DB.bookings.length;
  const totalEarnings = DB.bookings.reduce((sum, b) => sum + (b.amount || 0), 0);
  const activeBookings = DB.bookings.filter(b => b.status === 'active' || b.status === 'upcoming').length;
  const ownedParks = DB.parks.filter(p => p.status !== 'pending');

  // Update KPI cards via their ids
  const kpis = document.querySelectorAll('.kpi-card');
  if (kpis.length >= 4) {
    kpis[0].querySelector('.kpi-value').textContent = '₹' + totalEarnings;
    kpis[0].querySelector('.kpi-trend').textContent = '↑ From ' + totalBookings + ' bookings';
    kpis[1].querySelector('.kpi-value').textContent = activeBookings;
    kpis[2].querySelector('.kpi-value').textContent = ownedParks.reduce((s,p) => s + p.total, 0);
    kpis[3].querySelector('.kpi-value').textContent = ownedParks.reduce((s,p) => s + p.available, 0);
  }

  // Show real active/upcoming bookings in live feed
  const liveBookings = DB.bookings.filter(b => b.status === 'active' || b.status === 'upcoming').slice(0, 6);
  const livEl = document.getElementById('livBookingsList');
  if (liveBookings.length === 0) {
    livEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:14px">No active bookings right now</div>';
  } else {
    livEl.innerHTML = liveBookings.map(b => `
      <div class="live-booking-row">
        <div class="lbr-slot">${b.slot}</div>
        <div class="lbr-info"><div class="lbr-name">🚗 ${b.vehicle}</div><div class="lbr-meta" style="font-family:var(--font-mono);font-size:11px">${b.parkName}</div></div>
        <div class="lbr-time">${b.duration || '2 hrs'}</div>
      </div>`).join('');
  }

  // Show real owned lots
  const lotsEl = document.getElementById('ownerLotsList');
  if (ownedParks.length === 0) {
    lotsEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:14px">No parking lots yet. Add one!</div>';
  } else {
    lotsEl.innerHTML = ownedParks.map(l => `
      <div style="padding:12px 0;border-bottom:1px solid var(--border)">
        <div class="row justify-between mb8"><span style="font-weight:700">${l.name}</span><span class="badge badge-blue">₹${l.price}/hr</span></div>
        <div class="row justify-between"><span class="text-sm text-muted">${l.available} / ${l.total} available</span></div>
        <div class="slot-bar mt8"><div class="slot-fill" style="width:${Math.round((1-l.available/l.total)*100)}%;background:${l.available/l.total < 0.3 ? 'var(--amber)' : 'var(--green)'}"></div></div>
      </div>`).join('');
  }
}

/* ────────────────────────────────────────────────
   ADD PARKING FORM
──────────────────────────────────────────────── */
function toggleAmenity(el, key) {
  el.classList.toggle('on');
}

function submitParkingForm() {
  const name = document.getElementById('fpName').value.trim();
  const addr = document.getElementById('fpAddr').value.trim();
  const city = document.getElementById('fpCity').value.trim();
  const totalSlots = parseInt(document.getElementById('fpCarSlots').value) || 0;
  const price = parseInt(document.getElementById('fpHourly').value) || 0;

  if (!name || !addr) { toast('Please fill in parking name and address','warn','⚠️'); return; }
  
  showLoader('Submitting for verification…');
  setTimeout(() => {
    hideLoader();

    // Create new parking object
    const newPark = {
      id: 'P' + Date.now(),
      status: 'pending',
      name: name,
      addr: addr,
      city: city || 'Madurai',
      total: totalSlots || 20,
      available: totalSlots || 20,
      price: price || 30,
      dailyPrice: parseInt(document.getElementById('fpDaily').value) || 200,
      dist: 2.5,
      amenities: ['cctv', 'security'],
      ev: parseInt(document.getElementById('fpEvSlots').value) > 0,
      hours: `${document.getElementById('fpOpen').value || '06:00'} – ${document.getElementById('fpClose').value || '23:00'}`,
      rating: 5.0,
      reviews: 0,
      emoji: '🏢',
      color: '#10b981'
    };

    DB.parks.push(newPark);
    saveDB();

    // Clear form
    ['fpName', 'fpAddr', 'fpCity', 'fpCarSlots', 'fpBikeSlots', 'fpEvSlots', 'fpHourly', 'fpDaily'].forEach(id => {
      document.getElementById(id).value = '';
    });

    toast('New parking lot added successfully!','success','✅');
    goBack();
  }, 1000);
}

/* ────────────────────────────────────────────────
   ADMIN PANEL
──────────────────────────────────────────────── */
function initAdmin() {
  const cities = [
    { name:'Chennai', pct:87 },
    { name:'Mumbai', pct:74 },
    { name:'Bangalore', pct:91 },
    { name:'Hyderabad', pct:63 },
    { name:'Madurai', pct:58 },
    { name:'Pune', pct:45 }
  ];
  document.getElementById('cityBars').innerHTML = cities.map(c => `
    <div class="city-bar-item">
      <div class="city-name">${c.name}</div>
      <div class="city-bar-wrap"><div class="city-bar-fill" style="width:${c.pct}%"></div></div>
      <div class="city-pct">${c.pct}%</div>
    </div>`).join('');

  const pendingParks = DB.parks.filter(p => p.status === 'pending');
  
  if (pendingParks.length === 0) {
    document.getElementById('pendingVerify').innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:14px">No pending verifications</div>';
  } else {
    document.getElementById('pendingVerify').innerHTML = pendingParks.map(p => `
      <div class="verify-item">
        <div class="verify-icon">${p.emoji || '🏢'}</div>
        <div class="verify-info"><div class="verify-name">${p.name}</div><div class="verify-sub">Owner User · ${p.city}</div></div>
        <div class="verify-actions">
          <button class="btn btn-sm btn-green" style="font-size:12px;padding:8px 10px" onclick="adminApprove('${p.id}')">✓</button>
          <button class="btn btn-sm btn-danger" style="font-size:12px;padding:8px 10px" onclick="adminReject('${p.id}')">✕</button>
        </div>
      </div>`).join('');
  }
}

function adminApprove(id) {
  const p = DB.parks.find(x => x.id === id);
  if (p) {
    delete p.status;
    saveDB();
    toast(`${p.name} approved!`,'success','✅');
    initAdmin(); // Refresh
  }
}
function adminReject(id) {
  const idx = DB.parks.findIndex(x => x.id === id);
  if (idx !== -1) {
    const pName = DB.parks[idx].name;
    DB.parks.splice(idx, 1);
    saveDB();
    toast(`${pName} rejected`,'error','✕');
    initAdmin(); // Refresh
  }
}

/* ════════════════════════════════════════════════
   FEATURE 1 — WHATSAPP BOOKING BOT
════════════════════════════════════════════════ */
const WA = {
  flow: null,
  step: 0,
  data: {},
  typing: false
};

const WA_FLOWS = {
  book: [
    { bot: "👋 Hi! I'm *ParkLink Bot*.\n\nI can help you book parking instantly.\n\nWhich city are you in?", quick: ['Madurai','Chennai','Coimbatore','Mumbai'] },
    { bot: "Great! 📍 {city}\n\nSearching parking lots near you…\n\nI found *3 available lots*:\n1️⃣ Anna Nagar Hub — ₹30/hr (28 slots)\n2️⃣ Race Course Complex — ₹20/hr (7 slots)\n3️⃣ Bypass EV Park — ₹40/hr ⚡\n\nWhich one?", quick: ['Anna Nagar Hub','Race Course','Bypass EV Park'] },
    { bot: "✅ *{park}* selected!\n\nHow long will you park?", quick: ['1 hour','2 hours','3 hours','All day'] },
    { bot: "🚙 What type of vehicle do you have?", quick: ['🚗 Normal Vehicle','⚡ EV (Electric)'] },
    { bot: "Perfect! 🚗 What is your vehicle number?\n\n_(e.g. TN 59 AB 1234)_" },
    { bot: "🎫 *Booking Confirmed!*\n\nHere is your ticket:", ticket: true, quick: ['Book another','View my bookings','Need help'] }
  ],
  status: [
    { bot: "📋 *Your Active Bookings:*\n\n🟢 *BKG-001* — Anna Nagar Hub\nSlot A-12 · TN59AB1234 · Expires 11:00 AM\n\nWhat would you like to do?", quick: ['Extend time','End parking','Get directions','Back'] }
  ],
  help: [
    { bot: "🆘 *ParkLink Help Menu*\n\nI can help you with:\n• 🅿️ Book parking\n• 📋 Check your bookings\n• ⏱️ Extend parking time\n• 🎫 Get your QR ticket\n• 💰 Split with a friend\n\nWhat do you need?", quick: ['Book parking','My bookings','Split parking','Talk to human'] }
  ]
};

function initWhatsApp() {
  const chat = document.getElementById('waChat');
  chat.innerHTML = '';
  WA.flow = null; WA.step = 0; WA.data = {};
  // Date header
  chat.innerHTML = `<div style="text-align:center;margin:8px 0"><span style="background:rgba(0,0,0,0.12);color:rgba(0,0,0,0.5);font-size:11px;padding:4px 10px;border-radius:10px">TODAY</span></div>`;
  setTimeout(() => waBotSay("👋 Welcome to *ParkLink Bot*!\n\nI can help you *book parking*, *check your bookings*, or *split a fare* — all right here on WhatsApp!\n\nWhat would you like to do?",
    ['🅿️ Book Parking','📋 My Bookings','🆘 Help','💰 Split Parking']), 600);
}

function waBotSay(msg, quickReplies=[], ticket=false) {
  const chat = document.getElementById('waChat');
  // Show typing
  const typingEl = document.createElement('div');
  typingEl.className = 'wa-typing';
  typingEl.innerHTML = '<div class="wa-dot"></div><div class="wa-dot"></div><div class="wa-dot"></div>';
  chat.appendChild(typingEl);
  chat.scrollTop = chat.scrollHeight;
  setTimeout(() => {
    typingEl.remove();
    const now = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
    const bubble = document.createElement('div');
    bubble.className = 'wa-bubble bot';
    let content = msg.replace(/\*([^*]+)\*/g,'<b>$1</b>').replace(/\n/g,'<br>').replace(/_([^_]+)_/g,'<i style="color:#888">$1</i>');
    if (ticket && DB.currentBooking) {
      const b = DB.currentBooking;
      content += `<div class="wa-ticket-card">
        <div class="wa-ticket-header">🎫 ParkLink Digital Ticket</div>
        <div class="wa-ticket-body">
          <div class="wa-ticket-row"><span>Park</span><b>${b.parkName}</b></div>
          <div class="wa-ticket-row"><span>Slot</span><b>${b.slot}</b></div>
          <div class="wa-ticket-row"><span>Vehicle</span><b>${b.vehicle}</b></div>
          <div class="wa-ticket-row"><span>Duration</span><b>${b.duration}</b></div>
          <div class="wa-ticket-row"><span>Amount</span><b style="color:#128C7E">₹${b.amount}</b></div>
        </div>
      </div>`;
    }
    bubble.innerHTML = content + `<div class="wa-bubble-time">${now} ✓✓</div>`;
    chat.appendChild(bubble);
    // Quick replies
    const qrEl = document.getElementById('waQuickReplies');
    qrEl.innerHTML = '';
    if (quickReplies.length) {
      const wrap = document.createElement('div');
      wrap.className = 'wa-quick-replies';
      quickReplies.forEach(q => {
        const btn = document.createElement('button');
        btn.className = 'wa-qr-btn';
        btn.textContent = q;
        btn.onclick = () => { document.getElementById('waInput').value = q; waSend(); };
        wrap.appendChild(btn);
      });
      qrEl.appendChild(wrap);
    }
    chat.scrollTop = chat.scrollHeight;
  }, 1200);
}

function waUserSay(msg) {
  const chat = document.getElementById('waChat');
  const now = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
  const bubble = document.createElement('div');
  bubble.className = 'wa-bubble user';
  bubble.innerHTML = `${msg}<div class="wa-bubble-time">${now} ✓✓</div>`;
  chat.appendChild(bubble);
  document.getElementById('waQuickReplies').innerHTML = '';
  chat.scrollTop = chat.scrollHeight;
}

function waSend() {
  const input = document.getElementById('waInput');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = ''; input.style.height = 'auto';
  waUserSay(msg);
  processWaMessage(msg.toLowerCase());
}

function processWaMessage(msg) {
  // Top-level intents
  if (!WA.flow) {
    if (msg.includes('book') || msg.includes('parking') || msg.includes('🅿️')) {
      WA.flow = 'book'; WA.step = 0;
      const steps = WA_FLOWS.book;
      setTimeout(() => waBotSay(steps[0].bot, steps[0].quick), 300);
    } else if (msg.includes('booking') || msg.includes('my') || msg.includes('📋')) {
      WA.flow = 'status'; WA.step = 0;
      setTimeout(() => waBotSay(WA_FLOWS.status[0].bot, WA_FLOWS.status[0].quick), 300);
    } else if (msg.includes('split') || msg.includes('💰')) {
      setTimeout(() => { waBotSay("💰 Redirecting you to Split Parking screen…"); setTimeout(() => goTo('split','anim-in'), 1500); }, 300);
    } else if (msg.includes('help') || msg.includes('🆘')) {
      WA.flow = 'help'; WA.step = 0;
      setTimeout(() => waBotSay(WA_FLOWS.help[0].bot, WA_FLOWS.help[0].quick), 300);
    } else {
      setTimeout(() => waBotSay("I didn't quite get that 🤔\n\nTry saying *Book Parking*, *My Bookings*, or *Help*.", ['Book Parking','My Bookings','Help']), 300);
    }
    return;
  }

  // Flow processing
  if (WA.flow === 'book') {
    const steps = WA_FLOWS.book;
    WA.step++;
    if (WA.step === 1) { WA.data.city = msg; }
    if (WA.step === 2) { WA.data.park = msg.includes('race') ? 'Race Course Complex' : msg.includes('bypass')||msg.includes('ev') ? 'Bypass EV Park' : 'Anna Nagar Hub'; }
    if (WA.step === 3) { WA.data.dur = msg; }
    if (WA.step === 4) { WA.data.vehicleType = msg.includes('ev') || msg.includes('electric') ? 'ev' : 'car'; }
    if (WA.step === 5) {
      WA.data.vehicle = msg.toUpperCase();
      // Simulate booking
      const p = DB.parks[0];
      const isEV = WA.data.vehicleType === 'ev';
      DB.currentBooking = { id:'BKG-WA-'+Date.now(), parkName: WA.data.park||'Anna Nagar Hub', parkAddr:'Madurai', slot: (isEV ? 'EV' : 'A') + '-'+String(Math.floor(Math.random()*15)+1).padStart(2,'0'), vehicle: WA.data.vehicle, vehicleType: WA.data.vehicleType || 'car', duration: WA.data.dur||'2 hours', amount: isEV ? 80 : 60, durationMins:120, start:new Date() };
      const step = steps[5];
      setTimeout(() => waBotSay(step.bot, step.quick, true), 300);
      WA.flow = null; WA.step = 0;
      return;
    }
    if (WA.step < steps.length) {
      const step = steps[WA.step];
      const txt = step.bot.replace('{city}', WA.data.city||'').replace('{park}', WA.data.park||'');
      setTimeout(() => waBotSay(txt, step.quick||[]), 300);
    }
  } else if (WA.flow === 'status') {
    if (msg.includes('extend')) { setTimeout(() => waBotSay("⏱️ Parking extended by 1 hour!\nNew expiry: *12:00 PM*\n\nAdditional charge: ₹30 (pay at exit)", ['End parking','Get directions','Back to menu']), 300); }
    else if (msg.includes('end')) { setTimeout(() => waBotSay("🏁 Parking ended successfully!\n\nTotal time: 2 hrs\nTotal charge: ₹60\n\nThank you for using ParkLink! 🙏", ['Book again','Rate experience','Main menu']), 300); WA.flow=null; }
    else if (msg.includes('direction')) { setTimeout(() => waBotSay("🗺️ Opening navigation to Anna Nagar Hub…\n\nETA: *4 min* from your current location"), 300); WA.flow=null; }
    else { WA.flow=null; processWaMessage(msg); }
  } else if (WA.flow === 'help') {
    WA.flow = null;
    processWaMessage(msg);
  }
}

/* ════════════════════════════════════════════════
   FEATURE 2 — FESTIVAL SURGE PREDICTION
════════════════════════════════════════════════ */
const SURGE_EVENTS = [
  { emoji:'🛕', name:'Chithirai Festival', date:'Apr 14–18, 2025', days:'in 22 days', demand:'CRITICAL', pct:96, tip:'Book 3–4 days ahead. All central lots fill by 7 AM.', parks:[{name:'Meenakshi Temple Parking',pct:100,full:true},{name:'Town Hall Multi-Level',pct:92},{name:'Anna Nagar Hub',pct:78}] },
  { emoji:'🎓', name:'Anna University Convocation', date:'Apr 6, 2025', days:'in 14 days', demand:'HIGH', pct:74, tip:'Morning slots fill fast. EV Park has good availability.', parks:[{name:'Anna Nagar Hub',pct:85},{name:'Race Course Complex',pct:60},{name:'Bypass EV Park',pct:45}] },
  { emoji:'🎵', name:'AR Rahman Live — Madurai', date:'Apr 20, 2025', days:'in 28 days', demand:'HIGH', pct:81, tip:'Evening event. Expect 2x surge 2 hrs before show.', parks:[{name:'Town Hall Multi-Level',pct:90},{name:'Race Course Complex',pct:75},{name:'Anna Nagar Hub',pct:68}] },
  { emoji:'🏏', name:'TNPL Cricket Match', date:'May 3, 2025', days:'in 41 days', demand:'MEDIUM', pct:55, tip:'Pre-book recommended. Street parking will be blocked.', parks:[{name:'Anna Nagar Hub',pct:60},{name:'Bypass EV Park',pct:40}] }
];

const TIMELINE_DAYS = [
  { date:'Mon, Mar 24', event:'Normal day', hint:'~40% occupancy expected', color:'var(--green)', blocks:2 },
  { date:'Tue, Mar 25', event:'Normal day', hint:'~45% occupancy expected', color:'var(--green)', blocks:2 },
  { date:'Wed, Mar 26', event:'Govt holiday', hint:'Higher leisure traffic expected', color:'var(--amber)', blocks:5 },
  { date:'Thu, Mar 27', event:'Normal day', hint:'~38% occupancy', color:'var(--green)', blocks:2 },
  { date:'Fri, Mar 28', event:'Weekend rush begins', hint:'60–70% by evening', color:'var(--amber)', blocks:6 },
  { date:'Sat, Mar 29', event:'⚠️ Heavy demand', hint:'Pre-book strongly advised', color:'var(--red)', blocks:9 },
  { date:'Sun, Mar 30', event:'Sunday Market day', hint:'Central lots full by 10 AM', color:'var(--red)', blocks:8 }
];

function initSurge() {
  // Timeline
  const tl = document.getElementById('surgeTimeline');
  tl.innerHTML = TIMELINE_DAYS.map((d,i) => `
    <div class="st-day">
      <div class="st-dot-col">
        <div class="st-dot" style="background:${d.color}"></div>
        ${i < TIMELINE_DAYS.length-1 ? '<div class="st-line"></div>' : ''}
      </div>
      <div class="st-content">
        <div class="st-date">${d.date}</div>
        <div class="st-event">${d.event}</div>
        <div class="st-hint">${d.hint}</div>
        <div class="demand-meter" style="margin-top:6px">
          ${Array(10).fill(0).map((_,j) => `<div class="dm-block" style="${j < d.blocks ? 'background:'+d.color : ''}"></div>`).join('')}
        </div>
      </div>
    </div>`).join('');

  // Forecast cards
  const fc = document.getElementById('forecastCards');
  fc.innerHTML = SURGE_EVENTS.map(ev => {
    const demClr = ev.demand==='CRITICAL' ? 'fc-demand-critical' : ev.demand==='HIGH' ? 'fc-demand-high' : 'fc-demand-medium';
    return `<div class="forecast-card">
      <div class="fc-header">
        <div class="fc-event-icon">${ev.emoji}</div>
        <div class="fc-event-info">
          <div class="fc-event-name">${ev.name}</div>
          <div class="fc-event-date">📅 ${ev.date} · ${ev.days}</div>
        </div>
        <div class="fc-demand-badge ${demClr}">${ev.demand}</div>
      </div>
      <div class="fc-body">
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:10px;padding:10px;background:var(--amber-light);border-radius:8px;line-height:1.6">💡 ${ev.tip}</div>
        <div style="font-size:13px;font-weight:700;margin-bottom:8px">Predicted Occupancy by Location:</div>
        <div class="fc-parks">
          ${ev.parks.map(p => `
          <div class="fc-park-row">
            <div class="fc-park-name">${p.full ? '🔴 ' : ''}${p.name}</div>
            <div class="fc-bar-wrap"><div class="fc-bar" style="width:${p.pct}%;background:${p.pct>85?'var(--red)':p.pct>60?'var(--amber)':'var(--green)'}"></div></div>
            <div class="fc-pct" style="color:${p.pct>85?'var(--red)':p.pct>60?'var(--amber)':'var(--green)'}">${p.pct}%</div>
          </div>`).join('')}
        </div>
        <div class="fc-action-strip">
          <button class="btn btn-sm btn-primary" style="flex:1" onclick="surgePrebook('${ev.name}')">📅 Pre-book Now</button>
          <button class="btn btn-sm" style="background:var(--surface);color:var(--text-muted);flex:0.5" onclick="toast('Alert set for ${ev.name}','success','🔔')">🔔 Alert</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function surgePrebook(eventName) {
  toast(`Finding best slots for ${eventName}…`, 'info', '📅');
  setTimeout(() => { DB.currentPark = DB.parks[0]; goTo('booking','anim-in'); DB.bookingStep=1; renderBookingStep(1); }, 1000);
}

/* ════════════════════════════════════════════════
   FEATURE 3 — SPLIT PARKING
════════════════════════════════════════════════ */
const CONTACTS = [
  { name:'Karthik M', phone:'+91 98400 12345', initials:'K', color:'#4338ca' },
  { name:'Priya Nair', phone:'+91 91234 56789', initials:'P', color:'#7c3aed' },
  { name:'Siva Kumar', phone:'+91 93456 78901', initials:'S', color:'#065f46' },
  { name:'Divya R',   phone:'+91 99876 54321', initials:'D', color:'#b45309' }
];
let selectedContact = null;
let selectedUPIMethod = 'gpay';

function initSplit() {
  const b = DB.currentBooking || DB.bookings[0];
  if (b) {
    document.getElementById('splitParkName').textContent = b.parkName;
    document.getElementById('splitBookingMeta').textContent = `Slot ${b.slot} · ${b.vehicle} · ${b.duration}`;
    const total = b.amount || 60;
    const half = Math.ceil(total/2);
    document.getElementById('splitTotalAmt').textContent = '₹'+total;
    document.getElementById('splitYourShare').textContent = '₹'+half;
    document.getElementById('splitTheirShare').textContent = '₹'+(total-half);
  }
  document.getElementById('splitContacts').innerHTML = CONTACTS.map(c => `
    <div class="contact-card" onclick="selectContact('${c.name}',this)">
      <div class="contact-av" style="background:${c.color}">${c.initials}</div>
      <div class="contact-info">
        <div class="contact-name">${c.name}</div>
        <div class="contact-phone">${c.phone}</div>
      </div>
      <div class="vehicle-radio" id="cr-${c.name.replace(' ','')}"></div>
    </div>`).join('');
}

function selectContact(name, el) {
  document.querySelectorAll('.contact-card').forEach(c => {
    c.classList.remove('selected');
    c.querySelector('.vehicle-radio').style.cssText = '';
    c.querySelector('.vehicle-radio').innerHTML = '';
  });
  el.classList.add('selected');
  el.querySelector('.vehicle-radio').style.cssText = 'border-color:var(--ev);background:var(--ev)';
  el.querySelector('.vehicle-radio').innerHTML = '<span style="color:white;font-size:10px;font-weight:700">✓</span>';
  selectedContact = name;
}

function selectUPI(el, method) {
  document.querySelectorAll('.upi-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  selectedUPIMethod = method;
}

function sendSplitRequest() {
  if (!selectedContact) { toast('Please select a carpool partner first','warn','⚠️'); return; }
  const b = DB.currentBooking || DB.bookings[0];
  const total = b ? b.amount : 60;
  const their = Math.floor(total/2);
  showLoader('Sending split request via WhatsApp…');
  setTimeout(() => {
    hideLoader();
    toast(`Split request sent to ${selectedContact}! They'll pay ₹${their} via ${selectedUPIMethod}`, 'success', '✅');
    setTimeout(() => toast(`${selectedContact} accepted the split! ₹${their} received 🎉`, 'success', '💰'), 3500);
  }, 1800);
}

/* ════════════════════════════════════════════════
   FEATURE 4 — LIVE CCTV
════════════════════════════════════════════════ */
const CCTV_FEEDS = [
  { label:'CAM-01 · Entry Gate', slot:'ENTRY', vehicle:'🚗', active:true },
  { label:'CAM-02 · Zone A',     slot:'A-01 to A-15', vehicle:'🚙', active:false },
  { label:'CAM-03 · Zone B',     slot:'B-01 to B-12', vehicle:'🚘', active:false },
  { label:'CAM-04 · EV Bay',     slot:'EV-01 to EV-06', vehicle:'⚡🚗', active:false }
];

let cctvTick = null;

function initCCTV(parkName) {
  document.getElementById('cctvParkLabel').textContent = parkName || 'Anna Nagar Hub';
  renderCCTVGrid();
  updateCCTVTimestamp();
  if (cctvTick) clearInterval(cctvTick);
  cctvTick = setInterval(updateCCTVTimestamp, 1000);
}

function renderCCTVGrid() {
  const grid = document.getElementById('cctvGrid');
  grid.innerHTML = CCTV_FEEDS.map((feed, i) => `
    <div class="cctv-feed ${i===0?'active-feed':''}" onclick="cctvFeedClick(${i})">
      <div class="cctv-noise"></div>
      <div class="cctv-overlay"></div>
      <!-- Simulated parking lot -->
      <svg style="position:absolute;inset:0;width:100%;height:100%;opacity:0.3" viewBox="0 0 300 170">
        <rect x="20" y="20" width="260" height="130" rx="4" stroke="#00ff41" stroke-width="0.5" fill="none"/>
        ${Array(6).fill(0).map((_,j) => `<line x1="${40+j*40}" y1="20" x2="${40+j*40}" y2="150" stroke="#00ff41" stroke-width="0.5" opacity="0.5"/>`).join('')}
        <line x1="20" y1="85" x2="280" y2="85" stroke="#00ff41" stroke-width="0.5" opacity="0.5"/>
      </svg>
      <div class="cctv-vehicle" style="font-size:${i===0?'36':'22'}px">${feed.vehicle}</div>
      <div class="cctv-scan-line"></div>
      <div class="cctv-label">${feed.label}</div>
      <div class="cctv-rec"><div class="rec-dot"></div><span class="rec-txt">REC</span></div>
      <div class="cctv-timestamp" id="cctv-ts-${i}">00:00:00</div>
      <div class="cctv-slot-tag">${feed.slot}</div>
    </div>`).join('');
}

function cctvFeedClick(idx) {
  toast(`CAM-0${idx+1} expanded — ${CCTV_FEEDS[idx].label}`,'info','📹');
}

function updateCCTVTimestamp() {
  const now = new Date();
  const ts = now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  document.getElementById('cctvTimestamp').textContent = `${ts} · 4 cameras`;
  for(let i=0;i<4;i++) {
    const el = document.getElementById(`cctv-ts-${i}`);
    if(el) el.textContent = ts;
  }
}

function requestClip() {
  showLoader('Fetching 30-sec clip from server…');
  setTimeout(() => {
    hideLoader();
    const preview = document.getElementById('clipPreview');
    preview.style.display = 'block';
    preview.querySelector('.clip-progress').style.animation = 'none';
    setTimeout(() => preview.querySelector('.clip-progress').style.animation = 'clipPlay 8s linear forwards', 50);
    toast('Clip ready! Your vehicle is safe 🛡️','success','🎬');
  }, 2200);
}

function cctvSnapshot() {
  toast('Snapshot captured and saved to gallery','success','📸');
}

function cctvAlert() {
  showLoader('Alerting security guard…');
  setTimeout(() => { hideLoader(); toast('Security guard notified! Response in ~2 min','success','🛡️'); }, 1500);
}

function cctvFullscreen() {
  toast('Full-screen mode requires native app','info','⛶');
}

/* ════════════════════════════════════════════════
   FEATURE 5 — LAST MILE LINK
════════════════════════════════════════════════ */
const CAB_OPTIONS = [
  { name:'Ola', icon:'🟡', logo:'🟡', type:'Mini', eta:4, price:45, desc:'4-seater · AC', deeplink:'ola', color:'#f59e0b' },
  { name:'Rapido', icon:'🔵', logo:'🔵', type:'Bike', eta:2, price:18, desc:'Bike taxi · fastest', deeplink:'rapido', color:'#2563eb' },
  { name:'Namma Yatri', icon:'🟢', logo:'🟢', type:'Auto', eta:6, price:32, desc:'3-wheeler · no surge', deeplink:'nammayatri', color:'#10b981' },
  { name:'Uber', icon:'⬛', logo:'⬛', type:'Go', eta:5, price:52, desc:'4-seater · AC', deeplink:'uber', color:'#0f172a' }
];

const DESTINATIONS = ['Meenakshi Temple','Madurai Airport','Periyar Bus Stand','Samayanallur IT Park','Madurai Junction','Palaniswami Nagar','Alagar Kovil','Kochadai'];

let selectedCab = null;
let lmDestination = '';

function initLastMile() {
  const p = DB.currentPark || DB.parks[0];
  document.getElementById('lmFromName').textContent = p.name;
  renderCabList();
}

function lmFilterDest(val) {
  const sugBox = document.getElementById('lmSuggestions');
  if (!val || val.length < 1) {
    sugBox.style.display = 'none';
    return;
  }
  
  const matches = DESTINATIONS.filter(d => d.toLowerCase().includes(val.toLowerCase()));
  
  if (matches.length === 0) {
    sugBox.style.display = 'none';
    return;
  }
  
  sugBox.innerHTML = matches.map(d => `
    <div style="padding:12px 16px;cursor:pointer;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border);transition:background 0.15s" 
         onmouseover="this.style.background='var(--surface)'" 
         onmouseout="this.style.background='transparent'" 
         onclick="setDest('${d}')">
      <span style="font-size:18px">📍</span>
      <div>
        <div style="font-size:14px;font-weight:600;color:var(--text)">${d}</div>
        <div style="font-size:11px;color:var(--text-muted)">Madurai, Tamil Nadu</div>
      </div>
    </div>`).join('');
  sugBox.style.display = 'block';
}

function setDest(dest) {
  lmDestination = dest;
  document.getElementById('lmDestInput').value = dest;
  document.getElementById('lmToName').textContent = dest;
  document.getElementById('lmToPin').textContent = '🏁';
  document.getElementById('lmSuggestions').style.display = 'none';
  
  // Calculate a realistic distance based on destination name hash
  let hash = 0;
  for (let i = 0; i < dest.length; i++) hash += dest.charCodeAt(i);
  const dist = ((hash % 40) / 10 + 1.2).toFixed(1);
  
  document.getElementById('lmDistLabel').textContent = `📍 ${dist} km away · ~${Math.round(dist*3)} min`;
  renderCabList(dist);
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
}

function renderCabList(dist=2.5) {
  const list = document.getElementById('cabList');
  list.innerHTML = CAB_OPTIONS.map((c,i) => {
    const adjPrice = Math.round(c.price * (parseFloat(dist)||2.5) / 2);
    const adjEta = c.eta + Math.floor(Math.random()*3);
    return `<div class="cab-card ${selectedCab===i?'selected':''}" onclick="selectCab(${i},this)">
      <div class="cab-logo" style="background:${c.color}22;font-size:28px">${c.icon}</div>
      <div class="cab-info">
        <div class="cab-name" style="color:${c.color}">${c.name} ${c.type}</div>
        <div class="cab-detail">${c.desc}</div>
      </div>
      <div class="cab-eta-badge">
        <div class="cab-eta">${adjEta} min</div>
        <div class="cab-price">₹${adjPrice}</div>
      </div>
    </div>`;
  }).join('');
  // Add book button if destination set
  if (lmDestination) {
    list.innerHTML += `<button class="btn btn-primary" style="margin-top:8px" onclick="bookLastMile()">🚀 Book Ride Now</button>
    <div style="text-align:center;font-size:12px;color:var(--text-muted);margin-top:8px">Opens ${selectedCab!==null ? CAB_OPTIONS[selectedCab].name : 'ride app'} with your parking location pre-filled</div>`;
  }
}

function selectCab(idx, el) {
  selectedCab = idx;
  document.querySelectorAll('.cab-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
}

function bookLastMile() {
  if (!lmDestination) { toast('Enter your destination first','warn','📍'); return; }
  const cab = selectedCab !== null ? CAB_OPTIONS[selectedCab] : CAB_OPTIONS[0];
  const park = DB.currentPark || DB.parks[0];
  const origin = encodeURIComponent(park.addr + ', Madurai');
  const destination = encodeURIComponent(lmDestination + ', Madurai');
  
  showLoader(`Opening ${cab.name}…`);
  setTimeout(() => {
    hideLoader();
    
    // Build deep-link URL based on selected cab
    let url = '';
    switch(cab.deeplink) {
      case 'ola':
        url = `https://book.olacabs.com/?pickup=${origin}&drop=${destination}`;
        break;
      case 'uber':
        url = `https://m.uber.com/ul/?action=setPickup&pickup[formatted_address]=${origin}&dropoff[formatted_address]=${destination}`;
        break;
      case 'rapido':
        url = `https://www.google.com/maps/dir/${origin}/${destination}/?travelmode=driving`;
        break;
      case 'nammayatri':
        url = `https://www.google.com/maps/dir/${origin}/${destination}/?travelmode=driving`;
        break;
      default:
        url = `https://www.google.com/maps/dir/${origin}/${destination}/?travelmode=driving`;
    }
    
    window.open(url, '_blank');
    toast(`${cab.name} ride from ${park.name} to ${lmDestination} 🚀`, 'success', cab.icon);
  }, 1000);
}

/* ────────────────────────────────────────────────
   FEATURE OPENERS
──────────────────────────────────────────────── */
function openWABot() {
  goTo('whatsapp-bot','anim-in');
  setTimeout(() => initWhatsApp(), 80);
}
function openSurge() {
  goTo('surge','anim-in');
  setTimeout(() => initSurge(), 80);
}
function openSplit() {
  goTo('split','anim-in');
  setTimeout(() => initSplit(), 80);
}
function openCCTV() {
  const p = DB.currentPark || DB.parks[0];
  goTo('cctv','anim-in');
  setTimeout(() => initCCTV(p.name), 80);
}
function openLastMile() {
  goTo('lastmile','anim-in');
  setTimeout(() => initLastMile(), 80);
}


window.addEventListener('DOMContentLoaded', () => {
  // Session observer
  const session = document.getElementById('session');
  if (session) {
    const obs = new MutationObserver(() => {
      if (session.classList.contains('active') && !DB.sessionActive) startSession();
    });
    obs.observe(session, { attributes:true, attributeFilter:['class'] });
  }
});
