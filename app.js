// Farewell Memories Client App Logic (Dynamic REST API Integration)

// Auto-detects GitHub Pages vs local/custom domain
const API_URL = (
  window.FAREWELL_API_URL || 
  (window.location.hostname.includes('github.io') ? 'https://apps.errand.ltd/farewell/api' : '/farewell/api')
).replace(/\/$/, '');

const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB

// ══ BROKEN MEDIA HANDLING ══
// Photos/videos are stored as plain URLs returned by the upload API (R2 or
// server fallback). If a URL is missing, was uploaded over http:// on an
// https:// page (mixed content gets silently blocked by the browser), or
// points at a file that no longer exists, the <img>/<video> just fails with
// no visual explanation. These two helpers make that failure visible and
// recoverable instead of a blank/broken icon.

const BROKEN_IMG_PLACEHOLDER =
  'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
      <rect width="100%" height="100%" fill="#1a0f2e"/>
      <text x="50%" y="46%" font-size="42" text-anchor="middle" dominant-baseline="middle">🖼️</text>
      <text x="50%" y="62%" font-size="13" fill="#a694c9" font-family="sans-serif" text-anchor="middle">Photo unavailable</text>
    </svg>`
  );

// Normalizes a stored media URL: trims whitespace and upgrades an
// accidental http:// link to https:// so it isn't blocked as mixed content
// on this (https) page. Returns '' for empty/missing URLs so callers can
// decide how to render the "no photo" state instead of pointing <img> at
// the current page (which is what src="" does in some browsers).
function normalizeMediaUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (location.protocol === 'https:' && trimmed.startsWith('http://')) {
    return 'https://' + trimmed.slice('http://'.length);
  }
  return trimmed;
}

// Delegated, capture-phase listener: image "error" events don't bubble, so
// this is attached on window with capture:true to catch every broken <img>
// on the page (memory grid, pinned row, detail viewer, unified gallery,
// student photos, hero photo) in one place. On first failure it retries
// once after a short delay (covers transient network blips / a
// cold-starting backend); if the retry also fails, it swaps in a labeled
// placeholder instead of the browser's default broken-image icon and logs
// the dead URL to the console so it's easy to spot which uploads need
// re-posting.
window.addEventListener('error', function (e) {
  const el = e.target;
  if (!el || el.tagName !== 'IMG' || el.dataset.brokenHandled) return;
  if (el.src === BROKEN_IMG_PLACEHOLDER) return;

  if (!el.dataset.retried) {
    el.dataset.retried = '1';
    const originalSrc = el.getAttribute('src');
    setTimeout(() => { if (originalSrc) el.src = originalSrc + (originalSrc.includes('?') ? '&' : '?') + 'retry=' + Date.now(); }, 800);
    return;
  }

  el.dataset.brokenHandled = '1';
  console.warn('[farewell] photo failed to load, showing placeholder:', el.getAttribute('src'));
  el.src = BROKEN_IMG_PLACEHOLDER;
  el.classList.add('media-broken');
}, true);

// ══ DIRECT CLIENT-TO-R2 PRESIGNED UPLOAD HELPER ══
async function uploadFileDirectToR2(file, folder = 'farewell/images') {
  const isVideo = file.type.startsWith('video');
  if (isVideo && file.size > MAX_VIDEO_SIZE) {
    throw new Error('Video exceeds maximum allowed size of 500MB');
  }

  // 1. Request presigned upload URL from API
  const presignRes = await fetch(`${API_URL}/upload/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      mimetype: file.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
      fileSize: file.size,
      fileType: isVideo ? 'video' : 'image'
    })
  });

  const presignData = await presignRes.json();
  if (!presignRes.ok) throw new Error(presignData.error || 'Failed to get upload authorization');

  // 2. Direct upload to Cloudflare R2 (Bypasses Node.js server memory & bandwidth)
  if (presignData.directR2 && presignData.uploadUrl) {
    const uploadRes = await fetch(presignData.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || (isVideo ? 'video/mp4' : 'image/jpeg')
      },
      body: file
    });
    if (!uploadRes.ok) throw new Error('Direct upload to Cloudflare R2 failed');
    return presignData.publicUrl;
  }

  // Fallback to server streaming if R2 not configured
  const formData = new FormData();
  formData.append('file', file);
  const endpoint = isVideo ? `${API_URL}/upload/video` : `${API_URL}/upload/image`;
  const fallbackRes = await fetch(endpoint, { method: 'POST', body: formData });
  const fallbackData = await fallbackRes.json();
  if (!fallbackRes.ok) throw new Error(fallbackData.error || 'Upload failed');
  return fallbackData.url;
}

// ══ HERO COLLEGE PHOTO ══
async function setHeroPhoto(e){
  const file = e.target.files[0];
  if (!file) return;
  try {
    showToast('Uploading college photo directly to Cloudflare R2... ⏳');
    const photoUrl = await uploadFileDirectToR2(file, 'farewell/hero');
    const img = document.getElementById('heroCollegeImg');
    if (img) img.src = normalizeMediaUrl(photoUrl);
    const batchCard = document.getElementById('batchCardPhoto');
    if (batchCard) batchCard.classList.add('has-photo');
    showToast('📷 College photo updated on cloud!');
  } catch(err) {
    showToast(`Upload failed: ${err.message}`);
  }
  e.target.value = '';
}

// ══ HOME HERO 3-PHOTO CINEMATIC LOOP ══
let heroSlideIndex = 0;
let heroSlideTimer = null;
let dynamicHeroSlides = [];

function updateHeroSlide(index){
  const slides = document.querySelectorAll('.hero-slide');
  const dots = document.querySelectorAll('.hero-indicator');
  const caption = document.getElementById('heroCaption');
  if (!slides.length) return;

  heroSlideIndex = (index + slides.length) % slides.length;
  slides.forEach((slide, i) => slide.classList.toggle('active', i === heroSlideIndex));
  dots.forEach((dot, i) => dot.classList.toggle('active', i === heroSlideIndex));

  if (caption) {
    const currentSlide = dynamicHeroSlides[heroSlideIndex];
    caption.textContent = currentSlide?.caption || 'Our Campus';
  }
}

function startHeroSlideshow(){
  if (heroSlideTimer) clearInterval(heroSlideTimer);
  heroSlideTimer = setInterval(() => {
    updateHeroSlide(heroSlideIndex + 1);
  }, 7000);
}

function startCinematicHero(){
  const hero = document.getElementById('homeHero');
  if (!hero) return;
  hero.classList.add('cinematic-start');
  startHeroSlideshow();
}

// ══ NAVIGATION ══
function showPage(id, navEl){
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.style.display = 'none';
  });
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pg = document.getElementById('page-' + id);
  const mainEl = document.querySelector('.main');
  if (pg) {
    pg.style.display = 'block';
    pg.classList.add('active');
    pg.classList.remove('fade-in');
    void pg.offsetWidth;
    pg.classList.add('fade-in');
  }
  if (mainEl) {
    mainEl.style.overflowY = 'auto';
    mainEl.scrollTop = 0;
  }
  if (id === 'home') {
    startCinematicHero();
  }
  if (navEl) navEl.classList.add('active');
  else {
    document.querySelectorAll('.nav-item').forEach(n => {
      if (n.getAttribute('onclick') && n.getAttribute('onclick').includes("'" + id + "'")) {
        n.classList.add('active');
      }
    });
  }
  if (window._checkFooterVisibility) window._checkFooterVisibility();
}

// ══ STUDENTS ══
const VIBES = [
  'The Topper 🤓', 'The Funny One 😂', 'The Chill One 😎', 'The Artist 🎨',
  'The Foodie 🍕', 'The Night Owl 🦉', 'The Gym Rat 💪', 'The Storyteller 📖',
  'The Music Head 🎵', 'The Philosopher 🤔', 'The Sleepy One 😴', 'The Hype Person 📣'
];
let students = [];
let activeAlphaFilter = 'ALL';

function renderStudents(list){
  const grid = document.getElementById('studentsGrid');
  if (!grid) return;
  grid.innerHTML = '';
  
  const countBadge = document.getElementById('studentCountBadge');
  if (countBadge) {
    countBadge.textContent = `${list.length} Student${list.length === 1 ? '' : 's'}`;
  }

  if (!list.length) {
    grid.innerHTML = `<div class="pinned-empty" style="grid-column:1/-1; padding:36px; text-align:center;">No students found matching your filter 🔍</div>`;
    return;
  }

  list.forEach((s, localIdx) => {
    const realIdx = students.indexOf(s);
    const card = document.createElement('div');
    card.className = 'student-card';
    const photoInner = s.photo_url
      ? `<img src="${normalizeMediaUrl(s.photo_url)}" alt="${esc(s.name)}"/>`
      : `<div class="initials-ring"><span>${(s.name[0] || '?').toUpperCase()}</span></div>`;
    card.innerHTML = `<div class="student-photo">${photoInner}</div><div class="student-num">${realIdx >= 0 ? realIdx + 1 : localIdx + 1}</div><div class="student-info"><div class="student-name">${esc(s.name)}</div><div class="student-vibes">${esc(s.vibes)}</div></div>`;
    card.addEventListener('click', () => openPhotoViewer(s, 'student'));
    grid.appendChild(card);
  });
}

function filterByAlpha(letter, el){
  activeAlphaFilter = letter.toUpperCase();
  document.querySelectorAll('.alpha-chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  
  const query = document.getElementById('studentSearchInput')?.value.trim().toLowerCase() || '';
  applyStudentFilters(query, activeAlphaFilter);
}

function searchStudents(q){
  applyStudentFilters(q.toLowerCase(), activeAlphaFilter);
}

function applyStudentFilters(query, alpha){
  let filtered = students;
  if (alpha && alpha !== 'ALL') {
    filtered = filtered.filter(s => (s.name || '').trim().toUpperCase().startsWith(alpha));
  }
  if (query) {
    filtered = filtered.filter(s =>
      (s.name || '').toLowerCase().includes(query) ||
      (s.vibes || '').toLowerCase().includes(query)
    );
  }
  renderStudents(filtered);
}

function openPhotoViewer(s, type){
  const pv = document.getElementById('photoViewer');
  const av = document.getElementById('pvAvatar');
  if (s.photo_url) {
    av.innerHTML = `<img src="${normalizeMediaUrl(s.photo_url)}" alt="${esc(s.name)}"/>`;
    av.style.background = 'none';
  } else {
    av.innerHTML = `<span>${(s.name[0] || '?').toUpperCase()}</span>`;
    av.style.background = type === 'teacher' ? 'linear-gradient(135deg,#FBBF24,#10B981)' : 'linear-gradient(135deg,#FF6B9D,#A855F7)';
  }
  document.getElementById('pvName').textContent = s.name;
  document.getElementById('pvVibes').textContent = s.vibes;
  pv.classList.add('open');
}
function closePhotoViewer(){ document.getElementById('photoViewer').classList.remove('open'); }
const photoViewerEl = document.getElementById('photoViewer');
if (photoViewerEl) {
  photoViewerEl.addEventListener('click', function(e){ if (e.target === this) closePhotoViewer(); });
}

// ══ FOOTER SCROLL HOOK ══
(function(){
  const mainEl = document.querySelector('.main');
  const footerEl = document.querySelector('.site-footer-row');
  if (!mainEl || !footerEl) return;
  const PULL_THRESHOLD = 60;
  let pullAmount = 0;
  let touchStartY = null;

  function atBottom(){ return mainEl.scrollHeight - mainEl.scrollTop - mainEl.clientHeight < 2; }
  function hideFooter(){ footerEl.classList.remove('visible'); pullAmount = 0; }
  function updateFooter(){ footerEl.classList.toggle('visible', pullAmount >= PULL_THRESHOLD); }

  mainEl.addEventListener('scroll', () => { if (!atBottom()) hideFooter(); }, { passive: true });
  mainEl.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
  mainEl.addEventListener('touchmove', e => {
    if (!atBottom()) { pullAmount = 0; return; }
    const dy = touchStartY - e.touches[0].clientY;
    if (dy > 0) { pullAmount = dy; updateFooter(); }
    else hideFooter();
  }, { passive: true });
  mainEl.addEventListener('touchend', () => { if (pullAmount < PULL_THRESHOLD) hideFooter(); });
  mainEl.addEventListener('wheel', e => {
    if (atBottom() && e.deltaY > 0) { pullAmount += e.deltaY; updateFooter(); }
    else if (e.deltaY < 0) hideFooter();
  }, { passive: true });
  window.addEventListener('resize', hideFooter);
  window._checkFooterVisibility = hideFooter;
})();

// ══ FLOATING AUDIO EQUALIZER & ANTHEM PLAYER ══
let bgAudio = null;
let isAudioPlaying = false;

function toggleMusicPlayback(){
  if (!bgAudio) {
    bgAudio = new Audio('https://media.errand.ltd/farewell/audio/anthem.mp3');
    bgAudio.loop = true;
    bgAudio.volume = 0.65;
    bgAudio.addEventListener('ended', () => {
      isAudioPlaying = false;
      updateMusicPlayerUI();
    });
  }

  if (isAudioPlaying) {
    bgAudio.pause();
    isAudioPlaying = false;
  } else {
    bgAudio.play().then(() => {
      isAudioPlaying = true;
      updateMusicPlayerUI();
    }).catch(() => {
      showToast('🎵 Click anywhere to allow audio playback');
    });
  }
  updateMusicPlayerUI();
}

function updateMusicPlayerUI(){
  const player = document.getElementById('floatingMusicPlayer');
  const playBtn = document.getElementById('floatingPlayBtn');
  const status = document.getElementById('musicPlayerStatus');
  if (player) player.classList.toggle('playing', isAudioPlaying);
  if (playBtn) playBtn.textContent = isAudioPlaying ? '❚❚' : '▶';
  if (status) status.textContent = isAudioPlaying ? 'Playing Farewell Anthem 🎵' : 'Tap to play anthem';
}

function pickEmoji(emoji){
  const textEl = document.getElementById('msgText');
  const selectEl = document.getElementById('msgEmoji');
  if (textEl) {
    textEl.value += ' ' + emoji;
    textEl.focus();
  }
  if (selectEl) {
    for (let i = 0; i < selectEl.options.length; i++) {
      if (selectEl.options[i].value === emoji) {
        selectEl.selectedIndex = i;
        break;
      }
    }
  }
}

// ══ MESSAGES / WISHES ══
async function addMessage(){
  const name = document.getElementById('msgName').value.trim() || 'Anonymous 🕵️';
  const text = document.getElementById('msgText').value.trim();
  const emoji = document.getElementById('msgEmoji').value;
  if (!text) { showToast('Write something! 😅'); return; }

  try {
    const res = await fetch(`${API_URL}/wishes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author_name: name, emoji, text })
    });
    const newWish = await res.json();
    if (!res.ok) throw new Error(newWish.error || 'Failed to post wish');

    const grid = document.getElementById('messagesGrid');
    const card = document.createElement('div');
    card.className = 'message-card envelope-anim';
    card.innerHTML = `<div class="msg-emoji">${esc(newWish.emoji)}</div><div class="msg-quote">"</div><div class="msg-text">${esc(newWish.text)}</div><div class="msg-author">— ${esc(newWish.author_name)}</div><button class="card-del" onclick="deleteWishCard(${newWish.id}, this)">🗑</button>`;
    grid.prepend(card);
    document.getElementById('msgName').value = '';
    document.getElementById('msgText').value = '';
    updateWishCount();
    showToast('Wish posted! 🥹');
  } catch(err) {
    showToast(err.message);
  }
}

async function deleteWishCard(id, btn){
  try {
    await fetch(`${API_URL}/wishes/${id}`, { method: 'DELETE' });
    btn.closest('.message-card').remove();
    updateWishCount();
    showToast('Wish deleted');
  } catch(err) {
    btn.closest('.message-card').remove();
    updateWishCount();
  }
}

function updateWishCount(){
  const countEl = document.getElementById('statWishes');
  const messagesGrid = document.getElementById('messagesGrid');
  if (countEl && messagesGrid) {
    countEl.textContent = messagesGrid.querySelectorAll('.message-card').length;
  }
}

// ══════════════════════════════════════════
//  MEMORIES + FLASHBACKS
// ══════════════════════════════════════════
let memories = [];
let flashbacks = [];
let openMemIdx = null, detPhotoIdx = 0, openReelIdx = null;
let pendingMemFiles = [], pendingReelFiles = [];

const AV_COLORS = ['#A855F7', '#FF6B9D', '#3B82F6', '#10B981', '#FBBF24', '#F97316'];
function avColor(name){
  let h = 0;
  for (const c of (name || '?')) h = c.charCodeAt(0) + h * 31;
  return AV_COLORS[Math.abs(h) % AV_COLORS.length];
}

const MEM_TAGS_POOL = ['#BPharm2026', '#FarewellForever', '#LabLife', '#BestBatch', '#PharmaFamily', '#OurGang'];
const REEL_TAGS_POOL = ['#Flashback', '#BPharm2026', '#FarewellVibes', '#LabMemories', '#PharmaFamily'];

const GALLERY_CATEGORIES = [
  { id: 'all', label: '📸 All' },
  { id: 'college', label: '🏫 College' },
  { id: 'classes', label: '📚 Classes' },
  { id: 'practicals', label: '🧪 Practicals' },
  { id: 'events', label: '🎉 Events' },
  { id: 'trips', label: '🚌 Trips' },
  { id: 'friends', label: '❤️ Friends' },
  { id: 'farewell', label: '🎓 Farewell' },
  { id: 'candid', label: '😂 Candid' }
];
let activeGalleryCategory = 'all';

function renderGalleryTabs(){
  const wrap = document.getElementById('galleryTabs');
  if (!wrap) return;
  wrap.innerHTML = GALLERY_CATEGORIES.map(c =>
    `<button class="gallery-tab ${c.id === activeGalleryCategory ? 'active' : ''}" onclick="setGalleryCategory('${c.id}')">${c.label}</button>`
  ).join('');
}
function setGalleryCategory(id){
  activeGalleryCategory = id;
  renderGalleryTabs();
  renderMemories();
}

// ══ SCROLL-TRIGGERED REVEAL ANIMATIONS ══
const revealObserver = ('IntersectionObserver' in window) ? new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('in-view');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }) : null;

function observeReveal(el){
  if (!el) return;
  el.classList.add('reveal-up');
  if (revealObserver) revealObserver.observe(el);
  else el.classList.add('in-view');
}

// ══ GESTURES ══
function enableSwipeNav(el, onSwipe){
  if (!el || el.dataset.swipeBound) return;
  el.dataset.swipeBound = '1';
  let sx = 0, sy = 0, tracking = false;
  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });
  el.addEventListener('touchend', e => {
    if (!tracking) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      onSwipe(dx < 0 ? 1 : -1);
      el.classList.remove('gallery-swipe-next', 'gallery-swipe-prev');
      void el.offsetWidth;
      el.classList.add(dx < 0 ? 'gallery-swipe-next' : 'gallery-swipe-prev');
    }
  }, { passive: true });
}

// ══ UNIFIED GALLERY FULLSCREEN VIEWER ══
let unifiedMedia = [];
let unifiedMediaIndex = 0;

function buildUnifiedMedia(){
  unifiedMedia = [];
  memories.forEach((m, mi) => (m.photos || []).forEach((url, pi) => unifiedMedia.push({ type: 'image', url: normalizeMediaUrl(url), meta: m, source: 'memory', memIndex: mi, photoIndex: pi })));
  flashbacks.forEach((r, ri) => unifiedMedia.push({ type: 'video', url: normalizeMediaUrl(r.video_url), meta: r, source: 'flashback', reelIndex: ri }));
}
function openUnifiedMedia(item){
  buildUnifiedMedia();
  let idx = -1;
  if (item && item.source === 'memory') idx = unifiedMedia.findIndex(x => x.source === 'memory' && x.memIndex === item.memIndex && x.photoIndex === item.photoIndex);
  if (item && item.source === 'flashback') idx = unifiedMedia.findIndex(x => x.source === 'flashback' && x.reelIndex === item.reelIndex);
  if (idx < 0) idx = 0;
  unifiedMediaIndex = idx;
  renderUnifiedMedia();
  const ov = document.getElementById('galleryFullscreen');
  if (ov) {
    ov.classList.add('open');
    ov.setAttribute('aria-hidden', 'false');
  }
  document.body.style.overflow = 'hidden';
}
function renderUnifiedMedia(){
  const item = unifiedMedia[unifiedMediaIndex];
  const holder = document.getElementById('galleryFsMedia');
  if (!item || !holder) return;
  holder.innerHTML = '';
  if (item.type === 'video') {
    const v = document.createElement('video');
    v.src = normalizeMediaUrl(item.url);
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.autoplay = true;
    v.loop = true;
    v.muted = false;
    v.controls = false;
    holder.appendChild(v);
    v.play().catch(() => {});
  } else {
    const img = document.createElement('img');
    img.src = normalizeMediaUrl(item.url) || BROKEN_IMG_PLACEHOLDER;
    img.alt = 'Farewell memory';
    img.draggable = false;
    holder.appendChild(img);
  }
  const countEl = document.getElementById('galleryFsCount');
  if (countEl) countEl.textContent = `${unifiedMediaIndex + 1} / ${unifiedMedia.length}`;
  const hasMany = unifiedMedia.length > 1;
  const leftBtn = document.getElementById('galleryFsLeft');
  const rightBtn = document.getElementById('galleryFsRight');
  if (leftBtn) leftBtn.style.display = hasMany ? 'flex' : 'none';
  if (rightBtn) rightBtn.style.display = hasMany ? 'flex' : 'none';
}
function unifiedNav(dir){
  if (!unifiedMedia.length) return;
  unifiedMediaIndex = (unifiedMediaIndex + dir + unifiedMedia.length) % unifiedMedia.length;
  renderUnifiedMedia();
}
function closeUnifiedMedia(){
  const ov = document.getElementById('galleryFullscreen');
  if (ov) {
    ov.classList.remove('open');
    ov.setAttribute('aria-hidden', 'true');
  }
  const holder = document.getElementById('galleryFsMedia');
  if (holder) holder.innerHTML = '';
  document.body.style.overflow = '';
}

// ── UPLOAD MODALS & CLOUD STORAGE ──
function openMemUploadModal(){
  pendingMemFiles = [];
  document.getElementById('memChosenLabel').textContent = 'Choose photos';
  document.getElementById('memCaptionInput').value = '';
  document.getElementById('memNameInput').value = '';
  openModal('memUploadModal');
}
function handleMemFilesChosen(e){
  pendingMemFiles = Array.from(e.target.files);
  document.getElementById('memChosenLabel').textContent = pendingMemFiles.length
    ? `${pendingMemFiles.length} photo${pendingMemFiles.length > 1 ? 's' : ''} selected ✓`
    : 'Choose photos';
}
async function postMemory(){
  if (!pendingMemFiles.length) { showToast('Choose at least one photo first! 📷'); return; }
  const name = document.getElementById('memNameInput').value.trim() || 'Anonymous 🕵️';
  const caption = document.getElementById('memCaptionInput').value.trim();
  
  showToast('Uploading photo(s) directly to Cloudflare R2... ⏳');

  try {
    const photoUrls = await Promise.all(
      pendingMemFiles.map(f => uploadFileDirectToR2(f, 'farewell/images'))
    );

    const catPool = GALLERY_CATEGORIES.filter(c => c.id !== 'all');
    const category = catPool[memories.length % catPool.length].id;
    const postRes = await fetch(`${API_URL}/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        photos: photoUrls,
        caption,
        uploader_name: name,
        category,
        tags: [MEM_TAGS_POOL[0], MEM_TAGS_POOL[1]]
      })
    });
    const newMem = await postRes.json();
    if (!postRes.ok) throw new Error(newMem.error || 'Failed to post memory');

    memories.unshift(newMem);
    renderMemories();
    closeModal('memUploadModal');
    document.getElementById('memPhotoInput').value = '';
    pendingMemFiles = [];
    showToast('📸 Memory posted to cloud!');
  } catch(err) {
    showToast(`Error: ${err.message}`);
  }
}

function openReelUploadModal(){
  pendingReelFiles = [];
  document.getElementById('reelChosenLabel').textContent = 'Choose video (Max 500MB)';
  document.getElementById('reelNameInput').value = '';
  openModal('reelUploadModal');
}
function handleReelFilesChosen(e){
  const files = Array.from(e.target.files);
  for (const f of files) {
    if (f.size > MAX_VIDEO_SIZE) {
      alert(`❌ Video "${f.name}" exceeds the 500MB size limit!`);
      e.target.value = '';
      pendingReelFiles = [];
      return;
    }
  }
  pendingReelFiles = files;
  document.getElementById('reelChosenLabel').textContent = pendingReelFiles.length
    ? `${pendingReelFiles.length} video${pendingReelFiles.length > 1 ? 's' : ''} selected ✓`
    : 'Choose video (Max 500MB)';
}
async function postFlashbacks(){
  if (!pendingReelFiles.length) { showToast('Choose at least one video first! 🎥'); return; }
  const name = document.getElementById('reelNameInput').value.trim() || 'Anonymous 🕵️';
  const file = pendingReelFiles[0];

  showToast('Uploading video directly to Cloudflare R2 (up to 500MB)... ⏳');

  try {
    const videoUrl = await uploadFileDirectToR2(file, 'farewell/videos');

    const postRes = await fetch(`${API_URL}/flashbacks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: file.name.replace(/\.[^.]+$/, ''),
        video_url: videoUrl,
        uploader_name: name,
        tags: [REEL_TAGS_POOL[0], REEL_TAGS_POOL[1]]
      })
    });
    const newReel = await postRes.json();
    if (!postRes.ok) throw new Error(newReel.error || 'Failed to save flashback');

    flashbacks.unshift(newReel);
    renderFlashbacks();
    closeModal('reelUploadModal');
    document.getElementById('reelVideoInput').value = '';
    pendingReelFiles = [];
    showToast('🎬 Flashback reel posted!');
  } catch(err) {
    showToast(`Error: ${err.message}`);
  }
}

// ── RENDER MEMORIES ──
function renderMemories(){
  const grid = document.getElementById('memoriesGrid');
  if (!grid) return;
  renderPinnedMemories();
  if (!memories.length) {
    grid.innerHTML = `<div class="gl-empty-state"><span class="e-icon">📷</span><h3>No memories yet</h3><p>Be the first to post a photo memory!</p></div>`;
    return;
  }
  const filtered = memories.map((m, i) => ({ m, i })).filter(o => activeGalleryCategory === 'all' || o.m.category === activeGalleryCategory);
  if (!filtered.length) {
    grid.innerHTML = `<div class="gl-empty-state"><span class="e-icon">🔍</span><h3>Nothing here yet</h3><p>No memories tagged in this category so far.</p></div>`;
    return;
  }
  grid.innerHTML = '';
  filtered.forEach(({ m, i }) => {
    const col = avColor(m.uploader_name || 'A');
    const photos = m.photos || [];
    const card = document.createElement('div');
    card.className = 'mem-card';
    card.innerHTML = `
      <div class="mem-card-img-wrap gallery-photo-wrap">
        <img src="${normalizeMediaUrl(photos[0]) || BROKEN_IMG_PLACEHOLDER}" loading="lazy" alt=""/>
        <button class="pin-toggle-btn ${m.pinned ? 'pinned' : ''}" onclick="event.stopPropagation();togglePinMemory(${i})" title="${m.pinned ? 'Unpin' : 'Pin to top'}">📌</button>
        ${photos.length > 1 ? `<div class="mem-multi-badge">⧉ ${photos.length}</div>` : ''}
      </div>
      <div class="mem-card-info">
        <div class="mem-card-author">
          <div class="mem-av" style="background:${col}">${(m.uploader_name || 'A')[0].toUpperCase()}</div>
          <div><div class="mem-card-name">${esc(m.uploader_name || 'Anonymous')}</div><div class="mem-card-date">${new Date(m.created_at || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div></div>
        </div>
        ${m.caption ? `<div class="mem-card-caption">${esc(m.caption)}</div>` : ''}
        <div class="mem-card-tags">${(m.tags || []).map(t => `<span class="mem-tag">${esc(t)}</span>`).join('')}</div>
        <div class="mem-card-footer">
          <button class="mem-action ${m.liked ? 'liked' : ''}" onclick="event.stopPropagation();quickLikeMem(${i},this)">
            <span class="mem-heart">${m.liked ? '♥' : '♡'}</span> ${m.likes_count || 0}
          </button>
          <button class="mem-action" onclick="event.stopPropagation();openMemDetail(${i})">💬 ${(m.comments || []).length}</button>
        </div>
      </div>`;
    card.onclick = () => openMemDetail(i);
    
    // Double tap heart gesture on memory photo
    const imgWrap = card.querySelector('.mem-card-img-wrap');
    if (imgWrap) {
      let lastTap = 0;
      imgWrap.addEventListener('click', (e) => {
        const now = Date.now();
        if (now - lastTap < 320) {
          e.stopPropagation();
          triggerDoubleTapHeart(card, i);
        }
        lastTap = now;
      });
    }

    grid.appendChild(card);
    observeReveal(card);
  });
}

function triggerDoubleTapHeart(card, i){
  let heart = card.querySelector('.double-tap-heart');
  if (!heart) {
    heart = document.createElement('div');
    heart.className = 'double-tap-heart';
    heart.textContent = '❤️';
    card.querySelector('.mem-card-img-wrap')?.appendChild(heart);
  }
  heart.classList.remove('animate');
  void heart.offsetWidth;
  heart.classList.add('animate');
  const mem = memories[i];
  if (mem && !mem.liked) {
    const likeBtn = card.querySelector('.mem-action');
    quickLikeMem(i, likeBtn);
  }
}

function renderPinnedMemories(){
  const row = document.getElementById('pinnedMemRow');
  if (!row) return;
  const pinnedItems = memories.map((m, i) => ({ m, i })).filter(o => o.m.pinned);
  if (!pinnedItems.length) {
    row.innerHTML = `<div class="pinned-empty">No pinned memories yet — tap 📌 on any photo to pin it here.</div>`;
    return;
  }
  row.innerHTML = '';
  pinnedItems.forEach(({ m, i }) => {
    const photos = m.photos || [];
    const card = document.createElement('div');
    card.className = 'pinned-card';
    card.innerHTML = `
      <img src="${normalizeMediaUrl(photos[0]) || BROKEN_IMG_PLACEHOLDER}" loading="lazy" alt=""/>
      <button class="pinned-unpin-btn" onclick="event.stopPropagation();togglePinMemory(${i})" title="Unpin">📌</button>
      ${photos.length > 1 ? `<div class="pinned-multi-badge">⧉ ${photos.length}</div>` : ''}
    `;
    card.onclick = () => openMemDetail(i);
    row.appendChild(card);
  });
}

async function togglePinMemory(i){
  const m = memories[i];
  if (!m) return;
  m.pinned = !m.pinned;
  renderMemories();
  try {
    await fetch(`${API_URL}/memories/${m.id}/pin`, { method: 'PUT' });
  } catch(e){}
}

async function quickLikeMem(i, btn){
  const m = memories[i];
  if (!m) return;
  m.liked = !m.liked;
  m.likes_count = (m.likes_count || 0) + (m.liked ? 1 : -1);
  btn.className = 'mem-action' + (m.liked ? ' liked' : '');
  btn.innerHTML = `<span class="mem-heart">${m.liked ? '♥' : '♡'}</span> ${m.likes_count}`;
  try {
    await fetch(`${API_URL}/memories/${m.id}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ increment: m.liked ? 1 : -1 })
    });
  } catch(e){}
}

// ── MEMORY DETAIL OVERLAY ──
function openMemDetail(i){
  openMemIdx = i;
  detPhotoIdx = 0;
  const m = memories[i];
  document.getElementById('memOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';

  const photos = m.photos || [];
  const photosWrap = document.getElementById('detPhotos');
  photosWrap.querySelectorAll('img').forEach(img => img.remove());
  photos.forEach((url, pi) => {
    const img = document.createElement('img');
    img.src = normalizeMediaUrl(url) || BROKEN_IMG_PLACEHOLDER;
    img.className = pi === 0 ? 'active' : '';
    img.onclick = () => openMemFullView();
    photosWrap.insertBefore(img, photosWrap.querySelector('.det-nav.right'));
  });
  const dots = document.getElementById('detDots');
  dots.innerHTML = photos.length > 1 ? photos.map((_, pi) => `<div class="det-dot ${pi === 0 ? 'active' : ''}" onclick="detGoTo(${pi})"></div>`).join('') : '';
  document.getElementById('detPhotoCount').textContent = photos.length > 1 ? `1 / ${photos.length}` : '';
  document.getElementById('detLeft').style.display = photos.length > 1 ? 'flex' : 'none';
  document.getElementById('detRight').style.display = photos.length > 1 ? 'flex' : 'none';

  const col = avColor(m.uploader_name || 'A');
  document.getElementById('detAv').style.background = col;
  document.getElementById('detAv').textContent = (m.uploader_name || 'A')[0].toUpperCase();
  document.getElementById('detName').textContent = m.uploader_name || 'Anonymous';
  document.getElementById('detMeta').textContent = (m.created_at ? new Date(m.created_at).toLocaleDateString() : 'Recent') + ' • ' + photos.length + ' photo' + (photos.length > 1 ? 's' : '');
  document.getElementById('detCaption').textContent = m.caption || '';
  document.getElementById('detTags').innerHTML = (m.tags || []).map(t => `<span class="det-tag">${esc(t)}</span>`).join('');
  updateDetLikeUI();
  renderDetComments();
}

function detNav(dir){
  if (openMemIdx === null) return;
  const m = memories[openMemIdx];
  const photos = m.photos || [];
  if (!photos.length) return;
  detGoTo((detPhotoIdx + dir + photos.length) % photos.length);
}
function detGoTo(idx){
  if (openMemIdx === null) return;
  detPhotoIdx = idx;
  const m = memories[openMemIdx];
  const wrap = document.getElementById('detPhotos');
  wrap.querySelectorAll('img').forEach((img, i) => img.className = i === idx ? 'active' : '');
  document.querySelectorAll('#detDots .det-dot').forEach((d, i) => d.className = 'det-dot' + (i === idx ? ' active' : ''));
  document.getElementById('detPhotoCount').textContent = `${idx + 1} / ${(m.photos || []).length}`;
}
function openMemFullView(){
  if (openMemIdx === null) return;
  const m = memories[openMemIdx];
  const photos = m.photos || [];
  document.getElementById('mfvImg').src = normalizeMediaUrl(photos[detPhotoIdx]) || BROKEN_IMG_PLACEHOLDER;
  document.getElementById('mfvCount').textContent = photos.length > 1 ? `${detPhotoIdx + 1} / ${photos.length}` : '';
  document.getElementById('mfvLeft').style.display = photos.length > 1 ? 'flex' : 'none';
  document.getElementById('mfvRight').style.display = photos.length > 1 ? 'flex' : 'none';
  document.getElementById('memFullView').classList.add('open');
}
function closeMemFullView(){ document.getElementById('memFullView').classList.remove('open'); }
function mfvNav(dir){
  if (openMemIdx === null) return;
  const m = memories[openMemIdx];
  const photos = m.photos || [];
  if (!photos.length) return;
  detGoTo((detPhotoIdx + dir + photos.length) % photos.length);
  openMemFullView();
}
function updateDetLikeUI(){
  const m = memories[openMemIdx];
  const btn = document.getElementById('detLikeBtn');
  btn.className = 'det-action-btn' + (m.liked ? ' liked' : '');
  btn.innerHTML = (m.liked ? '♥ ' : '♡ ') + `<span id="detLikeCount">${m.likes_count || 0}</span>`;
  const lb = document.getElementById('detLikedBy');
  if ((m.likes_count || 0) > 0) {
    lb.style.display = 'block';
    lb.textContent = `Liked by ${m.likes_count} classmate${m.likes_count !== 1 ? 's' : ''}`;
  } else lb.style.display = 'none';
}
async function detToggleLike(){
  if (openMemIdx === null) return;
  const m = memories[openMemIdx];
  m.liked = !m.liked;
  m.likes_count = (m.likes_count || 0) + (m.liked ? 1 : -1);
  updateDetLikeUI();
  renderMemories();
  try {
    await fetch(`${API_URL}/memories/${m.id}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ increment: m.liked ? 1 : -1 })
    });
  } catch(e){}
}
function renderDetComments(){
  const m = memories[openMemIdx];
  const list = document.getElementById('detComments');
  const comments = m.comments || [];
  document.getElementById('detCommentCount').textContent = comments.length;
  if (!comments.length) {
    list.innerHTML = '<div class="det-no-comments">No comments yet — say something! 💬</div>';
    return;
  }
  list.innerHTML = comments.map(c => `
    <div class="det-comment">
      <div class="det-comment-av">${(c.author_name || 'A')[0].toUpperCase()}</div>
      <div class="det-comment-body">
        <div class="det-comment-name">${esc(c.author_name || 'Anonymous')}</div>
        <div class="det-comment-text">${esc(c.text)}</div>
        <div class="det-comment-time">${c.created_at ? new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now'}</div>
      </div>
    </div>`).join('');
}
async function detAddComment(){
  if (openMemIdx === null) return;
  const m = memories[openMemIdx];
  const inp = document.getElementById('detCommentInput');
  const text = inp.value.trim();
  if (!text) return;
  const name = 'Anonymous 🕵️';

  try {
    const res = await fetch(`${API_URL}/memories/${m.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author_name: name, text })
    });
    const newComment = await res.json();
    m.comments = m.comments || [];
    m.comments.push(newComment);
    inp.value = '';
    renderDetComments();
    renderMemories();
  } catch(err){
    showToast(err.message);
  }
}
function closeMemDetail(){
  document.getElementById('memOverlay').classList.remove('open');
  document.body.style.overflow = '';
  openMemIdx = null;
}

// ── RENDER FLASHBACKS ──
function renderFlashbacks(){
  const grid = document.getElementById('flashbacksGrid');
  if (!grid) return;
  renderPinnedFlashbacks();
  if (!flashbacks.length) {
    grid.innerHTML = `<div class="gl-empty-state" style="grid-column:1/-1"><span class="e-icon">🎬</span><h3>No flashbacks yet</h3><p>Upload a video reel and relive the moments!</p></div>`;
    return;
  }
  grid.innerHTML = '';
  flashbacks.forEach((r, i) => {
    const card = document.createElement('div');
    card.className = 'reel-card';
    card.innerHTML = `
      <div class="reel-thumb">
        <video src="${normalizeMediaUrl(r.video_url)}" preload="metadata" muted playsinline></video>
        <div class="reel-play-overlay"><div class="reel-play-btn">▶</div></div>
        <button class="pin-toggle-btn ${r.pinned ? 'pinned' : ''}" onclick="event.stopPropagation();togglePinFlashback(${i})" title="${r.pinned ? 'Unpin' : 'Pin to top'}">📌</button>
        <div class="reel-likes">♥ ${r.likes_count || 0}</div>
        <div class="reel-bottom">
          <div class="reel-card-title">${esc(r.title)}</div>
          <div class="reel-card-sub">${esc(r.uploader_name || 'Anonymous')}</div>
        </div>
      </div>`;
    const vidEl = card.querySelector('video');
    vidEl.addEventListener('loadedmetadata', () => {
      try { vidEl.currentTime = Math.min(0.15, (vidEl.duration || 1) / 4); } catch(e){}
    }, { once: true });
    card.onclick = () => openReel(i);
    grid.appendChild(card);
    observeReveal(card);
  });
}

function renderPinnedFlashbacks(){
  const row = document.getElementById('pinnedReelRow');
  if (!row) return;
  const pinnedItems = flashbacks.map((r, i) => ({ r, i })).filter(o => o.r.pinned);
  if (!pinnedItems.length) {
    row.innerHTML = `<div class="pinned-empty">No pinned flashbacks yet — tap 📌 on any video to pin it here.</div>`;
    return;
  }
  row.innerHTML = '';
  pinnedItems.forEach(({ r, i }) => {
    const card = document.createElement('div');
    card.className = 'pinned-card pinned-reel-card';
    card.innerHTML = `
      <video src="${normalizeMediaUrl(r.video_url)}" preload="metadata" muted playsinline></video>
      <div class="pinned-play-badge">▶</div>
      <button class="pinned-unpin-btn" onclick="event.stopPropagation();togglePinFlashback(${i})" title="Unpin">📌</button>
    `;
    const vidEl = card.querySelector('video');
    vidEl.addEventListener('loadedmetadata', () => {
      try { vidEl.currentTime = Math.min(0.15, (vidEl.duration || 1) / 4); } catch(e){}
    }, { once: true });
    card.onclick = () => openReel(i);
    row.appendChild(card);
  });
}

async function togglePinFlashback(i){
  const r = flashbacks[i];
  if (!r) return;
  r.pinned = !r.pinned;
  renderFlashbacks();
  try {
    await fetch(`${API_URL}/flashbacks/${r.id}/pin`, { method: 'PUT' });
  } catch(e){}
}

function openReel(i){
  openReelIdx = i;
  const r = flashbacks[i];
  document.getElementById('reelOverlay').classList.add('open');
  const vid = document.getElementById('reelVideo');
  vid.src = normalizeMediaUrl(r.video_url);
  vid.play().catch(() => {});
  document.getElementById('reelTitle').textContent = r.title;
  document.getElementById('reelSub').textContent = (r.uploader_name || 'Anonymous') + ' • ' + (r.created_at ? new Date(r.created_at).toLocaleDateString() : 'Recent');
  document.getElementById('reelTags').innerHTML = (r.tags || []).map(t => `<span class="reel-info-tag">${esc(t)}</span>`).join('');
  document.getElementById('reelLikeCount').textContent = r.likes_count || 0;
  document.getElementById('reelLikeIcon').textContent = r.liked ? '♥' : '♡';
  document.getElementById('reelCounter').textContent = `${i + 1} / ${flashbacks.length}`;
  buildReelProgress();
}
function buildReelProgress(){
  document.getElementById('reelProgress').innerHTML = flashbacks.map((_, i) => `<div class="reel-prog-dot ${i === openReelIdx ? 'active' : ''}"></div>`).join('');
}
function reelNav(dir){
  if (openReelIdx === null || !flashbacks.length) return;
  openReel((openReelIdx + dir + flashbacks.length) % flashbacks.length);
}
async function reelToggleLike(){
  if (openReelIdx === null) return;
  const r = flashbacks[openReelIdx];
  r.liked = !r.liked;
  r.likes_count = (r.likes_count || 0) + (r.liked ? 1 : -1);
  document.getElementById('reelLikeCount').textContent = r.likes_count;
  document.getElementById('reelLikeIcon').textContent = r.liked ? '♥' : '♡';
  try {
    await fetch(`${API_URL}/flashbacks/${r.id}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ increment: r.liked ? 1 : -1 })
    });
  } catch(e){}
}
function closeReel(){
  document.getElementById('reelOverlay').classList.remove('open');
  const vid = document.getElementById('reelVideo');
  vid.pause();
  vid.src = '';
  vid.load();
  openReelIdx = null;
  renderFlashbacks();
}

// ── KEYBOARD NAVIGATION ──
document.addEventListener('keydown', e => {
  if (document.getElementById('galleryFullscreen')?.classList.contains('open')) {
    if (e.key === 'Escape') closeUnifiedMedia();
    else if (e.key === 'ArrowLeft') unifiedNav(-1);
    else if (e.key === 'ArrowRight') unifiedNav(1);
    return;
  }
  const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (document.getElementById('memFullView')?.classList.contains('open')) {
    if (e.key === 'Escape') closeMemFullView();
    else if (!typing && e.key === 'ArrowLeft') mfvNav(-1);
    else if (!typing && e.key === 'ArrowRight') mfvNav(1);
    return;
  }
  if (document.getElementById('memOverlay')?.classList.contains('open')) {
    if (e.key === 'Escape') closeMemDetail();
    else if (!typing && e.key === 'ArrowLeft') detNav(-1);
    else if (!typing && e.key === 'ArrowRight') detNav(1);
  }
  if (document.getElementById('reelOverlay')?.classList.contains('open')) {
    if (e.key === 'Escape') closeReel();
    else if (!typing && e.key === 'ArrowUp') reelNav(-1);
    else if (!typing && e.key === 'ArrowDown') reelNav(1);
  }
});

function openModal(id){ const m = document.getElementById(id); if (m) m.classList.add('open'); }
function closeModal(id){ const m = document.getElementById(id); if (m) m.classList.remove('open'); }
document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeModal(m.id); }));
function showToast(msg){
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}
function esc(s){
  if (s === null || s === undefined) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

// ══ CREDITS PANEL ══
let CREDITS = [
  { name: 'Meganathan', role: '👑 Website Admin' },
  { name: 'Editor Name 1', role: '✏️ Editor' },
  { name: 'Editor Name 2', role: '✏️ Editor' }
];
function renderCredits(){
  const listEl = document.getElementById('creditsList');
  if (!listEl) return;
  listEl.innerHTML = CREDITS.map(c => `
    <div class="credit-row">
      <div class="credit-av">${esc((c.name || 'A').charAt(0).toUpperCase())}</div>
      <div>
        <div class="credit-name">${esc(c.name)}</div>
        <div class="credit-role">${esc(c.role)}</div>
      </div>
    </div>
  `).join('');
}
function openCredits(){ renderCredits(); const o = document.getElementById('creditsOverlay'); if (o) o.classList.add('open'); }
function closeCredits(){ const o = document.getElementById('creditsOverlay'); if (o) o.classList.remove('open'); }

// ══ DYNAMIC BOOTSTRAPPER (FETCH ALL DATA ON LOAD) ══
async function loadDynamicSiteData() {
  try {
    const [cfgRes, studentsRes, memsRes, reelsRes, wishesRes] = await Promise.all([
      fetch(`${API_URL}/config`).catch(() => null),
      fetch(`${API_URL}/students`).catch(() => null),
      fetch(`${API_URL}/memories`).catch(() => null),
      fetch(`${API_URL}/flashbacks`).catch(() => null),
      fetch(`${API_URL}/wishes`).catch(() => null)
    ]);

    if (cfgRes && cfgRes.ok) {
      const cfg = await cfgRes.json();
      if (cfg.site_title) document.title = cfg.site_title;
      if (cfg.logo_text) {
        const logo = document.getElementById('siteLogo');
        if (logo) logo.textContent = cfg.logo_text;
      }
      if (cfg.credits) CREDITS = cfg.credits;
      if (cfg.hero_slides && cfg.hero_slides.length) {
        dynamicHeroSlides = cfg.hero_slides;
        const heroImg = document.getElementById('heroCollegeImg');
        if (heroImg && cfg.hero_slides[0]?.image_url) {
          heroImg.src = normalizeMediaUrl(cfg.hero_slides[0].image_url);
        }
      }
    }

    if (studentsRes && studentsRes.ok) {
      students = await studentsRes.json();
      renderStudents(students);
    }

    if (memsRes && memsRes.ok) {
      memories = await memsRes.json();
      renderGalleryTabs();
      renderMemories();
    }

    if (reelsRes && reelsRes.ok) {
      flashbacks = await reelsRes.json();
      renderFlashbacks();
    }

    if (wishesRes && wishesRes.ok) {
      const wishes = await wishesRes.json();
      const grid = document.getElementById('messagesGrid');
      if (grid && wishes.length) {
        grid.innerHTML = wishes.map(w => `
          <div class="message-card">
            <div class="msg-emoji">${esc(w.emoji)}</div>
            <div class="msg-quote">"</div>
            <div class="msg-text">${esc(w.text)}</div>
            <div class="msg-author">— ${esc(w.author_name)}</div>
            <button class="card-del" onclick="deleteWishCard(${w.id}, this)">🗑</button>
          </div>
        `).join('');
        updateWishCount();
      }
    }
  } catch (err) {
    console.warn('[API Load Warning]', err);
  } finally {
    startCinematicHero();
  }
}

// Initial Data Load on Page Ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    loadDynamicSiteData();
    startCinematicHero();
  });
} else {
  loadDynamicSiteData();
  startCinematicHero();
}
